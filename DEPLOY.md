# OpenShift デプロイ手順

## 前提条件

- OpenShift 4.x クラスターへの `oc` アクセス権
- Tekton Pipelines / Tekton Triggers Operator インストール済み
- GitHub リポジトリへの push 権限

---

## 1. 初期セットアップ（クラスター側）

```bash
NAMESPACE=plc-waveform   # 任意の namespace 名に変更

# Namespace 作成 & ログイン
oc new-project $NAMESPACE

# パイプライン ServiceAccount の権限付与
oc policy add-role-to-user system:image-builder \
  system:serviceaccount:$NAMESPACE:pipeline
oc policy add-role-to-user edit \
  system:serviceaccount:$NAMESPACE:pipeline

# Tekton リソースの EventListener が Pod を作成できるよう権限付与
oc policy add-role-to-user system:serviceaccount:$NAMESPACE:pipeline \
  -z pipeline
```

## 2. Secret の作成

### 2-1. GitHub Webhook 署名検証用 Secret

```bash
WEBHOOK_SECRET=$(openssl rand -hex 20)
echo "Webhook Secret: $WEBHOOK_SECRET"   # GitHub に登録する値

oc create secret generic github-webhook-secret \
  --from-literal=secret=$WEBHOOK_SECRET
```

### 2-2. コンテナレジストリ認証（内部レジストリ利用時は不要な場合あり）

```bash
# 内部レジストリを使う場合はサービスアカウントトークンで自動認証されるため、
# 空の Secret を作成するだけでよい
oc create secret generic registry-credentials \
  --from-literal=.dockerconfigjson='{}' \
  --type=kubernetes.io/dockerconfigjson
```

## 3. マニフェストファイルの NAMESPACE 書き換え

```bash
# deploy/ と tekton/ 内の NAMESPACE プレースホルダーを置換
# macOS (BSD sed)
find deploy tekton -name "*.yaml" | xargs sed -i '' "s/NAMESPACE/$NAMESPACE/g"

# Linux (GNU sed)
# find deploy tekton -name "*.yaml" | xargs sed -i "s/NAMESPACE/$NAMESPACE/g"
```

## 4. Tekton リソース適用

```bash
oc apply -f tekton/serviceaccount.yaml
oc apply -f tekton/pipeline.yaml
oc apply -f tekton/trigger-binding.yaml
oc apply -f tekton/trigger-template.yaml
oc apply -f tekton/eventlistener.yaml
oc apply -f tekton/eventlistener-route.yaml

# Webhook URL を確認（HTTPS）
oc get route el-plc-waveform-listener \
  -o jsonpath='https://{.spec.host}/{"\n"}'
```

## 5. GitHub Webhook の設定

GitHub リポジトリ → Settings → Webhooks → Add webhook:

| 項目 | 値 |
|------|-----|
| Payload URL | `https://<上記で確認した Route>/` |
| Content type | `application/json` |
| Secret | 手順 2-1 で生成した値 |
| Events | `Just the push event` |

## 6. 動作確認（手動トリガー）

```bash
# tekton/pipelinerun-manual.yaml の git-url と image-name を編集後
oc create -f tekton/pipelinerun-manual.yaml

# ログ確認
tkn pipelinerun logs -f -L
```

## 7. アプリ URL の確認

```bash
oc get route plc-waveform -o jsonpath='{.spec.host}{"\n"}'
```

---

## 注意事項

### Kafka 接続
Kafka ブローカーアドレスは `KAFKA_BROKERS` 環境変数で設定します（カンマ区切りで複数指定可）。
`deploy/configmap.yaml` の `KAFKA_BROKERS` を実際のブローカーアドレスに変更してください。

**Strimzi / AMQ Streams を使う場合の典型的な設定:**

```yaml
KAFKA_BROKERS: "my-cluster-kafka-bootstrap.kafka.svc:9092"
```

Kafka に接続できない場合は自動的にモックデータへフォールバックします。
モックを強制する場合は `USE_MOCK: "true"` に変更してください。

**TLS 接続が必要な場合**（Strimzi の `tls` リスナー等）は、現在の KafkaJS 設定では
TLS オプションを別途 `server.js` に追加する必要があります。

### SQLite の永続化
`plc-waveform-data` PVC に SQLite データベースを保存します。
Deployment の replicas は **1 のまま** 運用してください（ReadWriteOnce）。

### npm の ClusterTask
OpenShift Pipelines の ClusterTask `npm` が存在しない場合は、
`tekton/pipeline.yaml` の `test` タスクを以下のようなインラインタスクに差し替えてください：

```yaml
- name: test
  runAfter: [clone]
  taskSpec:
    workspaces:
      - name: source
    steps:
      - name: npm-test
        image: registry.access.redhat.com/ubi9/nodejs-20:latest
        workingDir: $(workspaces.source.path)
        script: |
          npm ci
          npm test
  workspaces:
    - name: source
      workspace: source
```
