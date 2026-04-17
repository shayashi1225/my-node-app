// mock-producer.js
// Kafka が起動している環境で factory-data / factory-data-2 トピックへ疑似PLCデータを流す
const { Kafka } = require('kafkajs');

const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const kafka = new Kafka({ clientId: process.env.KAFKA_CLIENT_ID || 'mock-producer', brokers });
const producer = kafka.producer();

const INTERVAL_MS = 100;
const MAX_STEP = 1.5;

// PLC1: ランダムウォーク、値域 20–80
let value1 = 50;
const genPLC1 = () => {
  value1 += (Math.random() - 0.5) * 2 * MAX_STEP;
  value1 = Math.max(20, Math.min(80, value1));
  return value1;
};

// PLC2: ランダムウォーク、値域 55–90（閾値78付近で推移）
let value2 = 72;
const genPLC2 = () => {
  value2 += (Math.random() - 0.5) * 2 * MAX_STEP;
  value2 = Math.max(55, Math.min(90, value2));
  return value2;
};

const run = async () => {
  await producer.connect();
  console.log(`Mock producer started — publishing to "factory-data" and "factory-data-2" every ${INTERVAL_MS}ms`);
  console.log('Press Ctrl+C to stop.');

  setInterval(async () => {
    const ts = Date.now();
    await Promise.all([
      producer.send({ topic: 'factory-data',   messages: [{ value: JSON.stringify({ ts, value: genPLC1() }) }] }),
      producer.send({ topic: 'factory-data-2', messages: [{ value: JSON.stringify({ ts, value: genPLC2() }) }] }),
    ]);
  }, INTERVAL_MS);
};

run().catch((err) => {
  console.error('Failed to start mock producer:', err.message);
  process.exit(1);
});
