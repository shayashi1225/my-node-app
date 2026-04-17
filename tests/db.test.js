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
    insert.run(1000000, 85.5, 1);
    const rows = queryEvents();
    expect(rows).toHaveLength(1);
    expect(rows[0].ts).toBe(1000000);
    expect(rows[0].value).toBeCloseTo(85.5);
    expect(rows[0].plc_id).toBe(1);
  });

  test('minValue フィルタ: 指定値以上のみ返す', () => {
    insert.run(1000, 65.0, 1);
    insert.run(2000, 80.0, 1);
    insert.run(3000, 95.0, 1);
    const rows = queryEvents({ minValue: 79 });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.value >= 79)).toBe(true);
  });

  test('maxValue フィルタ: 指定値以下のみ返す', () => {
    insert.run(1000, 65.0, 1);
    insert.run(2000, 80.0, 1);
    insert.run(3000, 95.0, 1);
    const rows = queryEvents({ maxValue: 80 });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.value <= 80)).toBe(true);
  });

  test('minValue + maxValue の範囲フィルタ', () => {
    insert.run(1000, 65.0, 1);
    insert.run(2000, 80.0, 1);
    insert.run(3000, 95.0, 1);
    const rows = queryEvents({ minValue: 70, maxValue: 90 });
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBeCloseTo(80.0);
  });

  test('plcId フィルタ: PLC1 のみ返す', () => {
    insert.run(1000, 80.0, 1);
    insert.run(2000, 82.0, 2);
    insert.run(3000, 84.0, 1);
    const rows = queryEvents({ plcId: 1 });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.plc_id === 1)).toBe(true);
  });

  test('plcId フィルタ: PLC2 のみ返す', () => {
    insert.run(1000, 80.0, 1);
    insert.run(2000, 82.0, 2);
    insert.run(3000, 84.0, 2);
    const rows = queryEvents({ plcId: 2 });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.plc_id === 2)).toBe(true);
  });

  test('plcId + minValue の複合フィルタ', () => {
    insert.run(1000, 80.0, 1);
    insert.run(2000, 90.0, 1);
    insert.run(3000, 85.0, 2);
    const rows = queryEvents({ plcId: 1, minValue: 85 });
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBeCloseTo(90.0);
    expect(rows[0].plc_id).toBe(1);
  });

  test('結果は ts の降順で返す', () => {
    insert.run(1000, 80.0, 1);
    insert.run(3000, 82.0, 1);
    insert.run(2000, 81.0, 1);
    const rows = queryEvents();
    expect(rows[0].ts).toBe(3000);
    expect(rows[1].ts).toBe(2000);
    expect(rows[2].ts).toBe(1000);
  });

  test('200件上限: 250件挿入しても 200件を返す', () => {
    for (let i = 0; i < 250; i++) {
      insert.run(i * 1000, 80.0 + i * 0.01, 1);
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
    insert.run(1000, 80.0, 1);
    insert.run(2000, 81.0, 1);
    const rows = queryEvents();
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(2);
  });

  test('recorded_at が自動セットされる', () => {
    insert.run(1000, 80.0, 1);
    const rows = queryEvents();
    expect(rows[0].recorded_at).toBeTruthy();
  });

  test('複数レコードを連続挿入できる', () => {
    for (let i = 0; i < 5; i++) {
      insert.run(i * 100, 78.0 + i, i % 2 === 0 ? 1 : 2);
    }
    expect(queryEvents()).toHaveLength(5);
  });

  test('plc_id が正しく保存される', () => {
    insert.run(1000, 80.0, 1);
    insert.run(2000, 81.0, 2);
    const all = queryEvents();
    const plcIds = all.map((r) => r.plc_id).sort();
    expect(plcIds).toEqual([1, 2]);
  });
});
