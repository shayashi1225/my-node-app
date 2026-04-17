'use strict';

const http = require('http');

// db モジュールをモック（サーバー require より前に宣言する必要あり）
jest.mock('../src/db', () => ({
  insert: { run: jest.fn() },
  queryEvents: jest.fn(),
}));

const { insert, queryEvents } = require('../src/db');
const { handleData, server } = require('../src/server');

// ランダムポートでサーバーを起動
let port;
beforeAll((done) => {
  server.listen(0, () => {
    port = server.address().port;
    done();
  });
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();
  queryEvents.mockReturnValue([]);
});

// -------------------------------------------------------
// handleData()
// -------------------------------------------------------
describe('handleData()', () => {
  const DEFAULT_THRESHOLD = 78;

  test('value > THRESHOLD のとき insert.run を呼ぶ', () => {
    handleData({ ts: 1000, value: DEFAULT_THRESHOLD + 1 });
    expect(insert.run).toHaveBeenCalledTimes(1);
    expect(insert.run).toHaveBeenCalledWith(1000, DEFAULT_THRESHOLD + 1);
  });

  test('value === THRESHOLD のとき insert.run を呼ばない', () => {
    handleData({ ts: 1000, value: DEFAULT_THRESHOLD });
    expect(insert.run).not.toHaveBeenCalled();
  });

  test('value < THRESHOLD のとき insert.run を呼ばない', () => {
    handleData({ ts: 1000, value: DEFAULT_THRESHOLD - 1 });
    expect(insert.run).not.toHaveBeenCalled();
  });

  test('連続呼び出しで閾値超えのみカウントされる', () => {
    handleData({ ts: 1000, value: 50 });  // 超えない
    handleData({ ts: 2000, value: 90 });  // 超える
    handleData({ ts: 3000, value: 75 });  // 超えない
    handleData({ ts: 4000, value: 85 });  // 超える
    expect(insert.run).toHaveBeenCalledTimes(2);
  });
});

// -------------------------------------------------------
// HTTP ヘルパー
// -------------------------------------------------------
const get = (path) =>
  new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${port}${path}`, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () =>
        resolve({ status: res.statusCode, headers: res.headers, body })
      );
    });
    req.on('error', reject);
  });

// -------------------------------------------------------
// GET /api/threshold
// -------------------------------------------------------
describe('GET /api/threshold', () => {
  test('200 を返す', async () => {
    const { status } = await get('/api/threshold');
    expect(status).toBe(200);
  });

  test('Content-Type が application/json', async () => {
    const { headers } = await get('/api/threshold');
    expect(headers['content-type']).toMatch(/application\/json/);
  });

  test('threshold フィールドが数値で返る', async () => {
    const { body } = await get('/api/threshold');
    const json = JSON.parse(body);
    expect(json).toHaveProperty('threshold');
    expect(typeof json.threshold).toBe('number');
  });
});

// -------------------------------------------------------
// GET /api/events
// -------------------------------------------------------
describe('GET /api/events', () => {
  test('200 を返す', async () => {
    const { status } = await get('/api/events');
    expect(status).toBe(200);
  });

  test('queryEvents の結果を JSON で返す', async () => {
    queryEvents.mockReturnValue([{ id: 1, ts: 1000, value: 85 }]);
    const { body } = await get('/api/events');
    expect(JSON.parse(body)).toEqual([{ id: 1, ts: 1000, value: 85 }]);
  });

  test('?minValue=80 を数値に変換して queryEvents に渡す', async () => {
    await get('/api/events?minValue=80');
    expect(queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ minValue: 80 })
    );
  });

  test('?maxValue=90 を数値に変換して queryEvents に渡す', async () => {
    await get('/api/events?maxValue=90');
    expect(queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ maxValue: 90 })
    );
  });

  test('?minValue=70&maxValue=90 を両方渡す', async () => {
    await get('/api/events?minValue=70&maxValue=90');
    expect(queryEvents).toHaveBeenCalledWith({ minValue: 70, maxValue: 90 });
  });

  test('クエリなしは minValue/maxValue が undefined', async () => {
    await get('/api/events');
    expect(queryEvents).toHaveBeenCalledWith({
      minValue: undefined,
      maxValue: undefined,
    });
  });
});

// -------------------------------------------------------
// 存在しないパス
// -------------------------------------------------------
describe('不明なパス', () => {
  test('404 を返す', async () => {
    const { status } = await get('/no-such-route');
    expect(status).toBe(404);
  });
});
