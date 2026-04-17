'use strict';

// better-sqlite3 をインメモリDBで置き換えてファイルを生成しない
jest.mock('better-sqlite3', () => {
  const Real = jest.requireActual('better-sqlite3');
  return jest.fn().mockImplementation(() => new Real(':memory:'));
});

let insert, queryEvents;

beforeEach(() => {
  // 各テストで新鮮なインメモリDBを使うためモジュールを再ロード
  jest.resetModules();
  jest.mock('better-sqlite3', () => {
    const Real = jest.requireActual('better-sqlite3');
    return jest.fn().mockImplementation(() => new Real(':memory:'));
  });
  ({ insert, queryEvents } = require('../src/db'));
});

describe('queryEvents()', () => {
  test('空のDBでは空配列を返す', () => {
    expect(queryEvents()).toEqual([]);
  });

  test('insert したデータを取得できる', () => {
    insert.run(1000000, 85.5);
    const rows = queryEvents();
    expect(rows).toHaveLength(1);
    expect(rows[0].ts).toBe(1000000);
    expect(rows[0].value).toBeCloseTo(85.5);
  });

  test('minValue フィルタ: 指定値以上のみ返す', () => {
    insert.run(1000, 65.0);
    insert.run(2000, 80.0);
    insert.run(3000, 95.0);
    const rows = queryEvents({ minValue: 79 });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.value >= 79)).toBe(true);
  });

  test('maxValue フィルタ: 指定値以下のみ返す', () => {
    insert.run(1000, 65.0);
    insert.run(2000, 80.0);
    insert.run(3000, 95.0);
    const rows = queryEvents({ maxValue: 80 });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.value <= 80)).toBe(true);
  });

  test('minValue + maxValue の範囲フィルタ', () => {
    insert.run(1000, 65.0);
    insert.run(2000, 80.0);
    insert.run(3000, 95.0);
    const rows = queryEvents({ minValue: 70, maxValue: 90 });
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBeCloseTo(80.0);
  });

  test('結果は ts の降順で返す', () => {
    insert.run(1000, 80.0);
    insert.run(3000, 82.0);
    insert.run(2000, 81.0);
    const rows = queryEvents();
    expect(rows[0].ts).toBe(3000);
    expect(rows[1].ts).toBe(2000);
    expect(rows[2].ts).toBe(1000);
  });

  test('200件上限: 250件挿入しても 200件を返す', () => {
    for (let i = 0; i < 250; i++) {
      insert.run(i * 1000, 80.0 + i * 0.01);
    }
    const rows = queryEvents();
    expect(rows).toHaveLength(200);
  });

  test('フィルタなし引数でもエラーにならない', () => {
    expect(() => queryEvents({})).not.toThrow();
    expect(() => queryEvents({ minValue: undefined })).not.toThrow();
  });
});

describe('insert', () => {
  test('id が自動採番される', () => {
    insert.run(1000, 80.0);
    insert.run(2000, 81.0);
    const rows = queryEvents();
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(2);
  });

  test('recorded_at が自動セットされる', () => {
    insert.run(1000, 80.0);
    const rows = queryEvents();
    expect(rows[0].recorded_at).toBeTruthy();
  });

  test('複数レコードを連続挿入できる', () => {
    for (let i = 0; i < 5; i++) {
      insert.run(i * 100, 78.0 + i);
    }
    expect(queryEvents()).toHaveLength(5);
  });
});
