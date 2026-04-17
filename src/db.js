// db.js
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'data.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS threshold_events (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    ts    INTEGER NOT NULL,
    value REAL    NOT NULL,
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const insert = db.prepare('INSERT INTO threshold_events (ts, value) VALUES (?, ?)');

const queryEvents = ({ minValue, maxValue } = {}) => {
  const conditions = [];
  const params = [];
  if (minValue != null) { conditions.push('value >= ?'); params.push(minValue); }
  if (maxValue != null) { conditions.push('value <= ?'); params.push(maxValue); }
  let sql = 'SELECT * FROM threshold_events';
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY ts DESC LIMIT 200';
  return db.prepare(sql).all(...params);
};

module.exports = { insert, queryEvents };
