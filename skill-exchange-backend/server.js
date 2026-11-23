// Campus Skill Exchange API - zero dependencies (Node 22.13+) / PostgreSQL (Neon).
// Start with: npm start   (after: npm run seed)
const http = require('http');
const crypto = require('crypto');
const { db, hashPassword, verifyPassword, runMigrations } = require('./db');
if (typeof runMigrations === 'function') runMigrations().catch(() => {});

const PORT = process.env.PORT || 3000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

// JWT Secret setup
const isProduction = process.env.NODE_ENV === 'production';
let JWT_SECRET = process.env.JWT_SECRET;
if (isProduction && !JWT_SECRET) {
  console.error('Fatal: JWT_SECRET environment variable is required in production');
  process.exit(1);
}
if (!JWT_SECRET) {
  JWT_SECRET = '4s-dev-jwt-secret-key-change-in-prod';
  console.warn('Warning: JWT_SECRET not set, using default development secret');
}

function base64UrlEncode(str) {
  return Buffer.from(str, 'utf8').toString('base64url');
}

function base64UrlDecode(str) {
  return Buffer.from(str, 'base64url').toString('utf8');
}

function createToken(studentId, email) {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(JSON.stringify({
    studentId: Number(studentId),
    email: String(email).toLowerCase(),
    iat: now,
    exp: now + 7 * 24 * 60 * 60, // 7-day expiry
  }));
  const data = `${header}.${payload}`;
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
  return `${data}.${signature}`;
}

function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signature] = parts;
  const data = `${headerB64}.${payloadB64}`;
  const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(payloadB64));
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || now > payload.exp) return null;
    if (!payload.studentId) return null;
    return payload;
  } catch {
    return null;
  }
}

function getClientIp(req) {
  if (process.env.TRUST_PROXY === 'true' && req.headers['x-forwarded-for']) {
    return req.headers['x-forwarded-for'].split(',')[0].trim();
  }
  return req.socket?.remoteAddress || '127.0.0.1';
}

// In-memory rate limiter (resets on server restart)
const loginFailures = new Map();

function checkLoginRateLimit(email, ip) {
  const key = `${email}:${ip}`;
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const attempts = (loginFailures.get(key) || []).filter((ts) => now - ts < windowMs);
  loginFailures.set(key, attempts);
  if (attempts.length >= 10) {
    throw new HttpError(429, 'Too many failed login attempts. Please try again after 15 minutes.');
  }
}

function recordLoginFailure(email, ip) {
  const key = `${email}:${ip}`;
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const attempts = (loginFailures.get(key) || []).filter((ts) => now - ts < windowMs);
  attempts.push(now);
  loginFailures.set(key, attempts);
}

function clearLoginFailures(email, ip) {
  const key = `${email}:${ip}`;
  loginFailures.delete(key);
}

const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const regex = new RegExp(
    '^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$'
  );
  routes.push({ method, regex, keys, handler });
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);
const notFound = (msg) => new HttpError(404, msg);

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) reject(bad('Body too large')); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(bad('Invalid JSON body')); }
    });
  });
}

function send(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': FRONTEND_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  });
  res.end(payload === undefined ? '' : JSON.stringify(payload));
}

const required = (obj, ...fields) => {
  for (const f of fields) {
    if (obj[f] === undefined || obj[f] === null || obj[f] === '') throw bad(`${f} is required`);
  }
};

const LEVELS = ['Beginner', 'Intermediate', 'Advanced', 'Expert'];
function normalizeLevel(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (String(value).toLowerCase() === 'mastery') return 'Expert';
  const hit = LEVELS.find((l) => l.toLowerCase() === String(value).toLowerCase());
  if (!hit) throw bad('Invalid proficiency level');
  return hit;
}

const STUDENT_COLS = `
  StudentID, Name, Email, Department, YearOfStudy, Bio, HostelBlock, RoomNo,
  Avatar, Phone, GithubUrl, LinkedinUrl, PortfolioUrl, Interests, Languages, LastSeenAt, SkillMasterShown
`;

const PUBLIC_STUDENT_COLS = `
  StudentID, Name, Department, YearOfStudy, Bio, HostelBlock, RoomNo,
  Avatar, GithubUrl, LinkedinUrl, PortfolioUrl, Interests, Languages, LastSeenAt, SkillMasterShown
`;

function isStudentOnline(lastSeenAt) {
  if (!lastSeenAt) return false;
  let lastTime;
  if (lastSeenAt instanceof Date) {
    lastTime = lastSeenAt.getTime();
  } else {
    const str = String(lastSeenAt).trim();
    if (str.endsWith('Z') || /[+-]\d{2}(?::?\d{2})?$/.test(str)) {
      lastTime = new Date(str).getTime();
    } else {
      const iso = str.includes('T') ? str : str.replace(' ', 'T');
      const utcIso = iso + 'Z';
      lastTime = new Date(utcIso).getTime();
    }
  }
  if (isNaN(lastTime)) return false;
  return Math.abs(Date.now() - lastTime) <= 2 * 60 * 1000;
}

async function touchStudentLastSeen(studentId) {
  if (!studentId) return;
  const sid = Number(studentId);
  if (!sid || isNaN(sid)) return;
  try {
    await db.prepare("UPDATE STUDENT SET LastSeenAt = datetime('now') WHERE StudentID = ?").run(sid);
  } catch {}
}

const getStudent = async (id) => {
  const s = await db.prepare(`SELECT ${STUDENT_COLS} FROM STUDENT WHERE StudentID = ?`).get(id);
  if (!s) throw notFound('Student not found');
  return s;
};

const getExchange = async (id) => {
  const e = await db.prepare('SELECT * FROM EXCHANGE WHERE ExchangeID = ?').get(id);
  if (!e) throw notFound('Exchange not found');
  return e;
};

async function findOrCreateSkill(skillName, category) {
  const name = String(skillName || '').trim();
  if (!name) throw bad('skillName is required');
  const existing = await db.prepare('SELECT * FROM SKILL WHERE lower(SkillName) = lower(?)').get(name);
  if (existing) return existing;
  const r = await db.prepare('INSERT INTO SKILL (SkillName, Category) VALUES (?,?)')
    .run(name, category ?? null);
  return await db.prepare('SELECT * FROM SKILL WHERE SkillID = ?').get(r.lastInsertRowid);
}

async function resolveSkill(body) {
  if (body.skillId) {
    const sk = await db.prepare('SELECT * FROM SKILL WHERE SkillID = ?').get(body.skillId);
    if (!sk) throw bad('Referenced student, skill or exchange does not exist');
    return sk;
  }
  const name = body.skillName || body.name || body.skill;
  if (name) return await findOrCreateSkill(name, body.category);
  throw bad('skillId or skillName is required');
}

function initials(name) {
  return String(name || 'ST').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}

function displayStudentId(id) {
  return 'STU' + String(id).padStart(3, '0');
}

const AVATAR_BGS = ['avatar-indigo', 'avatar-purple', 'avatar-blue', 'avatar-teal', 'avatar-emerald', 'avatar-amber'];
function avatarBg(id) {
  return AVATAR_BGS[(Number(id) || 0) % AVATAR_BGS.length];
}

async function computePowerLevel(studentId, taughtCount, attendedCount, skillsOfferedCount) {
  const badgesRow = await db.prepare('SELECT COUNT(*) AS c FROM STUDENT_BADGE WHERE StudentID = ?').get(studentId);
  const badgesCount = badgesRow ? badgesRow.c : 0;
  const raw = 100 + (25 * taughtCount) + (15 * attendedCount) + (30 * badgesCount) + (10 * skillsOfferedCount);
  const powerLevel = Math.min(1000, raw);
  let rank = 'Novice Swapper';
  if (powerLevel >= 650) rank = 'Master Peer Mentor';
  else if (powerLevel >= 400) rank = 'Campus Adept';
  else if (powerLevel >= 200) rank = 'Skill Explorer';
  return { powerLevel, powerLevelMax: 1000, rank, title: rank, badgeCount: badgesCount };
}

async function teacherRating(studentId) {
  const row = await db.prepare(
    `SELECT ROUND(AVG(f.Rating), 2) AS AvgRating, COUNT(f.FeedbackID) AS Reviews
     FROM EXCHANGE e
     JOIN FEEDBACK f ON f.ExchangeID = e.ExchangeID AND f.GivenBy = e.LearnerID
     WHERE e.TeacherID = ?`
  ).get(studentId);
  const reviews = row?.Reviews || 0;
  const avgRating = (reviews > 0 && row?.AvgRating != null) ? Number(row.AvgRating) : null;
  return { avgRating, reviews, reviewCount: reviews, reviewsCount: reviews };
}

async function sessionCounts(studentId) {
  const taughtRow = await db.prepare(
    `SELECT COUNT(*) AS n FROM SESSION s JOIN EXCHANGE e ON e.ExchangeID = s.ExchangeID
     WHERE e.TeacherID = ? AND s.Status = 'Completed'`
  ).get(studentId);
  const attendedRow = await db.prepare(
    `SELECT COUNT(*) AS n FROM SESSION s JOIN EXCHANGE e ON e.ExchangeID = s.ExchangeID
     WHERE e.LearnerID = ? AND s.Status = 'Completed'`
  ).get(studentId);
  return { sessionsTaught: taughtRow ? taughtRow.n : 0, sessionsAttended: attendedRow ? attendedRow.n : 0 };
}

const SESSION_SELECT = `
  SELECT s.*, e.TeacherID, e.LearnerID, e.SkillID, e.Status AS ExchangeStatus,
         t.Name AS TeacherName, t.Department AS TeacherDept, t.YearOfStudy AS TeacherYear,
         l.Name AS LearnerName, l.Department AS LearnerDept, l.YearOfStudy AS LearnerYear,
         sk.SkillName
  FROM SESSION s
  JOIN EXCHANGE e ON e.ExchangeID = s.ExchangeID
  JOIN STUDENT t ON t.StudentID = e.TeacherID
  JOIN STUDENT l ON l.StudentID = e.LearnerID
  JOIN SKILL sk ON sk.SkillID = e.SkillID`;

function mapSession(row, viewerId) {
  const viewer = Number(viewerId);
  const isTeacher = viewer === row.TeacherID;
  const partnerName = isTeacher ? row.LearnerName : row.TeacherName;
  const partnerDept = isTeacher
    ? [row.LearnerDept, row.LearnerYear].filter(Boolean).join(' • ')
    : [row.TeacherDept, row.TeacherYear].filter(Boolean).join(' • ');
  const uiStatus = row.Status === 'Scheduled' ? 'Upcoming' : row.Status;
  const timeLabel = row.StartTime
    ? `${row.StartTime}${row.DurationMins ? ` • ${row.DurationMins} mins` : ''}`
    : '';
  const sesId = `SES-${String(row.SessionID).padStart(4, '0')}`;
  const matId = `MAT-${String(row.ExchangeID).padStart(4, '0')}`;
  const tchId = `TCH-${String(row.ExchangeID).padStart(4, '0')}`;
  const crsId = `CRS${String(row.SkillID).padStart(3, '0')}`;

  return {
    ...row,
    id: sesId,
    sessionId: sesId,
    Session_ID: sesId,
    matchId: matId,
    Match_ID: matId,
    teachingId: tchId,
    SS_ID: tchId,
    courseId: crsId,
    Skill_ID: crsId,
    skill: row.SkillName,
    topic: row.Topic || row.SkillName,
    teacher: row.TeacherName,
    teacherAvatar: initials(row.TeacherName),
    learner: row.LearnerName,
    learnerAvatar: initials(row.LearnerName),
    teacherStudentId: displayStudentId(row.TeacherID),
    learnerStudentId: displayStudentId(row.LearnerID),
    partnerStudentId: isTeacher ? displayStudentId(row.LearnerID) : displayStudentId(row.TeacherID),
    partnerName,
    partnerDept,
    partnerAvatar: initials(partnerName),
    partnerRole: isTeacher ? 'Learner' : 'Teacher',
    userRole: isTeacher ? 'Teacher' : 'Learner',
    date: row.SessionDate,
    time: timeLabel || 'To be confirmed',
    duration: `${row.DurationMins || 60} mins`,
    status: uiStatus,
    mode: row.Mode === 'Online' ? 'Google Meet' : (row.Location || 'Campus'),
    link: row.MeetingLink || row.Location || '',
    notes: row.Notes || row.Topic || '',
  };
}

function isFutureSession(row, now = new Date()) {
  if (row.Status !== 'Scheduled') return false;
  if (!row.SessionDate) return false;
  const dateStr = String(row.SessionDate).trim();
  const timeStr = String(row.StartTime || '').trim();

  let hours = 23;
  let minutes = 59;
  let seconds = 59;

  if (timeStr) {
    const match24 = timeStr.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (match24) {
      hours = parseInt(match24[1], 10);
      minutes = parseInt(match24[2], 10);
      seconds = match24[3] ? parseInt(match24[3], 10) : 0;
    } else {
      const match12 = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
      if (match12) {
        hours = parseInt(match12[1], 10);
        minutes = parseInt(match12[2], 10);
        seconds = 0;
        const ampm = match12[3].toUpperCase();
        if (ampm === 'PM' && hours < 12) hours += 12;
        if (ampm === 'AM' && hours === 12) hours = 0;
      }
    }
  }

  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return false;
  const sessionDateTime = new Date(parts[0], parts[1] - 1, parts[2], hours, minutes, seconds);
  return sessionDateTime.getTime() > now.getTime();
}

async function offeredRows(studentId) {
  return await db.prepare(
    `SELECT sk.SkillID, sk.SkillName, sk.Category, so.ProficiencyLevel AS Level,
            so.Description, so.Availability, so.Tags, so.SampleTopics, so.YearsOfExperience
     FROM SKILL_OFFERED so JOIN SKILL sk ON sk.SkillID = so.SkillID
     WHERE so.StudentID = ?`
  ).all(studentId);
}

async function wantedRows(studentId) {
  return await db.prepare(
    `SELECT sk.SkillID, sk.SkillName, sk.Category, sw.DesiredLevel AS Level,
            sw.Description, sw.Priority, sw.PreferredAvailability, sw.TargetGoal,
            (SELECT e.ExchangeID FROM EXCHANGE e
              WHERE e.LearnerID = sw.StudentID AND e.SkillID = sw.SkillID
              ORDER BY CASE WHEN e.Status IN ('Pending', 'Accepted') THEN 0 ELSE 1 END, e.ExchangeID DESC LIMIT 1) AS ExchangeID,
            (SELECT e.Status FROM EXCHANGE e
              WHERE e.LearnerID = sw.StudentID AND e.SkillID = sw.SkillID
              ORDER BY CASE WHEN e.Status IN ('Pending', 'Accepted') THEN 0 ELSE 1 END, e.ExchangeID DESC LIMIT 1) AS ExchangeStatus,
            (SELECT e.TeacherID FROM EXCHANGE e
              WHERE e.LearnerID = sw.StudentID AND e.SkillID = sw.SkillID
              ORDER BY CASE WHEN e.Status IN ('Pending', 'Accepted') THEN 0 ELSE 1 END, e.ExchangeID DESC LIMIT 1) AS TeacherID,
            (SELECT st.Name FROM EXCHANGE e JOIN STUDENT st ON st.StudentID = e.TeacherID
              WHERE e.LearnerID = sw.StudentID AND e.SkillID = sw.SkillID
              ORDER BY CASE WHEN e.Status IN ('Pending', 'Accepted') THEN 0 ELSE 1 END, e.ExchangeID DESC LIMIT 1) AS TeacherName
     FROM SKILL_WANTED sw JOIN SKILL sk ON sk.SkillID = sw.SkillID
     WHERE sw.StudentID = ?`
  ).all(studentId);
}

function mapWanted(row, studentId) {
  let status = 'Open';
  if (row.ExchangeStatus === 'Accepted') status = 'Matched';
  else if (row.ExchangeStatus === 'Pending') status = 'Pending';
  else if (row.ExchangeStatus === 'Completed') status = 'Completed';
  const lrnId = `LRN-${String(row.SkillID).padStart(4, '0')}`;
  const crsId = `CRS${String(row.SkillID).padStart(3, '0')}`;

  return {
    ...row,
    id: `req-${row.SkillID}`,
    learningId: lrnId,
    Request_ID: lrnId,
    studentId: studentId ? displayStudentId(studentId) : null,
    Student_ID: studentId ? displayStudentId(studentId) : null,
    courseId: crsId,
    Skill_ID: crsId,
    name: row.SkillName,
    category: row.Category,
    currentLevel: 'Beginner',
    desiredLevel: row.Level,
    Desired_Level: row.Level,
    preferredLevel: row.Level,
    priority: row.Priority || 'Medium',
    Priority_Level: row.Priority || 'Medium',
    status,
    description: row.Description || '',
    Description: row.Description || '',
    targetGoal: row.TargetGoal || row.Description || '',
    learningGoal: row.TargetGoal || row.Description || '',
    preferredAvailability: row.PreferredAvailability || 'Flexible',
    teacherId: row.TeacherID || null,
    TeacherID: row.TeacherID || null,
    teacherName: row.TeacherName || null,
    TeacherName: row.TeacherName || null,
    teacherStudentId: row.TeacherID ? displayStudentId(row.TeacherID) : null,
  };
}

async function mapOffered(row, studentId) {
  const helpedRow = await db.prepare(
    `SELECT COUNT(*) AS n FROM EXCHANGE
     WHERE TeacherID = ? AND SkillID = ? AND Status IN ('Accepted','Completed')`
  ).get(studentId, row.SkillID);
  const helped = helpedRow ? helpedRow.n : 0;
  const tchId = `TCH-${String(row.SkillID).padStart(4, '0')}`;
  const crsId = `CRS${String(row.SkillID).padStart(3, '0')}`;
  const tags = row.Tags ? row.Tags.split(',').map((t) => t.trim()) : [row.Category, row.SkillName];
  const sampleTopics = row.SampleTopics ? row.SampleTopics.split(',').map((t) => t.trim()) : [];
  const ratingInfo = await teacherRating(studentId);

  return {
    ...row,
    id: `teach-${row.SkillID}`,
    skillId: row.SkillID,
    teachingId: tchId,
    displayId: tchId,
    SS_ID: tchId,
    studentId: displayStudentId(studentId),
    Student_ID: displayStudentId(studentId),
    courseId: crsId,
    Skill_ID: crsId,
    name: row.SkillName,
    category: row.Category,
    proficiency: row.Level,
    Proficiency_Level: row.Level,
    level: row.Level,
    experience: row.YearsOfExperience || 1,
    Years_of_Experience: row.YearsOfExperience || 1,
    description: row.Description || '',
    Description: row.Description || '',
    availability: row.Availability || 'Flexible',
    learnersHelped: helped,
    rating: ratingInfo.reviews > 0 ? Number(ratingInfo.avgRating).toFixed(2) : null,
    reviewsCount: ratingInfo.reviews || 0,
    reviewCount: ratingInfo.reviews || 0,
    tags,
    sampleTopics,
  };
}

function WEEKDAYS() {
  return [
    { day: 'Monday', dayShort: 'Mon' },
    { day: 'Tuesday', dayShort: 'Tue' },
    { day: 'Wednesday', dayShort: 'Wed' },
    { day: 'Thursday', dayShort: 'Thu' },
    { day: 'Friday', dayShort: 'Fri' },
    { day: 'Saturday', dayShort: 'Sat' },
    { day: 'Sunday', dayShort: 'Sun' },
  ];
}

async function getAvailability(studentId) {
  const rows = await db.prepare(
    'SELECT * FROM AVAILABILITY WHERE StudentID = ? ORDER BY AvailabilityID'
  ).all(studentId);
  return WEEKDAYS().map((d) => {
    const slots = rows.filter((r) => r.DayOfWeek === d.day).map((r) => ({
      id: `slot-${r.AvailabilityID}`,
      availabilityId: r.AvailabilityID,
      start: r.StartTime,
      end: r.EndTime,
      label: `${r.StartTime} – ${r.EndTime}`,
      period: r.Label || 'Study slot',
      enabled: r.Enabled === 1,
    }));
    return { ...d, enabled: slots.some((s) => s.enabled !== false) && slots.length > 0, slots };
  });
}

async function listFeedbackForStudent(studentId, filterType = 'all') {
  const sid = Number(studentId);
  let sql = `SELECT f.*, s.Name AS GivenByName, e.TeacherID, e.LearnerID, e.SkillID, sk.SkillName,
                    sess.SessionID, sess.SessionDate
             FROM FEEDBACK f
             JOIN EXCHANGE e ON e.ExchangeID = f.ExchangeID
             JOIN STUDENT s ON s.StudentID = f.GivenBy
             JOIN SKILL sk ON sk.SkillID = e.SkillID
             LEFT JOIN SESSION sess ON sess.ExchangeID = e.ExchangeID `;
  if (filterType === 'received') {
    sql += `WHERE (e.TeacherID = ? OR e.LearnerID = ?) AND f.GivenBy <> ? ORDER BY f.FeedbackID DESC`;
    return await db.prepare(sql).all(sid, sid, sid);
  }
  if (filterType === 'given') {
    sql += `WHERE f.GivenBy = ? ORDER BY f.FeedbackID DESC`;
    return await db.prepare(sql).all(sid);
  }
  sql += `WHERE (e.TeacherID = ? OR e.LearnerID = ? OR f.GivenBy = ?) ORDER BY f.FeedbackID DESC`;
  return await db.prepare(sql).all(sid, sid, sid);
}

async function mapReview(row, viewerId) {
  const vid = Number(viewerId);
  const isGiven = Number(row.GivenBy) === vid;
  const isReceived = !isGiven;
  const authorRole = row.GivenBy === row.LearnerID ? 'Learner' : 'Teacher';
  const ratId = `RAT-${String(row.FeedbackID).padStart(4, '0')}`;
  const sesId = row.SessionID ? `SES-${String(row.SessionID).padStart(4, '0')}` : '';

  const targetId = Number(row.GivenBy) === Number(row.TeacherID) ? row.LearnerID : row.TeacherID;
  const target = await db.prepare('SELECT Name FROM STUDENT WHERE StudentID = ?').get(targetId);

  return {
    ...row,
    id: ratId,
    ratingId: ratId,
    Rating_ID: ratId,
    sessionId: sesId,
    Session_ID: sesId,
    author: row.GivenByName,
    authorRole,
    targetStudentId: targetId,
    targetName: target?.Name || 'Peer Student',
    isGiven,
    isReceived,
    rating: row.Rating,
    skill: row.SkillName,
    sessionDate: row.SessionDate,
    date: row.CreatedAt || '',
    comment: row.Comments || '',
    aspectRatings: {
      clarity: row.ClarityRating || row.Rating,
      patience: row.PatienceRating || row.Rating,
      punctuality: row.PunctualityRating || row.Rating,
    },
    clarityRating: row.ClarityRating || row.Rating,
    patienceRating: row.PatienceRating || row.Rating,
    punctualityRating: row.PunctualityRating || row.Rating,
    wouldRecommend: row.WouldRecommend === 1,
  };
}

async function checkAndAwardBadges(studentId) {
  if (!studentId) return;
  const sid = Number(studentId);
  const earnedRows = await db.prepare('SELECT BadgeID FROM STUDENT_BADGE WHERE StudentID = ?').all(sid);
  const earnedSet = new Set(earnedRows.map((r) => r.BadgeID));

  const counts = await sessionCounts(sid);
  const offered = await db.prepare(
    `SELECT so.*, s.SkillName FROM SKILL_OFFERED so
     JOIN SKILL s ON s.SkillID = so.SkillID WHERE so.StudentID = ? LIMIT 1`
  ).get(sid);
  const wanted = await db.prepare(
    `SELECT sw.*, s.SkillName FROM SKILL_WANTED sw
     JOIN SKILL s ON s.SkillID = sw.SkillID WHERE sw.StudentID = ? LIMIT 1`
  ).get(sid);

  const offeredCountRow = await db.prepare('SELECT COUNT(*) AS c FROM SKILL_OFFERED WHERE StudentID = ?').get(sid);
  const offeredCount = offeredCountRow ? offeredCountRow.c : 0;
  const wantedCountRow = await db.prepare('SELECT COUNT(*) AS c FROM SKILL_WANTED WHERE StudentID = ?').get(sid);
  const wantedCount = wantedCountRow ? wantedCountRow.c : 0;
  const matchesCountRow = await db.prepare(
    "SELECT COUNT(*) AS c FROM EXCHANGE WHERE (TeacherID = ? OR LearnerID = ?) AND Status <> 'Cancelled'"
  ).get(sid, sid);
  const matchesCount = matchesCountRow ? matchesCountRow.c : 0;
  const sessionRow = await db.prepare(
    `SELECT s.Topic, sk.SkillName FROM SESSION s
     JOIN EXCHANGE e ON e.ExchangeID = s.ExchangeID
     JOIN SKILL sk ON sk.SkillID = e.SkillID
     WHERE (e.TeacherID = ? OR e.LearnerID = ?) AND s.Status <> 'Cancelled' LIMIT 1`
  ).get(sid, sid);
  const sessionsCountRow = await db.prepare(
    `SELECT COUNT(*) AS c FROM SESSION s
     JOIN EXCHANGE e ON e.ExchangeID = s.ExchangeID
     WHERE (e.TeacherID = ? OR e.LearnerID = ?) AND s.Status <> 'Cancelled'`
  ).get(sid, sid);
  const sessionsCount = sessionsCountRow ? sessionsCountRow.c : 0;

  const fiveStarReviewsCountRow = await db.prepare(
    `SELECT COUNT(*) AS c FROM FEEDBACK f
     JOIN EXCHANGE e ON e.ExchangeID = f.ExchangeID
     WHERE e.TeacherID = ? AND f.Rating = 5`
  ).get(sid);
  const fiveStarReviewsCount = fiveStarReviewsCountRow ? fiveStarReviewsCountRow.c : 0;

  const ratingInfo = await teacherRating(sid);
  const avgRating = ratingInfo.avgRating;

  const badgesToAward = [];

  // 1. badge-first-skill
  if (!earnedSet.has('badge-first-skill') && offeredCount >= 1) {
    badgesToAward.push({
      badgeId: 'badge-first-skill',
      activityTrigger: offered ? `Published "${offered.SkillName}"` : 'Published teaching skill offering',
    });
  }

  // 2. badge-first-request
  if (!earnedSet.has('badge-first-request') && wantedCount >= 1) {
    badgesToAward.push({
      badgeId: 'badge-first-request',
      activityTrigger: wanted ? `Requested "${wanted.SkillName}"` : 'Posted skill learning request',
    });
  }

  // 3. badge-first-match
  if (!earnedSet.has('badge-first-match') && matchesCount >= 1) {
    badgesToAward.push({
      badgeId: 'badge-first-match',
      activityTrigger: 'Mutual match confirmed on campus',
    });
  }

  // 4. badge-first-session
  if (!earnedSet.has('badge-first-session') && sessionsCount >= 1) {
    badgesToAward.push({
      badgeId: 'badge-first-session',
      activityTrigger: sessionRow ? `Scheduled session "${sessionRow.Topic || sessionRow.SkillName}"` : 'Scheduled study session on calendar',
    });
  }

  // 5. badge-first-completed
  if (!earnedSet.has('badge-first-completed') && (counts.sessionsTaught + counts.sessionsAttended) >= 1) {
    badgesToAward.push({
      badgeId: 'badge-first-completed',
      activityTrigger: 'Completed collaborative study session',
    });
  }

  // 6. badge-knowledge-sharer
  if (!earnedSet.has('badge-knowledge-sharer') && counts.sessionsTaught >= 1) {
    badgesToAward.push({
      badgeId: 'badge-knowledge-sharer',
      activityTrigger: 'Taught session with a peer learner',
    });
  }

  // 7. badge-active-learner
  if (!earnedSet.has('badge-active-learner') && counts.sessionsAttended >= 1) {
    badgesToAward.push({
      badgeId: 'badge-active-learner',
      activityTrigger: 'Concluded learning session with a peer teacher',
    });
  }

  // 8. badge-top-mentor
  if (!earnedSet.has('badge-top-mentor') && counts.sessionsTaught >= 1 && avgRating != null && avgRating >= 4.90) {
    badgesToAward.push({
      badgeId: 'badge-top-mentor',
      activityTrigger: `Maintained ${avgRating.toFixed(2)} ★ rating across completed teaching sessions`,
    });
  }

  // 9. badge-master-teacher
  if (!earnedSet.has('badge-master-teacher') && counts.sessionsTaught >= 3) {
    badgesToAward.push({
      badgeId: 'badge-master-teacher',
      activityTrigger: `Completed ${counts.sessionsTaught} of 3 peer teaching sessions`,
    });
  }

  // 10. badge-five-star
  if (!earnedSet.has('badge-five-star') && fiveStarReviewsCount >= 3) {
    badgesToAward.push({
      badgeId: 'badge-five-star',
      activityTrigger: 'Received 3 five-star peer ratings',
    });
  }

  for (const b of badgesToAward) {
    const badgeRow = await db.prepare('SELECT Title FROM BADGE WHERE BadgeID = ?').get(b.badgeId);
    if (!badgeRow) continue;
    try {
      await db.prepare(
        `INSERT INTO STUDENT_BADGE (StudentID, BadgeID, EarnedAt, ActivityTrigger)
         VALUES (?, ?, datetime('now'), ?)`
      ).run(sid, b.badgeId, b.activityTrigger);

      await db.prepare(
        'INSERT INTO NOTIFICATION (StudentID, Type, Title, Message, Link, RelatedType, RelatedID) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        sid,
        'badge',
        'Badge Unlocked!',
        `You earned the "${badgeRow.Title}" badge!`,
        '/profile',
        'badge',
        String(b.badgeId)
      );
      earnedSet.add(b.badgeId);
    } catch {
      // Safe: already awarded or duplicate race condition
    }
  }
}

async function getStudentAchievements(studentId) {
  const sid = Number(studentId);
  await checkAndAwardBadges(sid);

  const allBadges = await db.prepare('SELECT * FROM BADGE ORDER BY Category, BadgeID').all();
  const earnedRows = await db.prepare('SELECT * FROM STUDENT_BADGE WHERE StudentID = ?').all(sid);
  const earnedMap = new Map(earnedRows.map((r) => [r.BadgeID, r]));

  const counts = await sessionCounts(sid);
  const offeredCountRow = await db.prepare('SELECT COUNT(*) AS c FROM SKILL_OFFERED WHERE StudentID = ?').get(sid);
  const offeredCount = offeredCountRow ? offeredCountRow.c : 0;
  const wantedCountRow = await db.prepare('SELECT COUNT(*) AS c FROM SKILL_WANTED WHERE StudentID = ?').get(sid);
  const wantedCount = wantedCountRow ? wantedCountRow.c : 0;
  const reviewsCountRow = await db.prepare('SELECT COUNT(*) AS c FROM FEEDBACK f JOIN EXCHANGE e ON e.ExchangeID = f.ExchangeID WHERE e.TeacherID = ? AND f.Rating = 5').get(sid);
  const reviewsCount = reviewsCountRow ? reviewsCountRow.c : 0;
  const matchesCountRow = await db.prepare("SELECT COUNT(*) AS c FROM EXCHANGE WHERE (TeacherID = ? OR LearnerID = ?) AND Status <> 'Cancelled'").get(sid, sid);
  const matchesCount = matchesCountRow ? matchesCountRow.c : 0;
  const sessionsCountRow = await db.prepare(
    `SELECT COUNT(*) AS c FROM SESSION s JOIN EXCHANGE e ON e.ExchangeID = s.ExchangeID WHERE (e.TeacherID = ? OR e.LearnerID = ?) AND s.Status <> 'Cancelled'`
  ).get(sid, sid);
  const sessionsCount = sessionsCountRow ? sessionsCountRow.c : 0;
  const ratingInfo = await teacherRating(sid);
  const rating = ratingInfo.avgRating || 0;

  return allBadges.map((b) => {
    const earnedRecord = earnedMap.get(b.BadgeID);
    let current = 0;
    switch (b.BadgeID) {
      case 'badge-first-skill': current = offeredCount; break;
      case 'badge-first-request': current = wantedCount; break;
      case 'badge-first-match': current = matchesCount; break;
      case 'badge-first-session': current = sessionsCount; break;
      case 'badge-first-completed': current = counts.sessionsTaught + counts.sessionsAttended; break;
      case 'badge-knowledge-sharer': current = counts.sessionsTaught; break;
      case 'badge-active-learner': current = counts.sessionsAttended; break;
      case 'badge-top-mentor': current = (counts.sessionsTaught >= 1 && rating >= 4.9) ? 1 : 0; break;
      case 'badge-master-teacher': current = counts.sessionsTaught; break;
      case 'badge-five-star': current = reviewsCount; break;
      default: current = earnedRecord ? b.TargetValue : 0;
    }
    const earned = Boolean(earnedRecord) || current >= b.TargetValue;
    const percent = Math.min(100, Math.round((current / b.TargetValue) * 100));
    const remaining = Math.max(0, b.TargetValue - current);
    const unitLabel = remaining === 1
      ? (b.Unit.endsWith('s') ? b.Unit.slice(0, -1) : b.Unit)
      : b.Unit;
    const remainingText = earned ? 'Completed' : `${remaining} more ${unitLabel} to unlock`;
    const status = earned ? 'Earned' : (current > 0 ? 'In progress' : 'Locked');

    const progressObj = {
      current,
      target: b.TargetValue,
      unit: b.Unit,
      percent,
      remainingText,
      earned,
      earnedDate: earnedRecord ? earnedRecord.EarnedAt : (earned ? 'Recently' : null),
      activityTrigger: earnedRecord ? earnedRecord.ActivityTrigger : null,
      isNew: false,
    };

    return {
      id: b.BadgeID,
      badgeId: b.BadgeID,
      title: b.Title,
      category: b.Category,
      icon: b.Icon,
      badgeClass: b.BadgeClass,
      criterion: b.Criterion,
      desc: b.Criterion,
      target: b.TargetValue,
      unit: b.Unit,
      current,
      percent,
      earned,
      unlocked: earned,
      status,
      remainingText,
      earnedDate: progressObj.earnedDate,
      activityTrigger: progressObj.activityTrigger,
      isNew: false,
      progress: progressObj,
    };
  });
}

async function hydrateStudent(id) {
  const student = await getStudent(id);
  const rating = await teacherRating(id);
  const counts = await sessionCounts(id);
  const offeredRaw = await offeredRows(id);
  const offered = await Promise.all(offeredRaw.map((r) => mapOffered(r, id)));
  const wantedRaw = await wantedRows(id);
  const wanted = wantedRaw.map((r) => mapWanted(r, id));
  const allSessions = await db.prepare(`${SESSION_SELECT} WHERE e.TeacherID = ? OR e.LearnerID = ? ORDER BY s.SessionDate ASC`)
    .all(id, id);
  const upcomingSessions = allSessions.filter((row) => isFutureSession(row)).map((row) => mapSession(row, id));
  const availability = await getAvailability(id);
  const feedbackRaw = await listFeedbackForStudent(id);
  const reviews = await Promise.all(feedbackRaw.map((row) => mapReview(row, id)));
  const power = await computePowerLevel(id, counts.sessionsTaught, counts.sessionsAttended, offered.length);
  const achievements = await getStudentAchievements(id);

  const interests = student.Interests ? student.Interests.split(',').map((x) => x.trim()).filter(Boolean) : [];
  const languages = student.Languages ? student.Languages.split(',').map((x) => x.trim()).filter(Boolean) : [];

  return {
    ...student,
    id: student.StudentID,
    studentId: displayStudentId(student.StudentID),
    name: student.Name,
    email: student.Email,
    department: student.Department || '',
    year: student.YearOfStudy || '',
    bio: student.Bio || '',
    hostelBlock: student.HostelBlock || '',
    roomNo: student.RoomNo || '',
    avatar: student.Avatar || initials(student.Name),
    avatarBg: avatarBg(student.StudentID),
    phone: student.Phone || '',
    githubUrl: student.GithubUrl || '',
    linkedinUrl: student.LinkedinUrl || '',
    portfolioUrl: student.PortfolioUrl || '',
    interests,
    languages,
    rating: rating.reviews > 0 ? Number(rating.avgRating).toFixed(2) : null,
    reviewsCount: rating.reviews || 0,
    reviewCount: rating.reviews || 0,
    ...counts,
    ...power,
    offered,
    wanted,
    skillsOffered: offered,
    skillsWanted: wanted,
    upcomingSessions,
    weeklyAvailability: availability,
    recentReviews: reviews,
    achievements,
    skillMasterShown: Boolean(student.SkillMasterShown),
    SkillMasterShown: student.SkillMasterShown ? 1 : 0,
    lastSeenAt: student.LastSeenAt || null,
    isOnline: isStudentOnline(student.LastSeenAt),
    onlineStatus: isStudentOnline(student.LastSeenAt) ? 'online' : 'offline',
  };
}

async function conversationsFor(studentId) {
  const me = Number(studentId);
  const peers = await db.prepare(
    `SELECT DISTINCT CASE WHEN SenderID = ? THEN ReceiverID ELSE SenderID END AS PeerID
     FROM MESSAGE WHERE SenderID = ? OR ReceiverID = ?`
  ).all(me, me, me);
  const convList = await Promise.all(peers.map(async (p) => {
    const peer = await getStudent(p.PeerID);
    const messages = await db.prepare(
      `SELECT m.*, s.Name AS SenderName FROM MESSAGE m
       JOIN STUDENT s ON s.StudentID = m.SenderID
       WHERE (m.SenderID = ? AND m.ReceiverID = ?) OR (m.SenderID = ? AND m.ReceiverID = ?)
       ORDER BY m.MessageID`
    ).all(me, p.PeerID, p.PeerID, me);
    const unread = messages.filter((m) => m.ReceiverID === me && m.IsRead === 0).length;
    const last = messages[messages.length - 1];
    return {
      id: `conv-${p.PeerID}`,
      peerId: p.PeerID,
      peerStudentId: displayStudentId(p.PeerID),
      peerName: peer.Name,
      peerDept: [peer.Department, peer.YearOfStudy].filter(Boolean).join(' • '),
      peerAvatar: peer.Avatar || initials(peer.Name),
      avatarBg: avatarBg(p.PeerID),
      onlineStatus: isStudentOnline(peer.LastSeenAt) ? 'online' : 'offline',
      lastActive: last ? last.SentAt : '',
      skillContext: 'Peer knowledge exchange',
      unreadCount: unread,
      messages: messages.map((m) => ({
        id: `m-${m.MessageID}`,
        messageId: m.MessageID,
        sender: m.SenderName,
        text: m.Body,
        timestamp: m.SentAt,
        isMine: m.SenderID === me,
      })),
    };
  }));
  return convList.sort((a, b) => String(b.lastActive).localeCompare(String(a.lastActive)));
}

// =============================================================================
// ROUTES
// =============================================================================

// ---------- health ----------
route('GET', '/api/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }));

// ---------- auth / students ----------
route('POST', '/api/register', async (req, body) => {
  required(body, 'name', 'email', 'password');
  const normalizedEmail = String(body.email).trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalizedEmail)) throw bad('Valid email is required');
  if (String(body.password).length < 8) throw bad('Password must be at least 8 characters');

  const avatar = body.avatar || initials(body.name);
  const interests = Array.isArray(body.interests) ? body.interests.join(', ') : (body.interests ?? null);
  const languages = Array.isArray(body.languages) ? body.languages.join(', ') : (body.languages ?? null);

  const r = await db.prepare(
    `INSERT INTO STUDENT (
      Name, Email, Department, YearOfStudy, Bio, HostelBlock, RoomNo, Password,
      Avatar, Phone, GithubUrl, LinkedinUrl, PortfolioUrl, Interests, Languages
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    String(body.name).trim(), normalizedEmail,
    body.department ?? null, body.year ?? body.yearOfStudy ?? null, body.bio ?? null,
    body.hostelBlock ?? null, body.roomNo ?? null,
    hashPassword(body.password),
    avatar, body.phone ?? null, body.githubUrl ?? null, body.linkedinUrl ?? null, body.portfolioUrl ?? null,
    interests, languages
  );
  const newStudentId = r.lastInsertRowid;
  const token = createToken(newStudentId, normalizedEmail);
  const hydrated = await hydrateStudent(newStudentId);
  return [201, { token, ...hydrated }];
});

route('POST', '/api/login', async (req, body) => {
  required(body, 'email', 'password');
  const normalizedEmail = String(body.email).trim().toLowerCase();
  const ip = getClientIp(req);

  checkLoginRateLimit(normalizedEmail, ip);

  const s = await db.prepare('SELECT * FROM STUDENT WHERE lower(Email) = lower(?)').get(normalizedEmail);
  if (!s || !verifyPassword(body.password, s.Password)) {
    recordLoginFailure(normalizedEmail, ip);
    throw new HttpError(401, 'Invalid email or password');
  }

  clearLoginFailures(normalizedEmail, ip);
  await touchStudentLastSeen(s.StudentID);
  const token = createToken(s.StudentID, s.Email);
  const hydrated = await hydrateStudent(s.StudentID);
  return { token, ...hydrated };
});

route('GET', '/api/students', async () => {
  const students = await db.prepare(`SELECT ${PUBLIC_STUDENT_COLS} FROM STUDENT ORDER BY Name`).all();
  const allOffered = await db.prepare(
    `SELECT so.StudentID, sk.SkillName FROM SKILL_OFFERED so
     JOIN SKILL sk ON sk.SkillID = so.SkillID`
  ).all();
  const skillsByStudent = {};
  for (const row of allOffered) {
    if (!skillsByStudent[row.StudentID]) skillsByStudent[row.StudentID] = [];
    skillsByStudent[row.StudentID].push(row.SkillName);
  }

  const allRatings = await db.prepare(
    `SELECT e.TeacherID, ROUND(AVG(f.Rating), 2) AS AvgRating, COUNT(f.FeedbackID) AS Reviews
     FROM EXCHANGE e
     JOIN FEEDBACK f ON f.ExchangeID = e.ExchangeID AND f.GivenBy = e.LearnerID
     GROUP BY e.TeacherID`
  ).all();
  const ratingsByTeacher = {};
  for (const r of allRatings) {
    ratingsByTeacher[r.TeacherID] = {
      avgRating: r.AvgRating != null ? Number(r.AvgRating) : null,
      reviews: r.Reviews || 0,
    };
  }

  return students.map((s) => {
    const rInfo = ratingsByTeacher[s.StudentID];
    const reviews = rInfo?.reviews || 0;
    const rating = (reviews > 0 && rInfo?.avgRating != null) ? Number(rInfo.avgRating).toFixed(2) : null;
    return {
      ...s,
      id: s.StudentID,
      studentId: displayStudentId(s.StudentID),
      name: s.Name,
      department: s.Department,
      year: s.YearOfStudy,
      avatar: s.Avatar || initials(s.Name),
      avatarBg: avatarBg(s.StudentID),
      isOnline: isStudentOnline(s.LastSeenAt),
      onlineStatus: isStudentOnline(s.LastSeenAt) ? 'online' : 'offline',
      rating,
      reviewsCount: reviews,
      reviewCount: reviews,
      skills: (skillsByStudent[s.StudentID] || []).join(', '),
      skillsOffered: skillsByStudent[s.StudentID] || [],
    };
  });
});

route('GET', '/api/students/:id', async (req, body, p) => {
  const targetId = Number(p.id);
  const hydrated = await hydrateStudent(targetId);
  if (req.user && req.user.studentId === targetId) {
    return hydrated;
  }
  const pub = { ...hydrated };
  delete pub.Email;
  delete pub.email;
  delete pub.Phone;
  delete pub.phone;
  delete pub.Password;
  delete pub.password;
  return pub;
});

route('PATCH', '/api/students/:id', async (req, body, p) => {
  const targetId = Number(p.id);
  if (!req.user || req.user.studentId !== targetId) {
    throw new HttpError(403, 'Forbidden');
  }
  const cur = await getStudent(targetId);
  const interests = Array.isArray(body.interests) ? body.interests.join(', ') : (body.interests ?? cur.Interests);
  const languages = Array.isArray(body.languages) ? body.languages.join(', ') : (body.languages ?? cur.Languages);

  await db.prepare(
    `UPDATE STUDENT SET
       Name=?, Email=?, Department=?, YearOfStudy=?, Bio=?, HostelBlock=?, RoomNo=?,
       Avatar=?, Phone=?, GithubUrl=?, LinkedinUrl=?, PortfolioUrl=?, Interests=?, Languages=?
     WHERE StudentID=?`
  ).run(
    body.name ?? cur.Name,
    body.email ?? cur.Email,
    body.department ?? cur.Department,
    body.year ?? body.yearOfStudy ?? cur.YearOfStudy,
    body.bio ?? cur.Bio,
    body.hostelBlock ?? cur.HostelBlock,
    body.roomNo ?? cur.RoomNo,
    body.avatar ?? cur.Avatar,
    body.phone ?? cur.Phone,
    body.githubUrl ?? cur.GithubUrl,
    body.linkedinUrl ?? cur.LinkedinUrl,
    body.portfolioUrl ?? cur.PortfolioUrl,
    interests,
    languages,
    targetId
  );
  if (body.skillMasterShown !== undefined || body.SkillMasterShown !== undefined) {
    const val = (body.skillMasterShown ?? body.SkillMasterShown) ? 1 : 0;
    await db.prepare('UPDATE STUDENT SET SkillMasterShown = ? WHERE StudentID = ?').run(val, targetId);
  }
  return await hydrateStudent(targetId);
});

// ---------- leaderboard ----------
route('GET', '/api/leaderboard', async () => {
  const students = await db.prepare('SELECT StudentID, Name, Department, YearOfStudy, Avatar, SkillMasterShown FROM STUDENT').all();
  const list = await Promise.all(students.map(async (s) => {
    const rating = await teacherRating(s.StudentID);
    const counts = await sessionCounts(s.StudentID);
    const offeredRow = await db.prepare('SELECT COUNT(*) AS c FROM SKILL_OFFERED WHERE StudentID = ?').get(s.StudentID);
    const offered = offeredRow ? offeredRow.c : 0;
    const power = await computePowerLevel(s.StudentID, counts.sessionsTaught, counts.sessionsAttended, offered);
    const teachingReviewsCount = rating.reviews || 0;
    const teachingRating = (teachingReviewsCount > 0 && rating.avgRating != null) ? Number(rating.avgRating) : null;
    const badgesCount = power.badgeCount;

    // Leaderboard formula: Score = (badgesCount * 15) + (teachingRating * 12) + (min(teachingReviewsCount, 20) * 2)
    // A student with zero reviews gets 0 rating points:
    const rawScore = (badgesCount * 15) + (teachingReviewsCount > 0 ? ((teachingRating || 0) * 12) : 0) + (Math.min(teachingReviewsCount, 20) * 2);
    const finalScore = Math.round(rawScore * 10) / 10;

    return {
      studentId: displayStudentId(s.StudentID),
      id: s.StudentID,
      StudentID: s.StudentID,
      name: s.Name,
      department: s.Department,
      year: s.YearOfStudy,
      avatar: s.Avatar || initials(s.Name),
      avatarBg: avatarBg(s.StudentID),
      rating: teachingReviewsCount > 0 ? Number(teachingRating).toFixed(2) : null,
      teachingRating,
      teachingReviewsCount,
      reviewsCount: teachingReviewsCount,
      reviewCount: teachingReviewsCount,
      sessionsTaught: counts.sessionsTaught,
      sessionsLearnt: counts.sessionsAttended,
      sessionsAttended: counts.sessionsAttended,
      powerLevel: power.powerLevel,
      rankTitle: power.rank,
      title: power.title,
      badgeCount: badgesCount,
      badgesCount,
      score: finalScore,
      isSkillMaster: badgesCount >= 8,
    };
  }));

  list.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const bRate = b.teachingRating != null ? b.teachingRating : -1;
    const aRate = a.teachingRating != null ? a.teachingRating : -1;
    if (bRate !== aRate) return bRate - aRate;
    if (b.teachingReviewsCount !== a.teachingReviewsCount) return b.teachingReviewsCount - a.teachingReviewsCount;
    if (b.badgesCount !== a.badgesCount) return b.badgesCount - a.badgesCount;
    return a.id - b.id;
  });

  return list.map((item, index) => ({ ...item, rank: index + 1 }));
});

// ---------- badges ----------
route('GET', '/api/students/:id/badges', async (req, body, p) => {
  const targetId = Number(p.id);
  if (!req.user || req.user.studentId !== targetId) throw new HttpError(403, 'Forbidden');
  await getStudent(targetId);
  return await getStudentAchievements(targetId);
});

route('POST', '/api/students/:id/badges/award', () => {
  throw new HttpError(403, 'Badge awarding is server-managed');
});
route('POST', '/api/students/:id/badges', () => {
  throw new HttpError(403, 'Badge awarding is server-managed');
});

// ---------- notifications ----------
route('GET', '/api/students/:id/notifications', async (req, body, p) => {
  const targetId = Number(p.id);
  if (!req.user || req.user.studentId !== targetId) throw new HttpError(403, 'Forbidden');
  await touchStudentLastSeen(targetId);
  await getStudent(targetId);
  return await db.prepare('SELECT * FROM NOTIFICATION WHERE StudentID = ? ORDER BY NotificationID DESC').all(targetId);
});

route('GET', '/api/students/:id/notifications/unread-count', async (req, body, p) => {
  const targetId = Number(p.id);
  if (!req.user || req.user.studentId !== targetId) throw new HttpError(403, 'Forbidden');
  await touchStudentLastSeen(targetId);
  await getStudent(targetId);
  const row = await db.prepare('SELECT COUNT(*) AS c FROM NOTIFICATION WHERE StudentID = ? AND IsRead = 0').get(targetId);
  const count = row ? row.c : 0;
  return { count, unreadCount: count };
});

route('PATCH', '/api/students/:id/notifications/read-all', async (req, body, p) => {
  const targetId = Number(p.id);
  if (!req.user || req.user.studentId !== targetId) throw new HttpError(403, 'Forbidden');
  await touchStudentLastSeen(targetId);
  await getStudent(targetId);
  const r = await db.prepare('UPDATE NOTIFICATION SET IsRead = 1 WHERE StudentID = ? AND IsRead = 0').run(targetId);
  return { ok: true, markedCount: r.changes };
});

route('PATCH', '/api/notifications/:id/read', async (req, body, p) => {
  const notif = await db.prepare('SELECT * FROM NOTIFICATION WHERE NotificationID = ?').get(p.id);
  if (!notif) throw notFound('Notification not found');
  if (!req.user || Number(notif.StudentID) !== req.user.studentId) throw new HttpError(403, 'Forbidden');
  await touchStudentLastSeen(req.user.studentId);
  await db.prepare('UPDATE NOTIFICATION SET IsRead = 1 WHERE NotificationID = ?').run(p.id);
  return await db.prepare('SELECT * FROM NOTIFICATION WHERE NotificationID = ?').get(p.id);
});

route('POST', '/api/notifications', () => {
  throw new HttpError(403, 'Notifications are server-managed');
});

// ---------- skills ----------
route('GET', '/api/skills', async (req, body, p, q) => {
  if (q.get('category')) {
    return await db.prepare('SELECT * FROM SKILL WHERE Category = ? ORDER BY SkillName').all(q.get('category'));
  }
  return await db.prepare('SELECT * FROM SKILL ORDER BY SkillName').all();
});

route('POST', '/api/skills', async (req, body) => {
  required(body, 'skillName');
  const r = await db.prepare('INSERT INTO SKILL (SkillName, Category) VALUES (?,?)')
    .run(body.skillName, body.category ?? null);
  return [201, await db.prepare('SELECT * FROM SKILL WHERE SkillID = ?').get(r.lastInsertRowid)];
});

route('GET', '/api/explore', async (req, body, p, q) => {
  const category = q.get('category');
  const search = (q.get('q') || '').trim().toLowerCase();
  let rows = await db.prepare(
    `SELECT so.StudentID, so.SkillID, so.ProficiencyLevel, so.Description, so.Availability,
            so.Tags, so.SampleTopics, so.YearsOfExperience,
            sk.SkillName, sk.Category, st.Name, st.Department, st.YearOfStudy, st.Avatar
     FROM SKILL_OFFERED so
     JOIN SKILL sk ON sk.SkillID = so.SkillID
     JOIN STUDENT st ON st.StudentID = so.StudentID
     ORDER BY sk.SkillName`
  ).all();
  if (category && category !== 'All') {
    rows = rows.filter((r) => String(r.Category || '').toLowerCase() === category.toLowerCase());
  }
  if (search) {
    rows = rows.filter((r) =>
      [r.SkillName, r.Description, r.Name, r.Category, r.Tags, r.SampleTopics].some((v) =>
        String(v || '').toLowerCase().includes(search)
      )
    );
  }
  return await Promise.all(rows.map(async (r) => {
    const rating = await teacherRating(r.StudentID);
    const countData = await sessionCounts(r.StudentID);
    const taught = countData.sessionsTaught;
    const avail = r.Availability || 'Flexible';
    let availabilityType = 'Flexible';
    if (/weekend/i.test(avail)) availabilityType = 'Weekends';
    else if (/evening/i.test(avail)) availabilityType = 'Evenings';
    else if (/weekday/i.test(avail)) availabilityType = 'Weekdays';
    const topics = r.SampleTopics
      ? r.SampleTopics.split(',').map((t) => t.trim())
      : (r.Description || '').split(/[.•,]/).map((t) => t.trim()).filter((t) => t.length > 5).slice(0, 4);
    const tags = r.Tags ? r.Tags.split(',').map((t) => t.trim()) : [r.Category, r.SkillName];

    return {
      id: `exp-${r.StudentID}-${r.SkillID}`,
      skillId: r.SkillID,
      teacherId: r.StudentID,
      studentId: displayStudentId(r.StudentID),
      name: r.SkillName,
      category: r.Category || 'General',
      level: r.ProficiencyLevel,
      mentorName: r.Name,
      mentorDept: [r.Department, r.YearOfStudy].filter(Boolean).join(' • '),
      mentorAvatar: r.Avatar || initials(r.Name),
      avatarBg: avatarBg(r.StudentID),
      mentorRating: rating.reviews > 0 ? Number(rating.avgRating).toFixed(2) : null,
      rating: rating.reviews > 0 ? Number(rating.avgRating).toFixed(2) : null,
      reviewsCount: rating.reviews || 0,
      reviewCount: rating.reviews || 0,
      sessionsDelivered: taught,
      description: r.Description || r.SkillName,
      availability: avail,
      availabilityType,
      tags,
      topics,
      yearsOfExperience: r.YearsOfExperience || 1,
    };
  }));
});

// ---------- offered / wanted ----------
route('GET', '/api/students/:id/offered', async (req, body, p) => {
  const targetId = Number(p.id);
  if (!req.user || req.user.studentId !== targetId) throw new HttpError(403, 'Forbidden');
  await getStudent(targetId);
  const rows = await offeredRows(targetId);
  return await Promise.all(rows.map((r) => mapOffered(r, targetId)));
});

route('POST', '/api/students/:id/offered', async (req, body, p) => {
  const targetId = Number(p.id);
  if (!req.user || req.user.studentId !== targetId) throw new HttpError(403, 'Forbidden');
  await getStudent(targetId);
  const skill = await resolveSkill(body);
  const level = normalizeLevel(body.level, 'Intermediate');
  const tags = Array.isArray(body.tags) ? body.tags.join(', ') : (body.tags ?? null);
  const topics = Array.isArray(body.sampleTopics) ? body.sampleTopics.join(', ') : (body.sampleTopics ?? null);
  const exp = body.yearsOfExperience ? Number(body.yearsOfExperience) : 1;

  await db.prepare(
    `INSERT INTO SKILL_OFFERED (
      StudentID, SkillID, ProficiencyLevel, Description, Availability, Tags, SampleTopics, YearsOfExperience
    ) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(StudentID, SkillID) DO UPDATE SET
      ProficiencyLevel = excluded.ProficiencyLevel,
      Description = COALESCE(excluded.Description, SKILL_OFFERED.Description),
      Availability = COALESCE(excluded.Availability, SKILL_OFFERED.Availability),
      Tags = COALESCE(excluded.Tags, SKILL_OFFERED.Tags),
      SampleTopics = COALESCE(excluded.SampleTopics, SKILL_OFFERED.SampleTopics),
      YearsOfExperience = COALESCE(excluded.YearsOfExperience, SKILL_OFFERED.YearsOfExperience)`
  ).run(targetId, skill.SkillID, level, body.description ?? body.Description ?? null, body.availability ?? null, tags, topics, exp);

  await checkAndAwardBadges(targetId);

  const freshOffered = await offeredRows(targetId);
  const targetRow = freshOffered.find((r) => r.SkillID === skill.SkillID);
  return [201, await mapOffered(targetRow, targetId)];
});

route('PATCH', '/api/students/:id/offered/:skillId', async (req, body, p) => {
  const targetId = Number(p.id);
  if (!req.user || req.user.studentId !== targetId) throw new HttpError(403, 'Forbidden');
  await getStudent(targetId);
  const cur = await db.prepare('SELECT * FROM SKILL_OFFERED WHERE StudentID=? AND SkillID=?').get(targetId, p.skillId);
  if (!cur) throw notFound('Entry not found');
  let skillId = Number(p.skillId);
  const tags = Array.isArray(body.tags) ? body.tags.join(', ') : (body.tags ?? cur.Tags);
  const topics = Array.isArray(body.sampleTopics) ? body.sampleTopics.join(', ') : (body.sampleTopics ?? cur.SampleTopics);
  const exp = body.yearsOfExperience ? Number(body.yearsOfExperience) : cur.YearsOfExperience;

  if (body.skillName) {
    const skill = await findOrCreateSkill(body.skillName, body.category);
    if (skill.SkillID !== skillId) {
      await db.prepare('DELETE FROM SKILL_OFFERED WHERE StudentID=? AND SkillID=?').run(targetId, skillId);
      skillId = skill.SkillID;
      await db.prepare(
        `INSERT INTO SKILL_OFFERED (
          StudentID, SkillID, ProficiencyLevel, Description, Availability, Tags, SampleTopics, YearsOfExperience
        ) VALUES (?,?,?,?,?,?,?,?)`
      ).run(
        targetId, skillId,
        normalizeLevel(body.level, cur.ProficiencyLevel),
        body.description ?? cur.Description,
        body.availability ?? cur.Availability,
        tags, topics, exp
      );
      const freshOffered = await offeredRows(targetId);
      return await mapOffered(freshOffered.find((r) => r.SkillID === skillId), targetId);
    }
  }

  await db.prepare(
    `UPDATE SKILL_OFFERED SET
       ProficiencyLevel=?, Description=?, Availability=?, Tags=?, SampleTopics=?, YearsOfExperience=?
     WHERE StudentID=? AND SkillID=?`
  ).run(
    normalizeLevel(body.level, cur.ProficiencyLevel),
    body.description ?? cur.Description,
    body.availability ?? cur.Availability,
    tags, topics, exp,
    targetId, skillId
  );
  const freshOffered = await offeredRows(targetId);
  return await mapOffered(freshOffered.find((r) => r.SkillID === skillId), targetId);
});

route('DELETE', '/api/students/:id/offered/:skillId', async (req, body, p) => {
  const targetId = Number(p.id);
  if (!req.user || req.user.studentId !== targetId) throw new HttpError(403, 'Forbidden');
  const skillId = Number(p.skillId);
  const cur = await db.prepare('SELECT * FROM SKILL_OFFERED WHERE StudentID = ? AND SkillID = ?').get(targetId, skillId);
  if (!cur) throw notFound('Entry not found');

  const acceptedExchanges = await db.prepare(
    "SELECT ExchangeID FROM EXCHANGE WHERE (TeacherID = ? OR LearnerID = ?) AND SkillID = ? AND Status = 'Accepted'"
  ).all(targetId, targetId, skillId);
  for (const ex of acceptedExchanges) {
    const sessions = await db.prepare("SELECT * FROM SESSION WHERE ExchangeID = ? AND Status = 'Scheduled'").all(ex.ExchangeID);
    if (sessions.some((s) => isFutureSession(s))) {
      throw new HttpError(409, 'You have upcoming sessions for this skill. Cancel them in Sessions first.');
    }
  }

  const deleter = await getStudent(targetId);
  const skillRow = await db.prepare('SELECT SkillName FROM SKILL WHERE SkillID = ?').get(skillId);
  const skillName = skillRow?.SkillName || 'this skill';

  const pendingExchanges = await db.prepare(
    "SELECT * FROM EXCHANGE WHERE TeacherID = ? AND SkillID = ? AND Status = 'Pending'"
  ).all(targetId, skillId);
  for (const ex of pendingExchanges) {
    await db.prepare("UPDATE EXCHANGE SET Status = 'Cancelled' WHERE ExchangeID = ?").run(ex.ExchangeID);
    await db.prepare(
      'INSERT INTO NOTIFICATION (StudentID, Type, Title, Message, Link, RelatedType, RelatedID) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      ex.LearnerID,
      'match',
      'Exchange Cancelled',
      `${deleter.Name} is no longer offering ${skillName}`,
      '/matches',
      'exchange',
      String(ex.ExchangeID)
    );
  }

  const r = await db.prepare('DELETE FROM SKILL_OFFERED WHERE StudentID = ? AND SkillID = ?').run(targetId, skillId);
  if (!r.changes) throw notFound('Entry not found');
  return [204];
});

route('GET', '/api/students/:id/wanted', async (req, body, p) => {
  const targetId = Number(p.id);
  if (!req.user || req.user.studentId !== targetId) throw new HttpError(403, 'Forbidden');
  await getStudent(targetId);
  const rows = await wantedRows(targetId);
  return rows.map((r) => mapWanted(r, targetId));
});

route('POST', '/api/students/:id/wanted', async (req, body, p) => {
  const targetId = Number(p.id);
  if (!req.user || req.user.studentId !== targetId) throw new HttpError(403, 'Forbidden');
  await getStudent(targetId);
  const skill = await resolveSkill(body);
  const level = normalizeLevel(body.level || body.desiredLevel || body.preferredLevel, 'Beginner');
  const priority = ['High', 'Medium', 'Low'].includes(body.priority) ? body.priority : 'Medium';
  const targetGoal = body.targetGoal || body.learningGoal || body.description || null;
  const prefAvail = body.preferredAvailability || body.availability || null;

  await db.prepare(
    `INSERT INTO SKILL_WANTED (
      StudentID, SkillID, DesiredLevel, Description, Priority, PreferredAvailability, TargetGoal
    ) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(StudentID, SkillID) DO UPDATE SET
      DesiredLevel = excluded.DesiredLevel,
      Description = COALESCE(excluded.Description, SKILL_WANTED.Description),
      Priority = excluded.Priority,
      PreferredAvailability = COALESCE(excluded.PreferredAvailability, SKILL_WANTED.PreferredAvailability),
      TargetGoal = COALESCE(excluded.TargetGoal, SKILL_WANTED.TargetGoal)`
  ).run(targetId, skill.SkillID, level, body.description ?? targetGoal ?? null, priority, prefAvail, targetGoal);

  await checkAndAwardBadges(targetId);

  const freshWanted = await wantedRows(targetId);
  return [201, freshWanted.map((r) => mapWanted(r, targetId)).find((r) => r.SkillID === skill.SkillID)];
});

route('PATCH', '/api/students/:id/wanted/:skillId', async (req, body, p) => {
  const targetId = Number(p.id);
  if (!req.user || req.user.studentId !== targetId) throw new HttpError(403, 'Forbidden');
  await getStudent(targetId);
  const cur = await db.prepare('SELECT * FROM SKILL_WANTED WHERE StudentID=? AND SkillID=?').get(targetId, p.skillId);
  if (!cur) throw notFound('Entry not found');
  const targetGoal = body.targetGoal || body.learningGoal || body.description || cur.TargetGoal;
  const prefAvail = body.preferredAvailability || body.availability || cur.PreferredAvailability;

  await db.prepare(
    `UPDATE SKILL_WANTED SET
       DesiredLevel=?, Description=?, Priority=?, PreferredAvailability=?, TargetGoal=?
     WHERE StudentID=? AND SkillID=?`
  ).run(
    normalizeLevel(body.level || body.desiredLevel || body.preferredLevel, cur.DesiredLevel),
    body.description ?? targetGoal ?? cur.Description,
    ['High', 'Medium', 'Low'].includes(body.priority) ? body.priority : cur.Priority,
    prefAvail,
    targetGoal,
    targetId, p.skillId
  );
  const freshWanted = await wantedRows(targetId);
  return freshWanted.map((r) => mapWanted(r, targetId)).find((r) => r.SkillID === Number(p.skillId));
});

route('DELETE', '/api/students/:id/wanted/:skillId', async (req, body, p) => {
  const targetId = Number(p.id);
  if (!req.user || req.user.studentId !== targetId) throw new HttpError(403, 'Forbidden');
  const skillId = Number(p.skillId);
  const cur = await db.prepare('SELECT * FROM SKILL_WANTED WHERE StudentID = ? AND SkillID = ?').get(targetId, skillId);
  if (!cur) throw notFound('Entry not found');

  const acceptedExchanges = await db.prepare(
    "SELECT ExchangeID FROM EXCHANGE WHERE (TeacherID = ? OR LearnerID = ?) AND SkillID = ? AND Status = 'Accepted'"
  ).all(targetId, targetId, skillId);
  for (const ex of acceptedExchanges) {
    const sessions = await db.prepare("SELECT * FROM SESSION WHERE ExchangeID = ? AND Status = 'Scheduled'").all(ex.ExchangeID);
    if (sessions.some((s) => isFutureSession(s))) {
      throw new HttpError(409, 'You have upcoming sessions for this skill. Cancel them in Sessions first.');
    }
  }

  const deleter = await getStudent(targetId);
  const skillRow = await db.prepare('SELECT SkillName FROM SKILL WHERE SkillID = ?').get(skillId);
  const skillName = skillRow?.SkillName || 'this skill';

  const pendingExchanges = await db.prepare(
    "SELECT * FROM EXCHANGE WHERE LearnerID = ? AND SkillID = ? AND Status = 'Pending'"
  ).all(targetId, skillId);
  for (const ex of pendingExchanges) {
    await db.prepare("UPDATE EXCHANGE SET Status = 'Cancelled' WHERE ExchangeID = ?").run(ex.ExchangeID);
    await db.prepare(
      'INSERT INTO NOTIFICATION (StudentID, Type, Title, Message, Link, RelatedType, RelatedID) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      ex.TeacherID,
      'match',
      'Exchange Cancelled',
      `${deleter.Name} is no longer requesting ${skillName}`,
      '/matches',
      'exchange',
      String(ex.ExchangeID)
    );
  }

  const r = await db.prepare('DELETE FROM SKILL_WANTED WHERE StudentID = ? AND SkillID = ?').run(targetId, skillId);
  if (!r.changes) throw notFound('Entry not found');
  return [204];
});

route('GET', '/api/students/:id/requests', async (req, body, p) => {
  const targetId = Number(p.id);
  if (!req.user || req.user.studentId !== targetId) throw new HttpError(403, 'Forbidden');
  await getStudent(targetId);
  const rows = await wantedRows(targetId);
  return rows.map((r) => mapWanted(r, targetId));
});

// ---------- matching ----------
route('GET', '/api/students/:id/matches', async (req, body, p) => {
  const targetId = Number(p.id);
  if (!req.user || req.user.studentId !== targetId) throw new HttpError(403, 'Forbidden');
  await getStudent(targetId);
  const rows = await db.prepare(
    `SELECT t.StudentID AS TeacherID, t.Name AS TeacherName, t.Department, t.YearOfStudy, t.HostelBlock, t.Bio, t.Avatar,
            sk.SkillID, sk.SkillName, sk.Category, so.ProficiencyLevel, so.Description, so.Availability,
            EXISTS (
              SELECT 1 FROM SKILL_WANTED tw
              JOIN SKILL_OFFERED me ON me.SkillID = tw.SkillID AND me.StudentID = ?
              WHERE tw.StudentID = t.StudentID
            ) AS MutualExchange
     FROM SKILL_WANTED mw
     JOIN SKILL_OFFERED so ON so.SkillID = mw.SkillID
     JOIN STUDENT t ON t.StudentID = so.StudentID
     JOIN SKILL sk ON sk.SkillID = mw.SkillID
     WHERE mw.StudentID = ? AND t.StudentID <> ?
     ORDER BY MutualExchange DESC, (t.HostelBlock = (SELECT HostelBlock FROM STUDENT WHERE StudentID = ?)) DESC`
  ).all(targetId, targetId, targetId, targetId);

  return await Promise.all(rows.map(async (r) => {
    const rating = await teacherRating(r.TeacherID);
    const countData = await sessionCounts(r.TeacherID);
    const taught = countData.sessionsTaught;
    const wantRows = await db.prepare(
      `SELECT sk.SkillName FROM SKILL_WANTED sw JOIN SKILL sk ON sk.SkillID = sw.SkillID WHERE sw.StudentID = ?`
    ).all(r.TeacherID);
    const wants = wantRows.map((x) => x.SkillName);
    const matchId = `MAT-${String(r.TeacherID).padStart(4, '0')}`;

    return {
      id: `peer-${r.TeacherID}-${r.SkillID}`,
      matchId,
      Match_ID: matchId,
      studentId: displayStudentId(r.TeacherID),
      teacherId: r.TeacherID,
      skillId: r.SkillID,
      name: r.TeacherName,
      dept: [r.Department, r.YearOfStudy].filter(Boolean).join(' • '),
      avatar: r.Avatar || initials(r.TeacherName),
      avatarBg: avatarBg(r.TeacherID),
      rating: rating.reviews > 0 ? Number(rating.avgRating).toFixed(2) : null,
      reviewsCount: rating.reviews || 0,
      reviewCount: rating.reviews || 0,
      sessionsDelivered: taught,
      skillOffered: r.SkillName,
      category: r.Category,
      proficiencyLevel: r.ProficiencyLevel,
      availability: r.Availability || 'Flexible',
      bio: r.Bio || '',
      wantsToLearn: wants[0] || '',
      theyWant: wants[0] || '',
      matchReason: r.MutualExchange
        ? `Teaches ${r.SkillName} and also wants a skill you offer (mutual swap)`
        : `Teaches ${r.SkillName}, which is on your learning wishlist`,
      compatibilityScore: r.MutualExchange ? 96 : 84,
      mutualSwapAvailable: Boolean(r.MutualExchange),
      mutualSwap: Boolean(r.MutualExchange),
      overlapFactors: [
        'Direct Skill Wishlist Match',
        r.MutualExchange ? 'Mutual Reciprocal Skill Swap' : 'Teacher available for this skill',
      ],
      skillsOffered: [{ name: r.SkillName, category: r.Category }],
      teaching: [r.SkillName],
      skills: [r.SkillName, r.Category].filter(Boolean),
    };
  }));
});

// ---------- exchanges ----------
const EXCHANGE_SELECT =
  `SELECT e.ExchangeID, e.Status, e.RequestDate, e.Note, e.UpdatedAt, e.SkillID, sk.SkillName,
          e.TeacherID, t.Name AS TeacherName, t.Avatar AS TeacherAvatar, t.Department AS TeacherDept,
          e.LearnerID, l.Name AS LearnerName, l.Avatar AS LearnerAvatar, l.Department AS LearnerDept
   FROM EXCHANGE e
   JOIN SKILL sk ON sk.SkillID = e.SkillID
   JOIN STUDENT t ON t.StudentID = e.TeacherID
   JOIN STUDENT l ON l.StudentID = e.LearnerID`;

function mapExchange(e) {
  if (!e) return e;
  return {
    ...e,
    id: e.ExchangeID,
    exchangeId: e.ExchangeID,
    status: e.Status,
    requestDate: e.RequestDate,
    note: e.Note ?? null,
    updatedAt: e.UpdatedAt ?? null,
    skillId: e.SkillID,
    skillName: e.SkillName,
    teacherId: e.TeacherID,
    teacherName: e.TeacherName,
    teacherAvatar: e.TeacherAvatar,
    teacherDept: e.TeacherDept || '',
    teacherStudentId: displayStudentId(e.TeacherID),
    learnerId: e.LearnerID,
    learnerName: e.LearnerName,
    learnerAvatar: e.LearnerAvatar,
    learnerDept: e.LearnerDept || '',
    learnerStudentId: displayStudentId(e.LearnerID),
  };
}

route('POST', '/api/exchanges', async (req, body) => {
  required(body, 'teacherId', 'skillId');
  const learnerId = req.user.studentId;
  const teacherId = Number(body.teacherId);
  const skillId = Number(body.skillId);
  if (teacherId === learnerId) throw bad('Teacher and learner must be different students');
  await getStudent(teacherId);
  await getStudent(learnerId);
  const offers = await db.prepare('SELECT 1 FROM SKILL_OFFERED WHERE StudentID = ? AND SkillID = ?')
    .get(teacherId, skillId);
  if (!offers) throw bad('That student does not offer this skill');
  const dup = await db.prepare(
    `SELECT 1 FROM EXCHANGE WHERE TeacherID=? AND LearnerID=? AND SkillID=? AND Status IN ('Pending','Accepted')`
  ).get(teacherId, learnerId, skillId);
  if (dup) throw new HttpError(409, 'An open exchange already exists for this pair and skill');
  await db.prepare(
    `INSERT INTO SKILL_WANTED (StudentID, SkillID, DesiredLevel, Description, Priority)
     VALUES (?,?,?,?,?)
     ON CONFLICT(StudentID, SkillID) DO NOTHING`
  ).run(learnerId, skillId, 'Beginner', body.note ?? null, 'High');
  const r = await db.prepare('INSERT INTO EXCHANGE (TeacherID, LearnerID, SkillID, Note, UpdatedAt) VALUES (?,?,?,?, datetime(\'now\'))')
    .run(teacherId, learnerId, skillId, body.note ?? null);
  const exchangeRow = await db.prepare(`${EXCHANGE_SELECT} WHERE e.ExchangeID = ?`).get(r.lastInsertRowid);
  const createdEx = mapExchange(exchangeRow);

  // Automatically create notification for the teacher
  const requesterName = createdEx.LearnerName;
  await db.prepare(
    'INSERT INTO NOTIFICATION (StudentID, Type, Title, Message, Link, RelatedType, RelatedID) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    teacherId,
    'match',
    'New Exchange Request',
    `${requesterName} requested a skill exchange for ${createdEx.SkillName}.`,
    '/matches#requests',
    'exchange',
    String(createdEx.ExchangeID)
  );

  await checkAndAwardBadges(teacherId);
  await checkAndAwardBadges(learnerId);

  return [201, createdEx];
});

route('GET', '/api/exchanges', async (req, body, p, q) => {
  const sid = req.user.studentId;
  const status = q ? q.get('status') : null;
  let sql = EXCHANGE_SELECT + ' WHERE (e.TeacherID = ? OR e.LearnerID = ?)';
  const args = [sid, sid];
  if (status) { sql += ' AND e.Status = ?'; args.push(status); }
  const rows = await db.prepare(sql + ' ORDER BY e.ExchangeID DESC').all(...args);
  return rows.map(mapExchange);
});

route('GET', '/api/exchanges/:id', async (req, body, p) => {
  const ex = await getExchange(p.id);
  if (req.user.studentId !== Number(ex.TeacherID) && req.user.studentId !== Number(ex.LearnerID)) {
    throw new HttpError(403, 'Forbidden');
  }
  const row = await db.prepare(`${EXCHANGE_SELECT} WHERE e.ExchangeID = ?`).get(p.id);
  return mapExchange(row);
});

const TRANSITIONS = {
  Pending: ['Accepted', 'Rejected', 'Cancelled'],
  Accepted: ['Completed', 'Cancelled'],
  Completed: [], Rejected: [], Cancelled: [],
};
route('PATCH', '/api/exchanges/:id/status', async (req, body, p) => {
  required(body, 'status');
  const ex = await getExchange(p.id);
  if (!TRANSITIONS[ex.Status].includes(body.status)) {
    throw bad(`Cannot change status from ${ex.Status} to ${body.status}`);
  }

  // Permissions in PATCH /api/exchanges/:id/status: require the acting student's id from token only
  const actingStudentId = req.user.studentId;
  const isTeacher = actingStudentId === Number(ex.TeacherID);
  const isLearner = actingStudentId === Number(ex.LearnerID);

  if (!isTeacher && !isLearner) {
    throw new HttpError(403, "Only exchange participants can modify status");
  }
  if (body.status === 'Accepted' || body.status === 'Rejected') {
    if (!isTeacher) {
      throw new HttpError(403, "Only the teacher may accept or reject an exchange request");
    }
  } else if (body.status === 'Cancelled') {
    if (!isTeacher && !isLearner) {
      throw new HttpError(403, "Only the learner or teacher may cancel an exchange");
    }
  } else if (body.status === 'Completed') {
    if (!isTeacher) {
      throw new HttpError(403, "Only the teacher may mark an exchange completed");
    }
  } else {
    throw new HttpError(403, "Unauthorized status change");
  }

  await db.prepare("UPDATE EXCHANGE SET Status = ?, UpdatedAt = datetime('now') WHERE ExchangeID = ?").run(body.status, p.id);
  const updatedRow = await db.prepare(`${EXCHANGE_SELECT} WHERE e.ExchangeID = ?`).get(p.id);
  const updated = mapExchange(updatedRow);

  // Automatically create notification for the other student on Accepted, Rejected, Cancelled
  if (['Accepted', 'Rejected', 'Cancelled'].includes(body.status)) {
    const targetStudentId = isTeacher ? updated.LearnerID : updated.TeacherID;
    const actorName = isTeacher ? updated.TeacherName : updated.LearnerName;

    let title = 'Exchange Update';
    let message = `Exchange for ${updated.SkillName} was updated to ${body.status}.`;
    let link = '/matches#requests';

    if (body.status === 'Accepted') {
      title = 'Exchange Request Accepted';
      message = `${actorName} accepted your ${updated.SkillName} exchange.`;
      link = '/sessions';
    } else if (body.status === 'Rejected') {
      title = 'Exchange Request Declined';
      message = `${actorName} declined your ${updated.SkillName} exchange request.`;
      link = '/matches#requests';
    } else if (body.status === 'Cancelled') {
      title = 'Exchange Cancelled';
      message = `${actorName} cancelled the exchange for ${updated.SkillName}.`;
      link = '/matches#requests';
    }

    await db.prepare(
      'INSERT INTO NOTIFICATION (StudentID, Type, Title, Message, Link, RelatedType, RelatedID) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(targetStudentId, 'match', title, message, link, 'exchange', String(updated.ExchangeID));
  }

  if (body.status === 'Completed') {
    await checkAndAwardBadges(updated.TeacherID);
    await checkAndAwardBadges(updated.LearnerID);
  }

  return updated;
});

// ---------- sessions ----------
route('GET', '/api/exchanges/:id/sessions', async (req, body, p) => {
  const ex = await getExchange(p.id);
  if (req.user.studentId !== Number(ex.TeacherID) && req.user.studentId !== Number(ex.LearnerID)) {
    throw new HttpError(403, 'Forbidden');
  }
  return await db.prepare('SELECT * FROM SESSION WHERE ExchangeID = ? ORDER BY SessionDate').all(p.id);
});

route('POST', '/api/exchanges/:id/sessions', async (req, body, p) => {
  required(body, 'sessionDate');
  const ex = await getExchange(p.id);
  if (req.user.studentId !== Number(ex.TeacherID) && req.user.studentId !== Number(ex.LearnerID)) {
    throw new HttpError(403, 'Forbidden');
  }
  if (!['Accepted', 'Completed'].includes(ex.Status)) {
    throw new HttpError(409, 'Sessions can only be scheduled for accepted exchanges');
  }
  const isOnline = body.mode === 'Online' || /meet|zoom|online/i.test(String(body.mode || body.link || body.meetingLink || ''));
  const mode = isOnline ? 'Online' : (body.mode ?? 'Offline');
  const link = body.meetingLink ?? body.link ?? null;
  const notes = body.notes ?? null;

  const r = await db.prepare(
    `INSERT INTO SESSION (
      ExchangeID, SessionDate, StartTime, DurationMins, Topic, Mode, Location, Status, MeetingLink, Notes
    ) VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(
    p.id,
    body.sessionDate,
    body.startTime ?? null,
    body.durationMins ?? 60,
    body.topic ?? body.skill ?? null,
    mode,
    body.location ?? link ?? null,
    'Scheduled',
    link,
    notes
  );
  const createdSession = await db.prepare('SELECT * FROM SESSION WHERE SessionID = ?').get(r.lastInsertRowid);

  // Notify other student of session booked (creatorId from token only)
  const creatorId = req.user.studentId;
  const targetId = creatorId === Number(ex.TeacherID) ? ex.LearnerID : ex.TeacherID;
  const exDetails = await db.prepare(`${EXCHANGE_SELECT} WHERE e.ExchangeID = ?`).get(p.id);
  const creatorName = creatorId === Number(ex.TeacherID) ? exDetails.TeacherName : exDetails.LearnerName;
  await db.prepare(
    'INSERT INTO NOTIFICATION (StudentID, Type, Title, Message, Link, RelatedType, RelatedID) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    targetId,
    'session',
    'Session Scheduled',
    `${creatorName} scheduled a session for ${exDetails.SkillName} on ${body.sessionDate}.`,
    '/sessions',
    'session',
    String(createdSession.SessionID)
  );

  await checkAndAwardBadges(ex.TeacherID);
  await checkAndAwardBadges(ex.LearnerID);

  return [201, createdSession];
});

route('GET', '/api/students/:id/sessions', async (req, body, p) => {
  const targetId = Number(p.id);
  if (!req.user || req.user.studentId !== targetId) throw new HttpError(403, 'Forbidden');
  await getStudent(targetId);
  const reviewedRows = await db.prepare('SELECT ExchangeID FROM FEEDBACK WHERE GivenBy = ?').all(targetId);
  const reviewedSet = new Set(reviewedRows.map((r) => r.ExchangeID));
  const rows = await db.prepare(`${SESSION_SELECT} WHERE e.TeacherID = ? OR e.LearnerID = ? ORDER BY s.SessionDate DESC`)
    .all(targetId, targetId);
  return rows.map((row) => {
    const s = mapSession(row, targetId);
    const hasReviewed = reviewedSet.has(row.ExchangeID);
    return {
      ...s,
      hasReviewed,
      canReview: s.status === 'Completed' && !hasReviewed,
    };
  });
});

route('PATCH', '/api/sessions/:id', async (req, body, p) => {
  const rawId = typeof p.id === 'string' ? Number(p.id.replace(/^SES-0*/i, '')) : Number(p.id);
  const sess = await db.prepare('SELECT * FROM SESSION WHERE SessionID = ?').get(rawId);
  if (!sess) throw notFound('Session not found');
  const ex = await getExchange(sess.ExchangeID);
  if (req.user.studentId !== Number(ex.TeacherID) && req.user.studentId !== Number(ex.LearnerID)) {
    throw new HttpError(403, 'Forbidden');
  }

  let status = body.status;
  if (status === 'Upcoming') status = 'Scheduled';
  if (status && !['Scheduled', 'Completed', 'Cancelled'].includes(status)) {
    throw bad('Invalid session status');
  }
  const link = body.meetingLink ?? body.link;
  const notes = body.notes;

  await db.prepare(
    `UPDATE SESSION SET
       Status = COALESCE(?, Status),
       Topic = COALESCE(?, Topic),
       Location = COALESCE(?, Location),
       SessionDate = COALESCE(?, SessionDate),
       MeetingLink = COALESCE(?, MeetingLink),
       Notes = COALESCE(?, Notes)
     WHERE SessionID = ?`
  ).run(status ?? null, body.topic ?? null, body.location ?? link ?? null, body.sessionDate ?? null, link ?? null, notes ?? null, rawId);

  if (status === 'Completed') {
    await db.prepare("UPDATE EXCHANGE SET Status = 'Completed' WHERE ExchangeID = ?").run(sess.ExchangeID);
    await checkAndAwardBadges(ex.TeacherID);
    await checkAndAwardBadges(ex.LearnerID);
  }

  // Automatic notification for session cancelled or rescheduled (actorId from token only)
  const actorId = req.user.studentId;
  const targetId = actorId === Number(ex.TeacherID) ? ex.LearnerID : ex.TeacherID;
  const skill = await db.prepare('SELECT SkillName FROM SKILL WHERE SkillID = ?').get(ex.SkillID);

  if (status === 'Cancelled') {
    await db.prepare(
      'INSERT INTO NOTIFICATION (StudentID, Type, Title, Message, Link, RelatedType, RelatedID) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      targetId,
      'session',
      'Session Cancelled',
      `Session for ${skill?.SkillName || 'skill exchange'} was cancelled.`,
      '/sessions',
      'session',
      String(rawId)
    );
  } else if ((body.sessionDate && body.sessionDate !== sess.SessionDate) || (body.startTime && body.startTime !== sess.StartTime)) {
    await db.prepare(
      'INSERT INTO NOTIFICATION (StudentID, Type, Title, Message, Link, RelatedType, RelatedID) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      targetId,
      'session',
      'Session Rescheduled',
      `Session for ${skill?.SkillName || 'skill exchange'} rescheduled to ${body.sessionDate || sess.SessionDate}.`,
      '/sessions',
      'session',
      String(rawId)
    );
  }

  const row = await db.prepare(`${SESSION_SELECT} WHERE s.SessionID = ?`).get(rawId);
  return mapSession(row, actorId);
});

route('POST', '/api/sessions', async (req, body) => {
  if (body.exchangeId) {
    required(body, 'sessionDate');
    const ex = await getExchange(body.exchangeId);
    if (req.user.studentId !== Number(ex.TeacherID) && req.user.studentId !== Number(ex.LearnerID)) {
      throw new HttpError(403, 'Forbidden');
    }
    if (!['Accepted', 'Completed'].includes(ex.Status)) {
      throw new HttpError(409, 'Sessions can only be scheduled for accepted exchanges');
    }
    const isOnline = body.mode === 'Online' || /meet|zoom|online/i.test(String(body.mode || body.link || body.meetingLink || ''));
    const mode = isOnline ? 'Online' : (body.mode ?? 'Offline');
    const link = body.meetingLink ?? body.link ?? null;
    const notes = body.notes ?? null;

    const r = await db.prepare(
      `INSERT INTO SESSION (
        ExchangeID, SessionDate, StartTime, DurationMins, Topic, Mode, Location, Status, MeetingLink, Notes
      ) VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(
      ex.ExchangeID,
      body.sessionDate,
      body.startTime ?? null,
      body.durationMins ?? 60,
      body.topic ?? body.skill ?? null,
      mode,
      body.location ?? link ?? null,
      'Scheduled',
      link,
      notes
    );
    const row = await db.prepare(`${SESSION_SELECT} WHERE s.SessionID = ?`).get(r.lastInsertRowid);

    // Notify other student of session booked (actorId from token only)
    const actorId = req.user.studentId;
    const targetId = actorId === Number(ex.TeacherID) ? ex.LearnerID : ex.TeacherID;
    const exDetails = await db.prepare(`${EXCHANGE_SELECT} WHERE e.ExchangeID = ?`).get(ex.ExchangeID);
    const actorName = actorId === Number(ex.TeacherID) ? exDetails.TeacherName : exDetails.LearnerName;

    await db.prepare(
      'INSERT INTO NOTIFICATION (StudentID, Type, Title, Message, Link, RelatedType, RelatedID) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      targetId,
      'session',
      'Session Scheduled',
      `${actorName} scheduled a session for ${exDetails.SkillName} on ${body.sessionDate}.`,
      '/sessions',
      'session',
      String(row.SessionID)
    );

    await checkAndAwardBadges(actorId);
    await checkAndAwardBadges(targetId);

    return [201, mapSession(row, actorId)];
  }

  required(body, 'teacherId', 'learnerId', 'sessionDate');
  const teacherId = Number(body.teacherId);
  const learnerId = Number(body.learnerId);
  if (req.user.studentId !== teacherId && req.user.studentId !== learnerId) {
    throw new HttpError(403, 'Forbidden');
  }
  if (teacherId === learnerId) throw bad('Teacher and learner must be different students');
  let skillId = body.skillId;
  if (!skillId && (body.skill || body.skillName)) {
    const sk = await findOrCreateSkill(body.skill || body.skillName, body.category || 'General');
    skillId = sk.SkillID;
  }
  if (!skillId) throw bad('skillId is required');

  const ex = await db.prepare(
    `SELECT * FROM EXCHANGE WHERE ((TeacherID=? AND LearnerID=?) OR (TeacherID=? AND LearnerID=?)) AND SkillID=?
     ORDER BY ExchangeID DESC LIMIT 1`
  ).get(teacherId, learnerId, learnerId, teacherId, skillId);

  if (!ex || !['Accepted', 'Completed'].includes(ex.Status)) {
    throw new HttpError(409, 'Sessions can only be scheduled for accepted exchanges');
  }

  const isOnline = body.mode === 'Online' || /meet|zoom|online/i.test(String(body.mode || body.link || body.meetingLink || ''));
  const mode = isOnline ? 'Online' : 'Offline';
  const link = body.meetingLink ?? body.link ?? null;
  const notes = body.notes ?? null;

  const r = await db.prepare(
    `INSERT INTO SESSION (
      ExchangeID, SessionDate, StartTime, DurationMins, Topic, Mode, Location, Status, MeetingLink, Notes
    ) VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(
    ex.ExchangeID,
    body.sessionDate,
    body.startTime ?? null,
    body.durationMins ?? 60,
    body.topic ?? body.skill ?? null,
    mode,
    body.location ?? link ?? null,
    'Scheduled',
    link,
    notes
  );
  const row = await db.prepare(`${SESSION_SELECT} WHERE s.SessionID = ?`).get(r.lastInsertRowid);

  // Notify other student of session booked (actorId from token only)
  const actorId = req.user.studentId;
  const targetId = actorId === teacherId ? learnerId : teacherId;
  const sessionSkill = await db.prepare('SELECT SkillName FROM SKILL WHERE SkillID = ?').get(skillId);
  const actorStudent = await getStudent(actorId);

  await db.prepare(
    'INSERT INTO NOTIFICATION (StudentID, Type, Title, Message, Link, RelatedType, RelatedID) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    targetId,
    'session',
    'Session Scheduled',
    `${actorStudent.Name} scheduled a session for ${sessionSkill?.SkillName || 'skill exchange'} on ${body.sessionDate}.`,
    '/sessions',
    'session',
    String(row.SessionID)
  );

  await checkAndAwardBadges(teacherId);
  await checkAndAwardBadges(learnerId);

  return [201, mapSession(row, actorId)];
});

// ---------- feedback ----------
route('GET', '/api/exchanges/:id/feedback', async (req, body, p) => {
  const ex = await getExchange(p.id);
  if (req.user.studentId !== Number(ex.TeacherID) && req.user.studentId !== Number(ex.LearnerID)) {
    throw new HttpError(403, 'Forbidden');
  }
  return await db.prepare(
    `SELECT f.*, s.Name AS GivenByName FROM FEEDBACK f
     JOIN STUDENT s ON s.StudentID = f.GivenBy WHERE f.ExchangeID = ?`).all(p.id);
});

route('POST', '/api/exchanges/:id/feedback', async (req, body, p) => {
  required(body, 'rating');
  const ex = await getExchange(p.id);
  if (ex.Status !== 'Completed') throw bad('Feedback can only be given for completed exchanges');
  const givenBy = req.user.studentId;
  if (![Number(ex.TeacherID), Number(ex.LearnerID)].includes(givenBy)) {
    throw new HttpError(403, 'Only the teacher or learner of this exchange can leave feedback');
  }

  const clarity = body.clarityRating ? Number(body.clarityRating) : null;
  const patience = body.patienceRating ? Number(body.patienceRating) : null;
  const punctuality = body.punctualityRating ? Number(body.punctualityRating) : null;
  const wouldRec = body.wouldRecommend === false || body.wouldRecommend === 0 ? 0 : 1;

  const r = await db.prepare(
    `INSERT INTO FEEDBACK (
      ExchangeID, GivenBy, Rating, Comments, ClarityRating, PatienceRating, PunctualityRating, WouldRecommend
    ) VALUES (?,?,?,?,?,?,?,?)`
  ).run(p.id, givenBy, body.rating, body.comments ?? body.comment ?? null, clarity, patience, punctuality, wouldRec);

  const fb = await db.prepare('SELECT * FROM FEEDBACK WHERE FeedbackID = ?').get(r.lastInsertRowid);
  const reviewer = await getStudent(givenBy);
  const feedbackSkill = await db.prepare('SELECT SkillName FROM SKILL WHERE SkillID = ?').get(ex.SkillID);

  // Notify reviewed student
  const reviewedStudentId = givenBy === Number(ex.TeacherID) ? ex.LearnerID : ex.TeacherID;
  await db.prepare(
    'INSERT INTO NOTIFICATION (StudentID, Type, Title, Message, Link, RelatedType, RelatedID) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    reviewedStudentId,
    'review',
    'New Review Received',
    `${reviewer.Name} left you a ${body.rating}-star review for ${feedbackSkill?.SkillName || 'skill exchange'}.`,
    '/profile',
    'feedback',
    String(fb.FeedbackID)
  );

  await checkAndAwardBadges(reviewedStudentId);
  await checkAndAwardBadges(givenBy);

  return [201, fb];
});

route('GET', '/api/students/:id/feedback', async (req, body, p, q) => {
  const targetId = Number(p.id);
  if (!req.user || req.user.studentId !== targetId) throw new HttpError(403, 'Forbidden');
  await getStudent(targetId);
  const type = q ? (q.get('type') || 'all') : 'all';
  const rows = await listFeedbackForStudent(targetId, type);
  return await Promise.all(rows.map((row) => mapReview(row, targetId)));
});

route('GET', '/api/students/:id/reviewable', async (req, body, p) => {
  const targetId = Number(p.id);
  if (!req.user || req.user.studentId !== targetId) throw new HttpError(403, 'Forbidden');
  await getStudent(targetId);

  const reviewedRows = await db.prepare('SELECT ExchangeID FROM FEEDBACK WHERE GivenBy = ?').all(targetId);
  const reviewedSet = new Set(reviewedRows.map((r) => r.ExchangeID));

  const exchanges = await db.prepare(
    `${EXCHANGE_SELECT} WHERE (e.TeacherID = ? OR e.LearnerID = ?) AND e.Status = 'Completed' ORDER BY e.ExchangeID DESC`
  ).all(targetId, targetId);

  const sessions = await db.prepare(
    `${SESSION_SELECT} WHERE (e.TeacherID = ? OR e.LearnerID = ?) AND (s.Status = 'Completed' OR e.Status = 'Completed') ORDER BY s.SessionDate DESC`
  ).all(targetId, targetId);

  const sessionByExchange = {};
  for (const s of sessions) {
    if (!sessionByExchange[s.ExchangeID]) {
      sessionByExchange[s.ExchangeID] = s;
    }
  }

  const reviewList = [];
  for (const ex of exchanges) {
    if (reviewedSet.has(ex.ExchangeID)) continue;
    const isTeacher = Number(ex.TeacherID) === targetId;
    const partnerId = isTeacher ? ex.LearnerID : ex.TeacherID;
    const partnerName = isTeacher ? ex.LearnerName : ex.TeacherName;
    const partnerDept = isTeacher ? (ex.LearnerDept || '') : (ex.TeacherDept || '');
    const sess = sessionByExchange[ex.ExchangeID];
    const sessionDate = sess ? sess.SessionDate : (ex.RequestDate ? String(ex.RequestDate).split(' ')[0] : new Date().toISOString().split('T')[0]);
    const sessionTopic = sess ? (sess.Topic || sess.SkillName) : (ex.Note || ex.SkillName);

    reviewList.push({
      exchangeId: ex.ExchangeID,
      ExchangeID: ex.ExchangeID,
      sessionId: sess ? sess.SessionID : null,
      SessionID: sess ? sess.SessionID : null,
      role: isTeacher ? 'Teacher' : 'Learner',
      partnerId,
      partnerStudentId: displayStudentId(partnerId),
      partnerName,
      partnerDept,
      name: partnerName,
      studentId: displayStudentId(partnerId),
      department: partnerDept,
      skill: ex.SkillName,
      skillName: ex.SkillName,
      date: sessionDate,
      sessionDate,
      topic: sessionTopic,
      sessionTopic,
    });
  }

  return reviewList;
});

// ---------- availability ----------
route('GET', '/api/students/:id/availability', async (req, body, p) => {
  const targetId = Number(p.id);
  if (!req.user || req.user.studentId !== targetId) throw new HttpError(403, 'Forbidden');
  await getStudent(targetId);
  return await getAvailability(targetId);
});

route('PUT', '/api/students/:id/availability', async (req, body, p) => {
  const targetId = Number(p.id);
  if (!req.user || req.user.studentId !== targetId) throw new HttpError(403, 'Forbidden');
  await getStudent(targetId);
  const days = body.days || body.weeklyAvailability || body;
  if (!Array.isArray(days)) throw bad('days array is required');
  await db.exec('BEGIN');
  try {
    await db.prepare('DELETE FROM AVAILABILITY WHERE StudentID = ?').run(targetId);
    const ins = db.prepare(
      'INSERT INTO AVAILABILITY (StudentID, DayOfWeek, StartTime, EndTime, Label, Enabled) VALUES (?,?,?,?,?,?)'
    );
    for (const day of days) {
      const dayName = day.day || day.DayOfWeek;
      const enabled = day.enabled === false ? 0 : 1;
      for (const slot of (day.slots || [])) {
        await ins.run(targetId, dayName, slot.start, slot.end, slot.period || slot.label || null, enabled);
      }
    }
    await db.exec('COMMIT');
  } catch (err) {
    await db.exec('ROLLBACK');
    throw err;
  }
  return await getAvailability(targetId);
});

// ---------- messages ----------
route('GET', '/api/students/:id/conversations', async (req, body, p) => {
  const targetId = Number(p.id);
  if (!req.user || req.user.studentId !== targetId) throw new HttpError(403, 'Forbidden');
  await touchStudentLastSeen(targetId);
  await getStudent(targetId);
  return await conversationsFor(targetId);
});

route('GET', '/api/students/:id/messages/:peerId', async (req, body, p) => {
  const targetId = Number(p.id);
  if (!req.user || req.user.studentId !== targetId) throw new HttpError(403, 'Forbidden');
  await touchStudentLastSeen(targetId);
  await getStudent(targetId);
  const peer = await getStudent(p.peerId);
  const convList = await conversationsFor(targetId);
  const conv = convList.find((c) => Number(c.peerId) === Number(p.peerId));
  if (conv) return conv;
  return {
    id: `conv-${p.peerId}`,
    peerId: Number(p.peerId),
    peerName: peer.Name,
    peerDept: [peer.Department, peer.YearOfStudy].filter(Boolean).join(' • '),
    peerAvatar: peer.Avatar || initials(peer.Name),
    avatarBg: avatarBg(p.peerId),
    onlineStatus: isStudentOnline(peer.LastSeenAt) ? 'online' : 'offline',
    lastActive: '',
    skillContext: 'Peer knowledge exchange',
    unreadCount: 0,
    messages: [],
  };
});

route('POST', '/api/messages', async (req, body) => {
  required(body, 'receiverId', 'body');
  const senderId = req.user.studentId;
  const receiverId = Number(body.receiverId);
  if (senderId === receiverId) throw bad('Cannot message yourself');
  await touchStudentLastSeen(senderId);
  const sender = await getStudent(senderId);
  await getStudent(receiverId);
  const r = await db.prepare('INSERT INTO MESSAGE (SenderID, ReceiverID, Body) VALUES (?,?,?)')
    .run(senderId, receiverId, String(body.body).trim());
  const msg = await db.prepare('SELECT * FROM MESSAGE WHERE MessageID = ?').get(r.lastInsertRowid);

  // Notify receiver of new message
  const preview = String(body.body).trim();
  const snippet = preview.length > 50 ? preview.slice(0, 50) + '...' : preview;
  await db.prepare(
    'INSERT INTO NOTIFICATION (StudentID, Type, Title, Message, Link, RelatedType, RelatedID) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    receiverId,
    'message',
    'New Message',
    `${sender.Name} sent you a message: "${snippet}"`,
    '/messages',
    'message',
    String(msg.MessageID)
  );

  return [201, msg];
});

route('PATCH', '/api/students/:id/messages/:peerId/read', async (req, body, p) => {
  const targetId = Number(p.id);
  if (!req.user || req.user.studentId !== targetId) throw new HttpError(403, 'Forbidden');
  await touchStudentLastSeen(targetId);
  await db.prepare('UPDATE MESSAGE SET IsRead = 1 WHERE ReceiverID = ? AND SenderID = ?').run(targetId, p.peerId);
  return { ok: true };
});

// ---------- dashboard ----------
route('GET', '/api/students/:id/dashboard', async (req, body, p) => {
  const targetId = Number(p.id);
  if (!req.user || req.user.studentId !== targetId) throw new HttpError(403, 'Forbidden');
  const student = await hydrateStudent(targetId);
  const allSessions = await db.prepare(`${SESSION_SELECT} WHERE e.TeacherID = ? OR e.LearnerID = ? ORDER BY s.SessionDate ASC`)
    .all(targetId, targetId);
  const futureSessions = allSessions
    .filter((row) => isFutureSession(row))
    .map((row) => mapSession(row, targetId));
  const matchesRow = await db.prepare(
    `SELECT COUNT(*) AS n FROM SKILL_WANTED mw
     JOIN SKILL_OFFERED so ON so.SkillID = mw.SkillID
     WHERE mw.StudentID = ? AND so.StudentID <> ?`
  ).get(targetId, targetId);
  const matches = matchesRow ? matchesRow.n : 0;
  const convos = await conversationsFor(targetId);
  const incoming = await db.prepare(
    `${EXCHANGE_SELECT} WHERE e.TeacherID = ? AND e.Status = 'Pending' ORDER BY e.ExchangeID DESC`
  ).all(targetId);
  const feedbackRaw = await listFeedbackForStudent(targetId);
  const reviews = await Promise.all(feedbackRaw.slice(0, 6).map((row) => mapReview(row, targetId)));

  return {
    student,
    stats: {
      skillsOffered: student.skillsOffered.length,
      skillsWanted: student.skillsWanted.length,
      upcomingSessions: futureSessions.length,
      matches,
      sessionsTaught: student.sessionsTaught,
      sessionsAttended: student.sessionsAttended,
      rating: student.rating,
      reviewsCount: student.reviewsCount || 0,
      reviewCount: student.reviewCount || 0,
      powerLevel: student.powerLevel,
      rank: student.rank,
    },
    upcomingSessions: futureSessions,
    recentMessages: convos.slice(0, 5).map((c) => ({
      id: c.id,
      sender: c.peerName,
      avatar: c.peerAvatar,
      snippet: c.messages.length ? c.messages[c.messages.length - 1].text : '',
      time: c.lastActive,
      unread: c.unreadCount > 0,
    })),
    recentReviews: reviews,
    incomingRequests: incoming,
    conversations: convos,
    availability: await getAvailability(targetId),
  };
});

// ---------- reports ----------
route('GET', '/api/reports/top-teachers', async () =>
  await db.prepare(
    `SELECT t.StudentID, t.Name, COUNT(f.FeedbackID) AS Reviews, ROUND(AVG(f.Rating), 2) AS AvgRating
     FROM EXCHANGE e
     JOIN STUDENT t ON t.StudentID = e.TeacherID
     JOIN FEEDBACK f ON f.ExchangeID = e.ExchangeID AND f.GivenBy = e.LearnerID
     GROUP BY t.StudentID, t.Name
     HAVING COUNT(f.FeedbackID) >= 1
     ORDER BY AvgRating DESC, Reviews DESC`
  ).all());

route('GET', '/api/reports/popular-skills', async () =>
  await db.prepare(
    `SELECT * FROM (
       SELECT sk.SkillID, sk.SkillName, sk.Category,
              (SELECT COUNT(*) FROM SKILL_OFFERED so WHERE so.SkillID = sk.SkillID) AS Teachers,
              (SELECT COUNT(*) FROM SKILL_WANTED sw WHERE sw.SkillID = sk.SkillID) AS Learners,
              (SELECT COUNT(*) FROM EXCHANGE e WHERE e.SkillID = sk.SkillID) AS TotalExchanges
       FROM SKILL sk
     ) sub
     ORDER BY (Teachers + Learners + TotalExchanges) DESC`
  ).all());

route('GET', '/api/reports/exchange-summary', async () =>
  await db.prepare(
    `SELECT Status, COUNT(*) AS Count, ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM EXCHANGE), 1) AS Pct
     FROM EXCHANGE GROUP BY Status ORDER BY Count DESC`
  ).all());

// =============================================================================
// SERVER DISPATCHER
// =============================================================================
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return send(res, 204);
  }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    const isExempt =
      (req.method === 'GET' && url.pathname === '/api/health') ||
      (req.method === 'POST' && url.pathname === '/api/login') ||
      (req.method === 'POST' && url.pathname === '/api/register') ||
      (req.method === 'GET' && url.pathname === '/api/leaderboard');

    let actingUser = null;
    const authHeader = req.headers['authorization'];
    if (authHeader) {
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (match) {
        actingUser = verifyToken(match[1].trim());
      }
    }

    if (!isExempt) {
      if (!actingUser) {
        throw new HttpError(401, 'Unauthorized');
      }
      req.user = actingUser;
      await touchStudentLastSeen(actingUser.studentId);
    } else if (actingUser) {
      req.user = actingUser;
      await touchStudentLastSeen(actingUser.studentId);
    }

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.regex);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : {};
      const out = await r.handler(req, body, params, url.searchParams);
      if (Array.isArray(out) && typeof out[0] === 'number') return send(res, out[0], out[1]);
      return send(res, 200, out);
    }
    throw notFound(`No route for ${req.method} ${url.pathname}`);
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    const msg = String(err.message || err);
    if (err.code === '23505' || /UNIQUE constraint|duplicate key value/i.test(msg)) {
      return send(res, 409, { error: 'Already exists: ' + (err.detail || msg.split(': ').pop()) });
    }
    if (err.code === '23503' || /FOREIGN KEY constraint|violates foreign key/i.test(msg)) {
      return send(res, 400, { error: 'Referenced student, skill or exchange does not exist' });
    }
    if (err.code === '23514' || err.code === '23502' || /CHECK constraint|NOT NULL constraint|violates check|violates not-null/i.test(msg)) {
      return send(res, 400, { error: 'Invalid value: ' + msg });
    }
    console.error(err);
    send(res, 500, { error: 'Internal server error' });
  }
});

async function maybeSeedDemo() {
  if (process.env.SEED_DEMO === 'true' || process.env.SEED_DEMO === '1') {
    try {
      console.log('SEED_DEMO is true: checking and seeding demo data...');
      const { seedDatabase } = require('./seed');
      if (typeof seedDatabase === 'function') {
        await seedDatabase();
      }
    } catch (err) {
      console.error('Error during demo seeding:', err);
    }
  }
}

if (require.main === module) {
  (async () => {
    if (typeof runMigrations === 'function') await runMigrations();
    await maybeSeedDemo();
    server.listen(PORT, () => console.log(`Skill Exchange API running on http://localhost:${PORT}`));
  })();
}

module.exports = { server, maybeSeedDemo };
