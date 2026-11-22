// Uses Node's built-in SQLite (Node 22.13+), so there is nothing to npm install.
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'skillexchange.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON;');

// Safe migrations: ignore "duplicate column" or "no such table" errors for unseeded temp dbs
function safeAddColumn(sql) {
  try {
    db.exec(sql);
  } catch (err) {
    if (err && err.message && (err.message.toLowerCase().includes('duplicate column') || err.message.toLowerCase().includes('no such table'))) {
      return;
    }
    throw err;
  }
}

function safeCreateIndex(sql) {
  try {
    db.exec(sql);
  } catch (err) {
    if (err && err.message && err.message.toLowerCase().includes('no such table')) {
      return;
    }
    throw err;
  }
}

function safeCreateUniquePartialIndex() {
  try {
    const tbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='EXCHANGE'").get();
    if (!tbl) return;
    const dupes = db.prepare(`
      SELECT 1 FROM EXCHANGE 
      WHERE Status IN ('Pending', 'Accepted') 
      GROUP BY TeacherID, LearnerID, SkillID 
      HAVING COUNT(*) > 1 
      LIMIT 1
    `).all();
    if (dupes.length === 0) {
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_exchange_active_unique ON EXCHANGE(TeacherID, LearnerID, SkillID) WHERE Status IN ('Pending', 'Accepted');");
    }
  } catch (err) {
    if (err && err.message && err.message.toLowerCase().includes('no such table')) {
      return;
    }
    throw err;
  }
}

function runMigrations() {
  safeAddColumn('ALTER TABLE EXCHANGE ADD COLUMN Note TEXT;');
  safeAddColumn('ALTER TABLE EXCHANGE ADD COLUMN UpdatedAt TEXT;');
  safeAddColumn('ALTER TABLE NOTIFICATION ADD COLUMN RelatedType TEXT;');
  safeAddColumn('ALTER TABLE NOTIFICATION ADD COLUMN RelatedID TEXT;');
  safeAddColumn('ALTER TABLE STUDENT ADD COLUMN LastSeenAt TEXT;');
  safeAddColumn('ALTER TABLE STUDENT ADD COLUMN SkillMasterShown INTEGER DEFAULT 0;');

  safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_exchange_skill ON EXCHANGE(SkillID);');
  safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_exchange_status ON EXCHANGE(Status);');
  safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_session_exchange ON SESSION(ExchangeID);');
  safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_session_status_date ON SESSION(Status, SessionDate);');
  safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_feedback_exchange ON FEEDBACK(ExchangeID);');
  safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_feedback_givenby ON FEEDBACK(GivenBy);');
  safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_message_receiver_read ON MESSAGE(ReceiverID, IsRead);');
  safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_notification_student_read ON NOTIFICATION(StudentID, IsRead);');
  safeCreateUniquePartialIndex();
}
runMigrations();

// Salted password hashing (built into Node)
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}

module.exports = { db, hashPassword, verifyPassword, runMigrations };
