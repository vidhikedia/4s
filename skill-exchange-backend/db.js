// Database adapter: supports SQLite (node:sqlite) for local development
// and PostgreSQL (via pg) when DATABASE_URL is set (e.g., Neon in production).
const crypto = require('crypto');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL || '';
const isPostgres = Boolean(
  (DATABASE_URL &&
    (DATABASE_URL.startsWith('postgres://') || DATABASE_URL.startsWith('postgresql://'))) ||
    process.env.TEST_PG === 'pglite'
);

// Canonical PascalCase column names and query aliases
const CANONICAL_NAMES = [
  'StudentID', 'Name', 'Email', 'Department', 'YearOfStudy', 'Bio', 'HostelBlock', 'RoomNo',
  'Password', 'Avatar', 'Phone', 'GithubUrl', 'LinkedinUrl', 'PortfolioUrl', 'Interests',
  'Languages', 'LastSeenAt', 'SkillMasterShown',
  'SkillID', 'SkillName', 'Category',
  'ProficiencyLevel', 'Description', 'Availability', 'Tags', 'SampleTopics', 'YearsOfExperience',
  'DesiredLevel', 'Priority', 'PreferredAvailability', 'TargetGoal',
  'ExchangeID', 'TeacherID', 'LearnerID', 'Status', 'RequestDate', 'Note', 'UpdatedAt',
  'SessionID', 'SessionDate', 'StartTime', 'DurationMins', 'Topic', 'Mode', 'Location',
  'MeetingLink', 'Notes',
  'FeedbackID', 'GivenBy', 'Rating', 'Comments', 'CreatedAt', 'ClarityRating', 'PatienceRating',
  'PunctualityRating', 'WouldRecommend',
  'AvailabilityID', 'DayOfWeek', 'EndTime', 'Label', 'Enabled',
  'MessageID', 'SenderID', 'ReceiverID', 'Body', 'SentAt', 'IsRead',
  'BadgeID', 'Title', 'BadgeClass', 'Criterion', 'TargetValue', 'Unit',
  'EarnedAt', 'ActivityTrigger', 'Icon',
  'NotificationID', 'Type', 'Link', 'RelatedType', 'RelatedID', 'Message',
  // Common query aliases
  'TeacherName', 'TeacherEmail', 'TeacherDept', 'TeacherYear', 'TeacherAvatar',
  'LearnerName', 'LearnerEmail', 'LearnerDept', 'LearnerYear', 'LearnerAvatar',
  'ExchangeStatus', 'AvgRating', 'Reviews', 'Teachers', 'Learners', 'TotalExchanges',
  'Count', 'Pct', 'UnreadCount', 'TaughtCount', 'AttendedCount', 'PartnerID', 'PartnerName', 'PartnerAvatar',
  'PeerID', 'SenderName', 'MutualExchange', 'GivenByName', 'Level'
];

const CANONICAL_MAP = new Map(CANONICAL_NAMES.map(n => [n.toLowerCase(), n]));

function normalizeRow(row) {
  if (!row || typeof row !== 'object') return row;
  const normalized = {};
  for (const [key, value] of Object.entries(row)) {
    const lower = key.toLowerCase();
    const canon = CANONICAL_MAP.get(lower);
    if (canon) {
      normalized[canon] = value;
    } else {
      normalized[key] = value;
    }
  }
  return new Proxy(normalized, {
    get(target, prop) {
      if (typeof prop !== 'string') return target[prop];
      if (prop in target) return target[prop];
      const lower = prop.toLowerCase();
      if (lower in target) return target[lower];
      const canon = CANONICAL_MAP.get(lower);
      if (canon && canon in target) return target[canon];
      for (const k of Object.keys(target)) {
        if (k.toLowerCase() === lower) return target[k];
      }
      return undefined;
    }
  });
}

function transformPlaceholders(sql) {
  let inString = false;
  let result = '';
  let paramIndex = 1;
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    if (char === "'") {
      if (inString && sql[i + 1] === "'") {
        result += "''";
        i++;
        continue;
      }
      inString = !inString;
      result += char;
    } else if (char === '?' && !inString) {
      result += '$' + (paramIndex++);
    } else {
      result += char;
    }
  }
  return result;
}

function transformSqlForPostgres(sql) {
  let s = transformPlaceholders(sql);
  // Replace SQLite datetime('now') and date('now')
  s = s.replace(/\bdatetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
  s = s.replace(/\bdate\('now'\)/gi, 'CURRENT_DATE');
  return s;
}

let db;

if (isPostgres) {
  const pg = require('pg');

  // Configure pg type parsers: parse bigint (OID 20) and numeric (OID 1700) as JavaScript numbers
  pg.types.setTypeParser(20, (val) => (val === null ? null : Number(val)));
  pg.types.setTypeParser(1700, (val) => (val === null ? null : Number(val)));

  // Preserve timestamps and dates as strings consistent with SQLite behavior
  pg.types.setTypeParser(1114, (val) => (val === null ? null : String(val)));
  pg.types.setTypeParser(1184, (val) => (val === null ? null : String(val)));
  pg.types.setTypeParser(1082, (val) => (val === null ? null : String(val)));

  let pool;
  if (process.env.TEST_PG === 'pglite') {
    const { PGlite } = require('@electric-sql/pglite');
    const pgliteInstance = new PGlite({
      parsers: {
        20: (v) => pg.types.getTypeParser(20)(v),
        1700: (v) => pg.types.getTypeParser(1700)(v),
        1114: (v) => pg.types.getTypeParser(1114)(v),
        1184: (v) => pg.types.getTypeParser(1184)(v),
        1082: (v) => pg.types.getTypeParser(1082)(v),
      }
    });
    pool = {
      async query(sql, params = []) {
        return await pgliteInstance.query(sql, params);
      },
      async exec(sql) {
        return await pgliteInstance.exec(sql);
      },
      async end() {
        return await pgliteInstance.close();
      }
    };
  } else {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
    });
  }

  db = {
    isPostgres: true,
    prepare(sql) {
      const pgSql = transformSqlForPostgres(sql);
      return {
        async get(...params) {
          const res = await pool.query(pgSql, params.flat());
          return res.rows[0] ? normalizeRow(res.rows[0]) : undefined;
        },
        async all(...params) {
          const res = await pool.query(pgSql, params.flat());
          return res.rows.map(normalizeRow);
        },
        async run(...params) {
          let executeSql = pgSql.trim();
          const isInsert = /^INSERT\s+INTO\s+/i.test(executeSql);
          const hasReturning = /\bRETURNING\b/i.test(executeSql);
          if (isInsert && !hasReturning) {
            executeSql = executeSql.replace(/;+\s*$/, '') + ' RETURNING *';
          }
          const res = await pool.query(executeSql, params.flat());
          let lastInsertRowid = null;
          if (res.rows && res.rows[0]) {
            const firstRow = res.rows[0];
            const pkKey = Object.keys(firstRow).find(k => k.toLowerCase().endsWith('id')) || Object.keys(firstRow)[0];
            if (pkKey && firstRow[pkKey] != null) {
              const num = Number(firstRow[pkKey]);
              lastInsertRowid = !isNaN(num) ? num : firstRow[pkKey];
            }
          }
          return {
            changes: (res.rowCount != null ? res.rowCount : res.affectedRows) || 0,
            lastInsertRowid,
          };
        }
      };
    },
    async exec(sql) {
      const transformed = transformSqlForPostgres(sql);
      if (pool.exec) {
        return await pool.exec(transformed);
      }
      return await pool.query(transformed);
    },
    async query(sql, params = []) {
      const pgSql = transformSqlForPostgres(sql);
      const res = await pool.query(pgSql, params);
      return res.rows.map(normalizeRow);
    },
    async close() {
      await pool.end();
    }
  };
} else {
  // SQLite mode using Node 22+ built-in DatabaseSync
  const { DatabaseSync } = require('node:sqlite');
  const dbPath = process.env.DB_PATH || path.join(__dirname, 'skillexchange.db');
  const sqliteDb = new DatabaseSync(dbPath);
  sqliteDb.exec('PRAGMA foreign_keys = ON;');

  db = {
    isPostgres: false,
    sqliteDb,
    prepare(sql) {
      const stmt = sqliteDb.prepare(sql);
      return {
        get(...params) {
          return stmt.get(...params);
        },
        all(...params) {
          return stmt.all(...params);
        },
        run(...params) {
          return stmt.run(...params);
        }
      };
    },
    exec(sql) {
      return sqliteDb.exec(sql);
    },
    query(sql, params = []) {
      const stmt = sqliteDb.prepare(sql);
      return stmt.all(...params);
    },
    close() {
      try {
        sqliteDb.close();
      } catch {}
    }
  };
}

// Safe migrations
function safeAddColumn(sql) {
  try {
    const res = db.exec(sql);
    if (res && typeof res.then === 'function') {
      return res.catch((err) => {
        if (err && err.message && (
          err.message.toLowerCase().includes('duplicate column') ||
          err.message.toLowerCase().includes('already exists') ||
          err.message.toLowerCase().includes('no such table') ||
          err.message.toLowerCase().includes('does not exist')
        )) {
          return;
        }
        throw err;
      });
    }
  } catch (err) {
    if (err && err.message && (
      err.message.toLowerCase().includes('duplicate column') ||
      err.message.toLowerCase().includes('already exists') ||
      err.message.toLowerCase().includes('no such table') ||
      err.message.toLowerCase().includes('does not exist')
    )) {
      return;
    }
    throw err;
  }
}

function safeCreateIndex(sql) {
  try {
    const res = db.exec(sql);
    if (res && typeof res.then === 'function') {
      return res.catch((err) => {
        if (err && err.message && (
          err.message.toLowerCase().includes('no such table') ||
          err.message.toLowerCase().includes('does not exist') ||
          err.message.toLowerCase().includes('already exists')
        )) {
          return;
        }
        throw err;
      });
    }
  } catch (err) {
    if (err && err.message && (
      err.message.toLowerCase().includes('no such table') ||
      err.message.toLowerCase().includes('does not exist') ||
      err.message.toLowerCase().includes('already exists')
    )) {
      return;
    }
    throw err;
  }
}

async function safeCreateUniquePartialIndex() {
  try {
    if (isPostgres) {
      await db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_exchange_active_unique ON EXCHANGE(TeacherID, LearnerID, SkillID) WHERE Status IN ('Pending', 'Accepted');");
    } else {
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
    }
  } catch (err) {
    if (err && err.message && (
      err.message.toLowerCase().includes('no such table') ||
      err.message.toLowerCase().includes('does not exist')
    )) {
      return;
    }
    throw err;
  }
}

async function ensureSchema() {
  if (isPostgres) {
    try {
      const res = await pool.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'student' LIMIT 1;");
      if (!res.rows || res.rows.length === 0) {
        const fs = require('fs');
        const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.pg.sql'), 'utf8');
        await db.exec(schemaSql);
      }
    } catch (e) {}
  }
}

async function runMigrations() {
  if (isPostgres) {
    await ensureSchema();
    // Postgres safe migrations
    await safeAddColumn('ALTER TABLE EXCHANGE ADD COLUMN IF NOT EXISTS Note TEXT;');
    await safeAddColumn('ALTER TABLE EXCHANGE ADD COLUMN IF NOT EXISTS UpdatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP;');
    await safeAddColumn('ALTER TABLE NOTIFICATION ADD COLUMN IF NOT EXISTS RelatedType TEXT;');
    await safeAddColumn('ALTER TABLE NOTIFICATION ADD COLUMN IF NOT EXISTS RelatedID TEXT;');
    await safeAddColumn('ALTER TABLE STUDENT ADD COLUMN IF NOT EXISTS LastSeenAt TIMESTAMP;');
    await safeAddColumn('ALTER TABLE STUDENT ADD COLUMN IF NOT EXISTS SkillMasterShown INTEGER DEFAULT 0;');
  } else {
    // SQLite safe migrations
    safeAddColumn('ALTER TABLE EXCHANGE ADD COLUMN Note TEXT;');
    safeAddColumn('ALTER TABLE EXCHANGE ADD COLUMN UpdatedAt TEXT;');
    safeAddColumn('ALTER TABLE NOTIFICATION ADD COLUMN RelatedType TEXT;');
    safeAddColumn('ALTER TABLE NOTIFICATION ADD COLUMN RelatedID TEXT;');
    safeAddColumn('ALTER TABLE STUDENT ADD COLUMN LastSeenAt TEXT;');
    safeAddColumn('ALTER TABLE STUDENT ADD COLUMN SkillMasterShown INTEGER DEFAULT 0;');
  }

  await safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_exchange_skill ON EXCHANGE(SkillID);');
  await safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_exchange_status ON EXCHANGE(Status);');
  await safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_session_exchange ON SESSION(ExchangeID);');
  await safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_session_status_date ON SESSION(Status, SessionDate);');
  await safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_feedback_exchange ON FEEDBACK(ExchangeID);');
  await safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_feedback_givenby ON FEEDBACK(GivenBy);');
  await safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_message_receiver_read ON MESSAGE(ReceiverID, IsRead);');
  await safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_notification_student_read ON NOTIFICATION(StudentID, IsRead);');
  await safeCreateUniquePartialIndex();
}

if (!isPostgres) {
  runMigrations();
}

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

module.exports = {
  db,
  hashPassword,
  verifyPassword,
  runMigrations,
  transformPlaceholders,
  transformSqlForPostgres,
  normalizeRow
};
