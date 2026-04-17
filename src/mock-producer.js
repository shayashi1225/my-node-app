// mock-producer.js
// Kafka が起動している環境で factory-data トピックへ疑似PLCデータを流す
const { Kafka } = require('kafkajs');

const kafka = new Kafka({ clientId: 'mock-producer', brokers: ['localhost:9092'] });
const producer = kafka.producer();

const INTERVAL_MS = 100; // 送信間隔 (ms)
const TOPIC = 'factory-data';

// ランダムウォークで PLC センサ値を模擬
const MIN = 20;
const MAX = 80;
const MAX_STEP = 1.5; // 1ステップあたりの最大変化量

let currentValue = (MIN + MAX) / 2;

const generateValue = () => {
  currentValue += (Math.random() - 0.5) * 2 * MAX_STEP;
  currentValue = Math.max(MIN, Math.min(MAX, currentValue));
  return currentValue;
};

const run = async () => {
  await producer.connect();
  console.log(`Mock producer started — publishing to "${TOPIC}" every ${INTERVAL_MS}ms`);
  console.log('Press Ctrl+C to stop.');

  setInterval(async () => {
    const ts = Date.now();
    const message = { ts, value: generateValue() };
    await producer.send({
      topic: TOPIC,
      messages: [{ value: JSON.stringify(message) }],
    });
  }, INTERVAL_MS);
};

run().catch((err) => {
  console.error('Failed to start mock producer:', err.message);
  process.exit(1);
});
