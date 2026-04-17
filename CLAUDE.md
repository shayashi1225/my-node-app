# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install               # 初回セットアップ

npm run server:mock       # Kafka なしで即起動（ローカル開発推奨）
npm run server            # Kafka ありで起動（失敗時はモックへ自動フォールバック）
npm run server:dev        # --watch モードで起動（Kafka あり）
npm run mock-producer     # Kafka トピックへ疑似データを送信（Kafka 起動済み前提）

npm test                          # Jest でテストを全件実行
npx jest tests/db.test.js         # db テストのみ実行
npx jest tests/server.test.js     # server テストのみ実行
```

ブラウザで `http://localhost:3000` を開くと、PLC1・PLC2 の二つの波形が表示される。

ローカルで Kafka を起動する場合:

```bash
docker run -d --name kafka -p 9092:9092 apache/kafka:latest
```

## アーキテクチャ

複数の PLC センサーからのリアルタイム波形ビジュアライザー。各 PLC は独立したデータストリームと閾値を持つ。

```text
[Kafka: factory-data]   → src/server.js (KafkaJS consumer)
[Kafka: factory-data-2] →        ↓ Socket.IO (waveform-data イベント)
                            src/index.html (uPlot でリアルタイム描画)
                                  ↓ value > THRESHOLD_*
                            data.db (SQLite: threshold_events)
```

### データフロー

- **メッセージ形式**: `{ ts: number (Unix ms), value: number }`
- `src/server.js` は 2 つの Kafka トピック（`factory-data` → PLC1、`factory-data-2` → PLC2）をコンシュームし、`plcId` フィールドを追加して Socket.IO でブロードキャスト
- `src/index.html` は CDN から読み込んだ Socket.IO クライアントと uPlot で両方のストリームを受信、スライディングウィンドウ（MAX_POINTS=500点）で表示
- uPlot は秒単位の Unix タイムスタンプを要求するため、クライアント側で `ts / 1000` に変換

### 実装上の注意

- HTTP サーバーは Express を使わず Node.js 標準の `http` モジュールで実装されている
- Kafka ブローカーアドレス（`localhost:9092`）・clientId（`visualizer`）・groupId（`viz-group`）は `server.js` にハードコードされており、環境変数での変更は不可
- `server.js` は `{ handleData, server }` をエクスポートしており、テストから直接インポートして利用する
- 各 PLC の閾値は独立しており、`THRESHOLD_1` と `THRESHOLD_2` で制御（`THRESHOLD` は PLC1 のデフォルト用）

### 閾値永続化

`src/server.js` の `handleData()` が全メッセージを処理し、`value > THRESHOLD_*` を満たしたものだけ `src/db.js` 経由で SQLite に書き込む。Kafka モード・内部モック両方に適用される。

- **テーブル**: `threshold_events (id, ts, value, plc_id, recorded_at)`
- **DBファイル**: プロジェクトルートの `data.db`（git 管理外）
- **マイグレーション**: 既存 DB には `ALTER TABLE` で `plc_id` 列を自動追加
- **閾値デフォルト**: 
  - PLC1: `78`（環境変数 `THRESHOLD_1` または `THRESHOLD` で変更可）
  - PLC2: `78`（環境変数 `THRESHOLD_2` で変更可）

```bash
THRESHOLD_1=50 THRESHOLD_2=70 npm run server
```

### API エンドポイント

| パス | 説明 |
| --- | --- |
| `GET /` | `src/index.html` を返す |
| `GET /api/events?plcId=1&minValue=&maxValue=` | 指定 PLC の閾値超過イベントを最大200件、ts降順で返す |
| `GET /api/thresholds` | 両方の PLC の閾値を `{ plc1: number, plc2: number }` で返す |
| `GET /api/threshold` | PLC1 の閾値を `{ threshold: number }` で返す（後方互換性） |

### モックデータ

| 方法 | 用途 |
| --- | --- |
| `USE_MOCK=true` (`npm run server:mock`) | Kafka 不要。PLC1 は サイン波、PLC2 はコサイン波を 100ms 間隔で emit |

**PLC1**: 値域 約29〜51（閾値 78 を超えない）
**PLC2**: 値域 約57〜85（閾値 78 を約半分超える）

### テスト設計

- **`tests/db.test.js`**: `better-sqlite3` をインメモリDBで置き換え、モジュールを `jest.resetModules()` で毎テスト再ロードして独立性を確保
- **`tests/server.test.js`**: `src/db` をモックした上で `server` をランダムポートで起動し、HTTP リクエストと `handleData()` の挙動を検証

`src/index.js` は本アプリと無関係のスタブファイル（`package.json` の `main` 指定のみ）。
