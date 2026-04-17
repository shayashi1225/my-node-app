# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A real-time PLC waveform visualizer for multiple sensors deployed on OpenShift. Captures Kafka event streams from industrial sensors, persists threshold-crossing events to SQLite, and displays live waveforms with event history to clients.

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
# または podman を使用
podman run -d --name kafka -p 9092:9092 apache/kafka:latest
```

## アーキテクチャ

複数の PLC センサーからのリアルタイム波形ビジュアライザー。各 PLC は独立したデータストリーム・閾値・イベント履歴を持つ。

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
- `src/index.html` は CDN から読み込んだ Socket.IO クライアントと uPlot で両方のストリームを受信し、PLC ごとの独立したスライディングウィンドウ（MAX_POINTS=500点）で表示
- uPlot は秒単位の Unix タイムスタンプを要求するため、クライアント側で `ts / 1000` に変換
- 閾値を超えたデータのみ SQLite に永続化

### 実装上の注意

- HTTP サーバーは Express を使わず Node.js 標準の `http` モジュールで実装されている（Express 不要で軽量）
- `src/server.js` は `{ handleData, server }` をエクスポートしており、テストから直接インポートして利用する
- モックデータは複数の PLC で異なる波形を生成（PLC1 は閾値を超えない、PLC2 は約半分超える）

### 環境変数

| 変数 | デフォルト | 説明 |
| --- | --- | --- |
| `KAFKA_BROKERS` | `localhost:9092` | Kafka ブローカーアドレス（カンマ区切りで複数指定可） |
| `KAFKA_CLIENT_ID` | `visualizer` | Kafka consumer client ID |
| `KAFKA_GROUP_ID` | `viz-group` | Kafka consumer group ID |
| `THRESHOLD_1` | `78` | PLC1 の閾値（THRESHOLD も参照） |
| `THRESHOLD_2` | `78` | PLC2 の閾値 |
| `THRESHOLD` | `78` | PLC1 のデフォルト閾値（THRESHOLD_1 がない場合のフォールバック） |
| `PORT` | `3000` | サーバーリッスンポート |
| `USE_MOCK` | (未設定) | `true` に設定するとモックデータを強制使用 |

```bash
# 使用例
KAFKA_BROKERS="kafka-1:9092,kafka-2:9092" THRESHOLD_1=50 THRESHOLD_2=70 npm run server
KAFKA_CLIENT_ID="my-app" PORT=8080 npm run server
USE_MOCK=true npm run server  # Kafka を完全にスキップ
```

### 閾値永続化

`src/server.js` の `handleData()` が全メッセージを処理し、`value > THRESHOLD_*` を満たしたものだけ `src/db.js` 経由で SQLite に記録。Kafka モード・内部モック両方に適用される。

- **テーブル**: `threshold_events (id, ts, value, plc_id, recorded_at)`
  - `id`: オートインクリメント主キー
  - `ts`: イベント発生時刻（Unix ms）
  - `value`: センサー値
  - `plc_id`: PLC ID（1 または 2）
  - `recorded_at`: DB 記録時刻（自動タイムスタンプ）
- **DBファイル**: プロジェクトルートの `data.db`（git 管理外）
- **マイグレーション**: 既存 DB には `ALTER TABLE` で `plc_id` 列を自動追加
- **クエリ上限**: 単一クエリで最大 200 件を返す（ts 降順）

### API エンドポイント

| パス | パラメータ | 説明 |
| --- | --- | --- |
| `GET /` | — | `src/index.html` を返す |
| `GET /api/events` | `plcId`, `minValue`, `maxValue` | 指定 PLC の閾値超過イベントを最大200件、ts降順で返す |
| `GET /api/thresholds` | — | 両方の PLC の閾値を `{ plc1: number, plc2: number }` で返す |
| `GET /api/threshold` | — | PLC1 の閾値を `{ threshold: number }` で返す（後方互換性） |

**例**:
```bash
curl http://localhost:3000/api/events?plcId=1&minValue=70&maxValue=90
curl http://localhost:3000/api/thresholds
```

### モックデータ

モード選択: `USE_MOCK=true` (`npm run server:mock`) で内部生成、または `npm run mock-producer` で Kafka に送信

**内部モック** (100ms 間隔):
- **PLC1**: サイン波 `40 + sin(t/1000) * 10 + ノイズ`、値域 約29〜51（閾値 78 を超えない）
- **PLC2**: コサイン波 `72 + cos(t/800) * 12 + ノイズ`、値域 約57〜85（閾値 78 を約半分超える）

**mock-producer.js** (Kafka 送信モード):
- `KAFKA_BROKERS` と `KAFKA_CLIENT_ID` で設定可能
- **PLC1**: ランダムウォーク、値域 20〜80（±1.5/ステップ）
- **PLC2**: ランダムウォーク、値域 55〜90（±1.5/ステップ）

### テスト設計

- **`tests/db.test.js`**: 
  - `better-sqlite3` をインメモリDB で置き換え、ファイル生成をスキップ
  - モジュールを `jest.resetModules()` で毎テスト再ロードして独立性を確保
  - queryEvents の条件フィルタ・上限・順序を検証

- **`tests/server.test.js`**: 
  - `src/db` モジュールをモック
  - server をランダムポートで起動し、HTTP リクエストと `handleData()` の挙動を検証
  - PLC ごとの閾値判定、API 応答を確認

### OpenShift デプロイ

詳細は `DEPLOY.md` を参照。概要:

- **Tekton Pipelines** で GitHub push → ビルド → デプロイ
- **Secrets**: GitHub webhook 署名検証用、レジストリ認証
- **ConfigMap**: 環境変数（KAFKA_BROKERS 等）を管理
- **PVC**: SQLite `data.db` を永続化（replicas=1 で単一インスタンス運用）
- **EventListener Route**: HTTPS エッジ終端で Webhook 受信

### ファイル構成

- `src/server.js`: メインサーバー、Kafka consumer、HTTP API、Socket.IO
- `src/db.js`: SQLite ラッパー、insert/queryEvents
- `src/index.html`: フロントエンド、uPlot グラフ、Socket.IO クライアント、イベント検索
- `src/mock-producer.js`: Kafka 疑似データプロデューサー
- `src/index.js`: スタブファイル（package.json の main 指定のみ）
- `tests/db.test.js`: DB 機能テスト
- `tests/server.test.js`: API・handleData テスト
- `DEPLOY.md`: OpenShift デプロイ手順

### 設定

`.claude/settings.local.json` で以下の bash コマンドを許可:
- `npm run *` — npm スクリプト実行
- `podman ps *` — Podman 確認
- `curl -s http://localhost:3000/api/thresholds` — API テスト
- `xargs kill *` — プロセス停止
