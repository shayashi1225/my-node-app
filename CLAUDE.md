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

ブラウザで `http://localhost:3000` を開くと波形が表示される。

ローカルで Kafka を起動する場合:

```bash
docker run -d --name kafka -p 9092:9092 apache/kafka:latest
```

## アーキテクチャ

PLCセンサーのリアルタイム波形ビジュアライザー。

```
[Kafka: factory-data] → src/server.js (KafkaJS consumer)
                              ↓ Socket.IO (waveform-data イベント)
                        src/index.html (uPlot でリアルタイム描画)
                              ↓ value > THRESHOLD
                          data.db (SQLite: threshold_events)
```

### データフロー

- **メッセージ形式**: `{ ts: number (Unix ms), value: number }`
- `src/server.js` が Kafka の `factory-data` トピックをコンシュームし、`waveform-data` イベントとして Socket.IO でブロードキャスト
- `src/index.html` は Socket.IO クライアントでイベントを受信し、uPlot のスライディングウィンドウ（MAX_POINTS=500点）でグラフを更新
- uPlot は秒単位の Unix タイムスタンプを要求するため、クライアント側で `ts / 1000` に変換している

### 閾値永続化

`server.js` の `handleData()` が全メッセージを処理し、`value > THRESHOLD` を満たしたものだけ `src/db.js` 経由で SQLite に書き込む。Kafka モード・内部モック両方に適用される。

- **テーブル**: `threshold_events (id, ts, value, recorded_at)`
- **DBファイル**: プロジェクトルートの `data.db`（git 管理外）
- **閾値デフォルト**: `78`（環境変数 `THRESHOLD` で変更可）

```bash
THRESHOLD=50 npm run server
```

### API エンドポイント

| パス | 説明 |
| --- | --- |
| `GET /` | `src/index.html` を返す |
| `GET /api/events?minValue=&maxValue=` | 閾値超過イベントを最大200件、ts降順で返す |
| `GET /api/threshold` | 現在の閾値を `{ threshold: number }` で返す |

### モックデータ

| 方法 | 用途 |
| --- | --- |
| `USE_MOCK=true` (`npm run server:mock`) | Kafka 不要。サーバー内部でサイン波＋ノイズを 100ms 間隔で emit（値域 約28〜52、閾値 78 を超えない） |
| `src/mock-producer.js` (`npm run mock-producer`) | Kafka 必須。ランダムウォーク波形を `factory-data` トピックへ送信（値域 20〜80、1ステップ最大 ±1.5） |

### テスト設計

- **`tests/db.test.js`**: `better-sqlite3` をインメモリDBで置き換え、モジュールを `jest.resetModules()` で毎テスト再ロードして独立性を確保
- **`tests/server.test.js`**: `src/db` をモックした上で `server` をランダムポートで起動し、HTTP リクエストと `handleData()` の挙動を検証

`src/index.js` は本アプリと無関係のスタブファイル（`package.json` の `main` 指定のみ）。
