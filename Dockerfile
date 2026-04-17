FROM registry.access.redhat.com/ubi9/nodejs-20 AS builder

USER root
RUN dnf install -y python3 make gcc-c++ && dnf clean all

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

FROM registry.access.redhat.com/ubi9/nodejs-20

USER root

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY src/ ./src/

RUN mkdir -p /app/data && chown -R 1001:0 /app && chmod -R g=u /app

USER 1001

EXPOSE 3000

ENV USE_MOCK=false \
    DB_PATH=/app/data/data.db \
    PORT=3000 \
    KAFKA_BROKERS=localhost:9092 \
    KAFKA_CLIENT_ID=visualizer \
    KAFKA_GROUP_ID=viz-group

CMD ["node", "src/server.js"]
