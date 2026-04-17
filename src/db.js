// db.js
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'data.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS threshold_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          INTEGER NOT NULL,
    value       REAL    NOT NULL,
    plc_id      INTEGER NOT NULL DEFAULT 1,
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// 既存DBへのマイグレーション（plc_id列がなければ追加）
try { db.exec('ALTER TABLE threshold_events ADD COLUMN plc_id INTEGER NOT NULL DEFAULT 1'); } catch (_) {}

const insert = db.prepare('INSERT INTO threshold_events (ts, value, plc_id) VALUES (?, ?, ?)');

const queryEvents = ({ minValue, maxValue, plcId } = {}) => {
  const conditions = [];
  const params = [];
  if (plcId != null)    { conditions.push('plc_id = ?');  params.push(plcId); }
  if (minValue != null) { conditions.push('value >= ?');   params.push(minValue); }
  if (maxValue != null) { conditions.push('value <= ?');   params.push(maxValue); }
  let sql = 'SELECT * FROM threshold_events';
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY ts DESC LIMIT 200';
  return db.prepare(sql).all(...params);
};

module.exports = { insert, queryEvents };
