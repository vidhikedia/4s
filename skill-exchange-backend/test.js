const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Isolated temporary database for testing - never touches skillexchange.db
const isPostgres = Boolean(process.env.DATABASE_URL && (process.env.DATABASE_URL.startsWith('postgres://') || process.env.DATABASE_URL.startsWith('postgresql://')));
const tempDbPath = !isPostgres ? path.join(os.tmpdir(), `test_skillexchange_${Date.now()}_${Math.random().toString(36).slice(2)}.db`) : '';
if (!isPostgres) {
  process.env.DB_PATH = tempDbPath;
}

// Seed fresh data into isolated temp database
const { seedDatabase } = require('./seed');
const { db } = require('./db');
const { server } = require('./server');

let BASE = '';
let testServer = null;
let passed = 0, failed = 0;
let CURRENT_TOKEN = '';

async function call(method, path, body, headers = {}) {
  const reqHeaders = { 'Content-Type': 'application/json', ...headers };
  if (!('Authorization' in headers) && CURRENT_TOKEN) {
    reqHeaders['Authorization'] = `Bearer ${CURRENT_TOKEN}`;
  }
  if (headers && headers.Authorization === '') {
    delete reqHeaders['Authorization'];
  }
  const res = await fetch(BASE + path, {
    method,
    headers: reqHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, headers: res.headers };
}

function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  PASS', name); }
  else { failed++; console.log('  FAIL', name, extra); }
}

(async () => {
  await seedDatabase();

  // Start in-process test server on an ephemeral free port (port 0)
  await new Promise((resolve, reject) => {
    testServer = server.listen(0, '127.0.0.1', (err) => {
      if (err) return reject(err);
      const port = testServer.address().port;
      BASE = `http://127.0.0.1:${port}`;
      console.log(`Running isolated tests on ${BASE} (temp db: ${tempDbPath})\n`);
      resolve();
    });
  });

  let r;
  console.log('CORS & OPTIONS preflight');
  const optRes = await call('OPTIONS', '/api/students', null, {
    'Origin': 'http://localhost:5173',
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'authorization, content-type',
  });
  const allowHeaders = optRes.headers.get('access-control-allow-headers') || '';
  const allowOrigin = optRes.headers.get('access-control-allow-origin') || '';
  check('OPTIONS preflight -> 204', optRes.status === 204);
  check('OPTIONS allows Authorization and Content-Type', /Authorization/i.test(allowHeaders) && /Content-Type/i.test(allowHeaders), allowHeaders);
  check('OPTIONS does not allow X-Student-Id', !/X-Student-Id/i.test(allowHeaders), allowHeaders);
  check('OPTIONS has correct FRONTEND_ORIGIN and no wildcard', allowOrigin === 'http://localhost:5173' && allowOrigin !== '*', allowOrigin);

  console.log('Authentication & Token validation');
  // 1. Missing token -> 401
  const noTokenRes = await call('GET', '/api/students', null, { Authorization: '' });
  check('no token gives 401', noTokenRes.status === 401);

  // 2. Bad / tampered token -> generic 401
  const badTokenRes = await call('GET', '/api/students', null, { Authorization: 'Bearer bad.tampered.token' });
  check('bad/tampered token gives generic 401', badTokenRes.status === 401 && badTokenRes.data.error === 'Unauthorized');

  // 3. Expired token -> generic 401
  const secret = process.env.JWT_SECRET || '4s-dev-jwt-secret-key-change-in-prod';
  const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const expiredPayload = Buffer.from(JSON.stringify({ studentId: 1, email: 't@campus.edu', exp: Math.floor(Date.now() / 1000) - 3600 })).toString('base64url');
  const expSig = crypto.createHmac('sha256', secret).update(`${headerB64}.${expiredPayload}`).digest('base64url');
  const expiredToken = `${headerB64}.${expiredPayload}.${expSig}`;
  const expiredRes = await call('GET', '/api/students', null, { Authorization: `Bearer ${expiredToken}` });
  check('expired token gives generic 401', expiredRes.status === 401 && expiredRes.data.error === 'Unauthorized');

  // 4. Registration validations: password >= 8 characters and valid email
  const shortPassRes = await call('POST', '/api/register', { name: 'Short', email: 'short@campus.edu', password: '123' }, { Authorization: '' });
  check('short password (<8 chars) -> 400', shortPassRes.status === 400);
  const badEmailRes = await call('POST', '/api/register', { name: 'BadEmail', email: 'invalid-email', password: 'password123' }, { Authorization: '' });
  check('invalid email -> 400', badEmailRes.status === 400);

  // 5. Public health and leaderboard endpoints
  const healthRes = await call('GET', '/api/health', null, { Authorization: '' });
  check('GET /api/health readable without token', healthRes.status === 200 && healthRes.data.status === 'ok');

  const pubLeaderboard = await call('GET', '/api/leaderboard', null, { Authorization: '' });
  check('GET /api/leaderboard readable without token', pubLeaderboard.status === 200 && Array.isArray(pubLeaderboard.data));
  check('leaderboard contains no Email, Phone, or Password', pubLeaderboard.data.every((s) => !s.Email && !s.email && !s.Phone && !s.phone && !s.Password && !s.password));

  // 6. Login validations & rate limiting
  const unknownEmailRes = await call('POST', '/api/login', { email: 'unknown@campus.edu', password: 'password123' }, { Authorization: '' });
  const wrongPassRes = await call('POST', '/api/login', { email: 'kediavidhi62@gmail.com', password: 'wrongpassword' }, { Authorization: '' });
  check('unknown email -> 401 generic message', unknownEmailRes.status === 401 && unknownEmailRes.data.error === 'Invalid email or password');
  check('wrong password -> 401 same generic message', wrongPassRes.status === 401 && wrongPassRes.data.error === 'Invalid email or password');

  // Rate limiting test: 10 failed attempts per 15 minutes per email/IP
  console.log('Login rate limiting');
  const testRateLimitEmail = 'ratelimit@campus.edu';
  for (let i = 0; i < 9; i++) {
    await call('POST', '/api/login', { email: testRateLimitEmail, password: 'bad' }, { Authorization: '' });
  }
  const tenthAttempt = await call('POST', '/api/login', { email: testRateLimitEmail, password: 'bad' }, { Authorization: '' });
  check('10th failed attempt -> 401', tenthAttempt.status === 401);
  const eleventhAttempt = await call('POST', '/api/login', { email: testRateLimitEmail, password: 'bad' }, { Authorization: '' });
  check('11th failed attempt blocked with 429', eleventhAttempt.status === 429);

  console.log('Auth & students');
  r = await call('POST', '/api/register', {
    name: 'Test User', email: 't@campus.edu', password: 'secret123',
    department: 'CSE', year: '1st Year', hostelBlock: 'A', roomNo: '9',
    phone: '+91 99999 11111', githubUrl: 'https://github.com/testuser',
    interests: ['AI', 'React'], languages: ['English']
  }, { Authorization: '' });
  check('register -> 201 with signed token', r.status === 201 && r.data.token && r.data.StudentID && !r.data.Password, JSON.stringify(r));
  const newId = r.data.StudentID;
  const userToken = r.data.token;
  CURRENT_TOKEN = userToken;

  check('register returns hydrated collections', Array.isArray(r.data.skillsOffered) && Array.isArray(r.data.skillsWanted) && Array.isArray(r.data.upcomingSessions) && Array.isArray(r.data.weeklyAvailability) && Array.isArray(r.data.recentReviews));
  check('register returns readable studentId', r.data.studentId === `STU${String(newId).padStart(3, '0')}`);

  r = await call('POST', '/api/register', { name: 'Dup', email: 't@campus.edu', password: 'secret123' }, { Authorization: '' });
  check('duplicate email -> 409', r.status === 409, JSON.stringify(r));

  r = await call('POST', '/api/login', { email: 't@campus.edu', password: 'secret123' }, { Authorization: '' });
  check('login ok with signed token', r.status === 200 && r.data.token && r.data.Name === 'Test User');
  check('login returns hydrated collections', Array.isArray(r.data.skillsOffered) && Array.isArray(r.data.skillsWanted) && Array.isArray(r.data.upcomingSessions) && Array.isArray(r.data.weeklyAvailability) && Array.isArray(r.data.recentReviews));

  // Pre-fetch tokens for seeded students
  const vidhiLogin = await call('POST', '/api/login', { email: 'kediavidhi62@gmail.com', password: 'password123' }, { Authorization: '' });
  const vidhiToken = vidhiLogin.data.token;
  const aaravLogin = await call('POST', '/api/login', { email: 'aarav@campus.edu', password: 'password123' }, { Authorization: '' });
  const aaravToken = aaravLogin.data.token;
  const diyaLogin = await call('POST', '/api/login', { email: 'diya@campus.edu', password: 'password123' }, { Authorization: '' });
  const diyaToken = diyaLogin.data.token;
  const rohanLogin = await call('POST', '/api/login', { email: 'rohan@campus.edu', password: 'password123' }, { Authorization: '' });
  const rohanToken = rohanLogin.data.token;

  console.log('Public data vs Private data authorization');
  r = await call('GET', '/api/students');
  check('list students', r.status === 200 && r.data.length >= 12 && !('Password' in r.data[0]));
  check('student list has no Email, Phone or Password', r.data.every((s) => !s.Email && !s.email && !s.Phone && !s.phone && !s.Password && !s.password));

  // Viewing another student's profile (Vidhi, ID 1) with Test User token
  r = await call('GET', '/api/students/1');
  check('Vidhi public profile has offered+wanted', r.data.skillsOffered.length === 4 && r.data.skillsWanted.length === 4, JSON.stringify(r.data));
  check('Vidhi public profile has extras (avatar, github)', r.data.githubUrl && r.data.avatar);
  check('Vidhi public profile excludes Email, Phone, and Password', !r.data.Email && !r.data.email && !r.data.Phone && !r.data.phone && !r.data.Password);
  check('Vidhi has power level & rank', typeof r.data.powerLevel === 'number' && r.data.rank);

  // Student A reading own profile -> contains email and phone
  const ownProfile = await call('GET', `/api/students/${newId}`);
  check('own profile includes email and phone', ownProfile.status === 200 && ownProfile.data.email === 't@campus.edu' && ownProfile.data.phone === '+91 99999 11111');

  // Student A reading or changing Student B's private resources -> 403
  check('student A reading student B notifications -> 403', (await call('GET', '/api/students/1/notifications')).status === 403);
  check('student A reading student B availability -> 403', (await call('GET', '/api/students/1/availability')).status === 403);
  check('student A reading student B badges -> 403', (await call('GET', '/api/students/1/badges')).status === 403);
  check('student A reading student B offered skills -> 403', (await call('GET', '/api/students/1/offered')).status === 403);
  check('student A reading student B wanted skills -> 403', (await call('GET', '/api/students/1/wanted')).status === 403);
  check('student A reading student B sessions -> 403', (await call('GET', '/api/students/1/sessions')).status === 403);
  check('student A reading student B dashboard -> 403', (await call('GET', '/api/students/1/dashboard')).status === 403);
  check('student A patching student B profile -> 403', (await call('PATCH', '/api/students/1', { name: 'Hacked' })).status === 403);
  check('student A offering skill for student B -> 403', (await call('POST', '/api/students/1/offered', { skillId: 1 })).status === 403);

  // Blocked endpoints
  check('POST /api/students/:id/badges/award blocked with 403', (await call('POST', `/api/students/${newId}/badges/award`, { badgeId: 'badge-first-skill' })).status === 403);
  check('POST /api/notifications blocked with 403', (await call('POST', '/api/notifications', { studentId: newId, type: 'test', title: 't', message: 'm' })).status === 403);

  console.log('Skills');
  r = await call('GET', '/api/skills');
  check('list skills', r.data.length >= 10);
  r = await call('POST', '/api/skills', { skillName: 'Guitar', category: 'Music' });
  check('create skill', r.status === 201);
  const guitar = r.data.SkillID;
  r = await call('POST', '/api/skills', { skillName: 'Guitar' });
  check('duplicate skill -> 409', r.status === 409);

  console.log('Offered / wanted');
  r = await call('POST', `/api/students/${newId}/offered`, {
    skillId: guitar, level: 'Advanced', tags: ['Guitar', 'Acoustic'], sampleTopics: ['Chords', 'Fingerpicking'], yearsOfExperience: 3
  });
  check('offer a skill', r.status === 201 && r.data.teachingId && r.data.SS_ID);
  check('offered skill has readable TCH- ID', r.data.teachingId.startsWith('TCH-'));
  r = await call('POST', `/api/students/${newId}/offered`, { skillId: guitar, level: 'Expert' });
  check('re-offer updates level', r.status === 201);
  r = await call('GET', `/api/students/${newId}/offered`);
  check('offered list shows Expert', r.data.length === 1 && r.data[0].Level === 'Expert');
  r = await call('POST', `/api/students/${newId}/wanted`, {
    skillId: 2, targetGoal: 'Automate scripts for lab', preferredAvailability: 'Weekends'
  });
  check('want a skill (Python)', r.status === 201 && r.data.learningId && r.data.Request_ID);
  check('wanted skill has readable LRN- ID', r.data.learningId.startsWith('LRN-'));
  r = await call('POST', `/api/students/${newId}/offered`, { skillId: 999 });
  check('unknown skill -> 400', r.status === 400, JSON.stringify(r));
  r = await call('POST', `/api/students/${newId}/offered`, { skillId: 1, level: 'Godlike' });
  check('bad level -> 400', r.status === 400, JSON.stringify(r));

  console.log('Matching & explore');
  r = await call('GET', `/api/students/${newId}/matches`);
  check('matches find Python teachers', r.status === 200 && r.data.some((m) => m.skillOffered === 'Python' || m.SkillName === 'Python'), JSON.stringify(r));
  if (r.data.length) {
    check('matches contain readable MAT- ID', r.data[0].matchId && r.data[0].matchId.startsWith('MAT-'));
  }

  // Aarav requests matches with his own token
  r = await call('GET', '/api/students/2/matches', null, { Authorization: `Bearer ${aaravToken}` });
  check('Aarav matched with a Python teacher', r.data.some((m) => m.name === 'Diya Patel' || m.TeacherName === 'Diya Patel'), JSON.stringify(r.data?.slice?.(0, 3)));
  r = await call('GET', '/api/explore');
  check('explore catalog', r.status === 200 && r.data.length >= 8);

  console.log('Exchanges');
  // New user requests skill exchange with Diya (ID 3)
  r = await call('POST', '/api/exchanges', { teacherId: 3, skillId: 2 });
  check('create exchange', r.status === 201 && r.data.Status === 'Pending', JSON.stringify(r));
  const ex = r.data.ExchangeID;

  // Diya checks her notifications with diyaToken
  const teacherNotifs = await call('GET', '/api/students/3/notifications', null, { Authorization: `Bearer ${diyaToken}` });
  check('exchange request creates notification for teacher', teacherNotifs.status === 200 && teacherNotifs.data.some((n) => n.Title === 'New Exchange Request'));

  r = await call('POST', '/api/exchanges', { teacherId: 3, skillId: 2 });
  check('duplicate open exchange -> 409', r.status === 409);
  r = await call('POST', '/api/exchanges', { teacherId: newId, skillId: guitar });
  check('self-exchange -> 400', r.status === 400);
  r = await call('POST', '/api/exchanges', { teacherId: 4, skillId: 2 });
  check('teacher must offer skill -> 400', r.status === 400);
  r = await call('POST', `/api/exchanges/${ex}/sessions`, { sessionDate: '2026-11-01' });
  check('no session while Pending -> 409', r.status === 409);

  // Diya attempts invalid Pending -> Completed
  r = await call('PATCH', `/api/exchanges/${ex}/status`, { status: 'Completed' }, { Authorization: `Bearer ${diyaToken}` });
  check('Pending -> Completed blocked', r.status === 400);

  // Permissions in PATCH /api/exchanges/:id/status
  // Learner cannot accept or reject
  r = await call('PATCH', `/api/exchanges/${ex}/status`, { status: 'Accepted' });
  check('learner cannot accept -> 403', r.status === 403);
  r = await call('PATCH', `/api/exchanges/${ex}/status`, { status: 'Rejected' });
  check('learner cannot reject -> 403', r.status === 403);
  // Outsider (Rohan) cannot accept or cancel
  r = await call('PATCH', `/api/exchanges/${ex}/status`, { status: 'Accepted' }, { Authorization: `Bearer ${rohanToken}` });
  check('outsider cannot accept -> 403', r.status === 403);
  r = await call('PATCH', `/api/exchanges/${ex}/status`, { status: 'Cancelled' }, { Authorization: `Bearer ${rohanToken}` });
  check('outsider cannot Cancel -> 403', r.status === 403);

  // Teacher Diya accepts exchange
  r = await call('PATCH', `/api/exchanges/${ex}/status`, { status: 'Accepted' }, { Authorization: `Bearer ${diyaToken}` });
  check('Pending -> Accepted', r.status === 200 && r.data.Status === 'Accepted');
  const learnerNotifs = await call('GET', `/api/students/${newId}/notifications`);
  check('exchange accept creates notification for learner', learnerNotifs.status === 200 && learnerNotifs.data.some((n) => n.Title === 'Exchange Request Accepted'));

  r = await call('PATCH', `/api/exchanges/${ex}/status`, { status: 'Completed' });
  check('learner cannot mark Completed -> 403', r.status === 403);

  r = await call('POST', `/api/exchanges/${ex}/feedback`, { rating: 5 });
  check('no feedback before Completed -> 400', r.status === 400);

  console.log('Sessions');
  r = await call('POST', `/api/exchanges/${ex}/sessions`, {
    sessionDate: '2026-11-01', mode: 'Online', location: 'Meet',
    meetingLink: 'https://meet.google.com/test-session', notes: 'Prepare Python basics'
  });
  check('schedule session', r.status === 201);
  r = await call('GET', `/api/exchanges/${ex}/sessions`);
  check('list sessions', r.data.length === 1 && r.data[0].MeetingLink === 'https://meet.google.com/test-session');
  r = await call('GET', `/api/students/${newId}/sessions`);
  check('student session list has readable SES- ID', r.status === 200 && r.data.length >= 1 && r.data[0].sessionId.startsWith('SES-'));

  console.log('Feedback');
  // Complete exchange as Diya
  await call('PATCH', `/api/exchanges/${ex}/status`, { status: 'Completed' }, { Authorization: `Bearer ${diyaToken}` });
  // Outsider feedback blocked
  r = await call('POST', `/api/exchanges/${ex}/feedback`, { rating: 5 }, { Authorization: `Bearer ${rohanToken}` });
  check('outsider feedback -> 403', r.status === 403);
  r = await call('POST', `/api/exchanges/${ex}/feedback`, { rating: 6 });
  check('rating 6 -> 400', r.status === 400);
  r = await call('POST', `/api/exchanges/${ex}/feedback`, {
    rating: 5, comments: 'Great',
    clarityRating: 5, patienceRating: 5, punctualityRating: 5, wouldRecommend: 1
  });
  check('learner feedback ok with aspect ratings', r.status === 201 && r.data.ClarityRating === 5);
  r = await call('POST', `/api/exchanges/${ex}/feedback`, { rating: 4 });
  check('second review by same person -> 409', r.status === 409);
  r = await call('GET', `/api/students/${newId}/feedback`);
  if (r.data.length) {
    check('student feedback review has readable RAT- ID', r.data[0].ratingId.startsWith('RAT-'));
  }

  console.log('Profile, availability, messages, dashboard');
  r = await call('PATCH', `/api/students/${newId}`, {
    bio: 'Hello campus', department: 'IT', phone: '+91 99999 22222',
    githubUrl: 'https://github.com/testuser-updated', interests: ['Python', 'Docker']
  });
  check('patch profile with extras', r.status === 200 && r.data.bio === 'Hello campus' && r.data.phone === '+91 99999 22222');
  r = await call('PUT', `/api/students/${newId}/availability`, {
    days: [{ day: 'Monday', enabled: true, slots: [{ start: '16:00', end: '18:00', period: 'Lab' }] }],
  });
  check('save availability (day/slot shapes)', r.status === 200 && r.data[0].slots.length === 1 && r.data[0].dayShort === 'Mon', JSON.stringify(r));
  r = await call('POST', '/api/messages', { receiverId: 1, body: 'Hi Vidhi from tests' });
  check('send message', r.status === 201);
  r = await call('GET', `/api/students/${newId}/conversations`);
  check('list conversations', r.status === 200 && r.data.length >= 1);
  r = await call('GET', `/api/students/${newId}/dashboard`);
  check('dashboard payload', r.status === 200 && r.data.stats && r.data.student && r.data.stats.powerLevel !== undefined, JSON.stringify(r.status));

  console.log('Leaderboard, Badges & Notifications');
  r = await call('GET', '/api/leaderboard');
  check('leaderboard endpoint', r.status === 200 && r.data.length >= 12 && r.data[0].rank === 1 && r.data[0].powerLevel !== undefined);

  r = await call('GET', `/api/students/${newId}/badges`);
  check('get student badges', r.status === 200 && r.data.length >= 10 && r.data[0].criterion && r.data[0].target !== undefined);

  // Notifications read & unread count
  r = await call('GET', `/api/students/${newId}/notifications`);
  check('get student notifications', r.status === 200 && r.data.length >= 1);
  const notifId = r.data[0].NotificationID;

  r = await call('PATCH', `/api/notifications/${notifId}/read`, {});
  check('mark notification read', r.status === 200 && r.data.IsRead === 1);

  r = await call('GET', `/api/students/${newId}/notifications/unread-count`);
  check('get student notifications unread-count', r.status === 200 && typeof r.data.count === 'number');

  r = await call('PATCH', `/api/students/${newId}/notifications/read-all`);
  check('mark all notifications read', r.status === 200 && r.data.ok === true);

  r = await call('GET', `/api/students/${newId}/notifications/unread-count`);
  check('unread count becomes 0 after read-all', r.status === 200 && r.data.count === 0);

  // Automatic event notifications verification
  const vidhiNotifs = await call('GET', '/api/students/1/notifications', null, { Authorization: `Bearer ${vidhiToken}` });
  check('message creates notification for receiver', vidhiNotifs.status === 200 && vidhiNotifs.data.some((n) => n.Type === 'message'));

  const teacherFeedbackNotifs = await call('GET', '/api/students/3/notifications', null, { Authorization: `Bearer ${diyaToken}` });
  check('review creates notification for teacher', teacherFeedbackNotifs.status === 200 && teacherFeedbackNotifs.data.some((n) => n.Type === 'review'));

  // Cancel permissions verification (both teacher and learner allowed)
  const exCancel1 = await call('POST', '/api/exchanges', { teacherId: 3, skillId: 2 });
  r = await call('PATCH', `/api/exchanges/${exCancel1.data.ExchangeID}/status`, { status: 'Cancelled' });
  check('learner can cancel exchange', r.status === 200 && r.data.Status === 'Cancelled');

  const exCancel2 = await call('POST', '/api/exchanges', { teacherId: 3, skillId: 2 });
  r = await call('PATCH', `/api/exchanges/${exCancel2.data.ExchangeID}/status`, { status: 'Cancelled' }, { Authorization: `Bearer ${diyaToken}` });
  check('teacher can cancel exchange', r.status === 200 && r.data.Status === 'Cancelled');

  // Session reschedule and cancel notifications
  const sessRow = await call('POST', `/api/exchanges/${ex}/sessions`, { sessionDate: '2026-11-20' });
  const testSessId = sessRow.data.SessionID;
  await call('PATCH', `/api/sessions/${testSessId}`, { sessionDate: '2026-11-25' }, { Authorization: `Bearer ${diyaToken}` });
  const learnerReschedNotifs = await call('GET', `/api/students/${newId}/notifications`);
  check('session reschedule creates notification', learnerReschedNotifs.status === 200 && learnerReschedNotifs.data.some((n) => n.Title === 'Session Rescheduled'));

  await call('PATCH', `/api/sessions/${testSessId}`, { status: 'Cancelled' }, { Authorization: `Bearer ${diyaToken}` });
  const learnerCancelNotifs = await call('GET', `/api/students/${newId}/notifications`);
  check('session cancel creates notification', learnerCancelNotifs.status === 200 && learnerCancelNotifs.data.some((n) => n.Title === 'Session Cancelled'));

  // =========================================================================
  // Real Messages & Chat between Two Students
  // =========================================================================
  console.log('Real messaging between two students');
  const chatMsg1 = await call('POST', '/api/messages', {
    receiverId: 1,
    body: 'Hello Vidhi! Excited to learn React from you on 4S.'
  });
  check('student sends real message', chatMsg1.status === 201 && chatMsg1.data.Body === 'Hello Vidhi! Excited to learn React from you on 4S.');

  const vidhiConvs = await call('GET', '/api/students/1/conversations', null, { Authorization: `Bearer ${vidhiToken}` });
  const convWithNew = vidhiConvs.data.find((c) => Number(c.peerId) === Number(newId));
  check('receiver conversation list shows sender with unread count', Boolean(convWithNew) && convWithNew.unreadCount >= 1);

  const vidhiThread = await call('GET', `/api/students/1/messages/${newId}`, null, { Authorization: `Bearer ${vidhiToken}` });
  check('receiver thread contains sent message', vidhiThread.status === 200 && vidhiThread.data.messages.some((m) => m.text.includes('Excited to learn React')));

  const markReadRes = await call('PATCH', `/api/students/1/messages/${newId}/read`, null, { Authorization: `Bearer ${vidhiToken}` });
  check('mark conversation read succeeds', markReadRes.status === 200 && markReadRes.data.ok === true);

  const vidhiConvsAfterRead = await call('GET', '/api/students/1/conversations', null, { Authorization: `Bearer ${vidhiToken}` });
  const convAfterRead = vidhiConvsAfterRead.data.find((c) => Number(c.peerId) === Number(newId));
  check('unread count becomes 0 after marking read', Boolean(convAfterRead) && convAfterRead.unreadCount === 0);

  const replyMsg = await call('POST', '/api/messages', {
    receiverId: newId,
    body: 'Welcome! Looking forward to our peer knowledge exchange.'
  }, { Authorization: `Bearer ${vidhiToken}` });
  check('peer replies to message', replyMsg.status === 201 && replyMsg.data.Body.includes('Welcome! Looking forward'));

  const senderThread = await call('GET', `/api/students/${newId}/messages/1`);
  check('both messages visible in thread without fake bots', senderThread.status === 200 && senderThread.data.messages.length >= 2);

  // =========================================================================
  // Online Status and LastSeenAt Tracking
  // =========================================================================
  console.log('LastSeenAt and online status verification');
  await call('GET', `/api/students/${newId}/conversations`);
  let stuProfile = await call('GET', `/api/students/${newId}`);
  check('student online when active within 2 minutes', stuProfile.status === 200 && stuProfile.data.isOnline === true && stuProfile.data.onlineStatus === 'online');

  // 2. When last seen is older than 2 minutes (e.g. 5 minutes ago), peer sees them offline
  await db.prepare("UPDATE STUDENT SET LastSeenAt = ? WHERE StudentID = ?").run(new Date(Date.now() - 5 * 60 * 1000).toISOString(), newId);
  stuProfile = await call('GET', `/api/students/${newId}`, null, { Authorization: `Bearer ${vidhiToken}` });
  check('student offline when last seen > 2 minutes ago', stuProfile.status === 200 && stuProfile.data.isOnline === false && stuProfile.data.onlineStatus === 'offline');

  // Bearer token touches last seen back to online
  await call('GET', '/api/skills');
  stuProfile = await call('GET', `/api/students/${newId}`);
  check('Bearer token touches last seen back to online', stuProfile.status === 200 && stuProfile.data.isOnline === true && stuProfile.data.onlineStatus === 'online');

  // X-Student-Id without token gives 401
  const xStudentIdOnly = await call('GET', '/api/skills', null, { 'X-Student-Id': String(newId), 'Authorization': '' });
  check('X-Student-Id header without token gives 401', xStudentIdOnly.status === 401);

  // =========================================================================
  // Study Sessions between Real Students
  // =========================================================================
  console.log('Sessions scheduling, listing and completion');
  const initialSessions = await call('GET', `/api/students/${newId}/sessions`);
  check('sessions endpoint returns array for student', Array.isArray(initialSessions.data));

  // Sessions without accepted exchange returns 409
  const sessionWithoutAccepted = await call('POST', '/api/sessions', {
    teacherId: 1,
    learnerId: newId,
    skillId: 6,
    sessionDate: '2026-11-28',
  });
  check('sessions without Accepted return 409', sessionWithoutAccepted.status === 409);

  // Create an exchange with Vidhi (teacher 1) for skill 6 (React) and accept it
  const pyEx = await call('POST', '/api/exchanges', { teacherId: 1, skillId: 6 });
  check('request is Pending', pyEx.status === 201 && pyEx.data.Status === 'Pending');
  await call('PATCH', `/api/exchanges/${pyEx.data.ExchangeID}/status`, { status: 'Accepted' }, { Authorization: `Bearer ${vidhiToken}` });

  const bookedSession = await call('POST', '/api/sessions', {
    exchangeId: pyEx.data.ExchangeID,
    teacherId: 1,
    learnerId: newId,
    skillId: 6,
    sessionDate: '2026-11-28',
    startTime: '15:00',
    durationMins: 60,
    topic: 'Hands-on React Mentoring',
    mode: 'Google Meet',
    link: 'https://meet.google.com/4s-test-session',
    notes: 'Real peer mentoring session.'
  });
  check('session booking creates scheduled session', bookedSession.status === 201 && bookedSession.data.status === 'Upcoming' && bookedSession.data.topic.includes('React'));

  const completeRes = await call('PATCH', `/api/sessions/${bookedSession.data.SessionID || bookedSession.data.sessionId}`, {
    status: 'Completed'
  }, { Authorization: `Bearer ${vidhiToken}` });
  check('mark session completed updates status', completeRes.status === 200 && completeRes.data.status === 'Completed');

  const bookedToCancel = await call('POST', '/api/sessions', {
    exchangeId: pyEx.data.ExchangeID,
    teacherId: 1,
    learnerId: newId,
    skillId: 6,
    sessionDate: '2026-11-30',
    topic: 'Session to Cancel'
  });
  const cancelRes = await call('PATCH', `/api/sessions/${bookedToCancel.data.SessionID || bookedToCancel.data.sessionId}`, {
    status: 'Cancelled',
    notes: 'Exam preparation conflict'
  });
  check('cancel session updates status to Cancelled', cancelRes.status === 200 && cancelRes.data.status === 'Cancelled');

  // =========================================================================
  // Weekly Availability GET and PUT
  // =========================================================================
  console.log('Availability timetable GET and PUT');
  const getAvailRes = await call('GET', `/api/students/${newId}/availability`);
  check('get availability returns 7 weekday slots', getAvailRes.status === 200 && Array.isArray(getAvailRes.data) && getAvailRes.data.length === 7);

  const customSchedule = [
    { day: 'Monday', enabled: true, slots: [{ start: '16:00', end: '18:00', label: '4:00 PM – 6:00 PM', period: 'Peer Mentoring' }] },
    { day: 'Tuesday', enabled: false, slots: [] },
    { day: 'Wednesday', enabled: false, slots: [] },
    { day: 'Thursday', enabled: true, slots: [{ start: '17:00', end: '19:00', label: '5:00 PM – 7:00 PM', period: 'Library Study' }] },
    { day: 'Friday', enabled: false, slots: [] },
    { day: 'Saturday', enabled: false, slots: [] },
    { day: 'Sunday', enabled: false, slots: [] }
  ];
  const putAvailRes = await call('PUT', `/api/students/${newId}/availability`, customSchedule);
  check('put availability saves slots to backend', putAvailRes.status === 200 && putAvailRes.data.find((d) => d.day === 'Monday')?.enabled === true);

  const verifyAvail = await call('GET', `/api/students/${newId}/availability`);
  const mon = verifyAvail.data.find((d) => d.day === 'Monday');
  const thu = verifyAvail.data.find((d) => d.day === 'Thursday');
  check('saved availability persisted in SQLite', mon && mon.slots.length === 1 && thu && thu.slots.length === 1);

  console.log('Listing & reports');
  r = await call('GET', `/api/exchanges`);
  check('exchanges for student returns only own records', r.status === 200 && r.data.length >= 1 && r.data.every((e) => e.TeacherID === newId || e.LearnerID === newId));

  // Reject / ignore non-owned query param
  const spoofExchanges = await call('GET', `/api/exchanges?studentId=1`);
  check('spoofed studentId query in exchanges ignored, returns own records', spoofExchanges.status === 200 && spoofExchanges.data.every((e) => e.TeacherID === newId || e.LearnerID === newId));

  r = await call('GET', '/api/reports/top-teachers');
  check('top teachers report has no emails or phones', r.status === 200 && r.data.length >= 1 && r.data.every((t) => !t.Email && !t.email && !t.Phone && !t.phone));
  r = await call('GET', '/api/reports/popular-skills');
  check('popular skills report', r.status === 200 && r.data[0].Learners >= 1);
  r = await call('GET', '/api/reports/exchange-summary');
  check('exchange summary report', r.status === 200 && r.data.length >= 1);
  r = await call('GET', '/api/nothing');
  check('unknown route -> 404', r.status === 404);

  // =========================================================================
  // TASK VERIFICATIONS: Ratings, Achievements, Leaderboard & SkillMasterShown
  // =========================================================================
  console.log('Task verifications: SkillMasterShown, Badges, Feedback & Leaderboard');

  let freshReg = await call('POST', '/api/register', {
    name: 'Fresh Account', email: 'fresh@campus.edu', password: 'password123'
  }, { Authorization: '' });
  const freshId = freshReg.data.StudentID;
  const freshToken = freshReg.data.token;
  CURRENT_TOKEN = freshToken;

  check('new account starts with skillMasterShown = false', freshReg.data.skillMasterShown === false);

  const patchShown = await call('PATCH', `/api/students/${freshId}`, { skillMasterShown: true });
  check('PATCH sets skillMasterShown = true', patchShown.status === 200 && patchShown.data.skillMasterShown === true);

  const getShown = await call('GET', `/api/students/${freshId}`);
  check('GET returns persisted skillMasterShown = true from DB', getShown.status === 200 && getShown.data.skillMasterShown === true);

  const freshBadges = await call('GET', `/api/students/${freshId}/badges`);
  const freshEarned = freshBadges.data.filter((b) => b.earned || b.unlocked);
  check('new account starts with 0 earned badges', freshBadges.status === 200 && freshEarned.length === 0);

  const freshFeedback = await call('GET', `/api/students/${freshId}/feedback`);
  check('new account starts with 0 feedback entries', freshFeedback.status === 200 && freshFeedback.data.length === 0);

  const lbData = await call('GET', '/api/leaderboard');
  const freshLb = lbData.data.find((s) => Number(s.id) === Number(freshId));
  check('new account on leaderboard starts with 0 taught and 0 learnt', freshLb && freshLb.sessionsTaught === 0 && freshLb.sessionsLearnt === 0);

  await call('POST', `/api/students/${freshId}/wanted`, { skillId: 1, targetGoal: 'Learn Python' });
  let bCheck = await call('GET', `/api/students/${freshId}/badges`);
  check('badge-first-request awarded when skill wanted posted', bCheck.data.find((b) => b.id === 'badge-first-request')?.earned === true);

  const freshEx = await call('POST', '/api/exchanges', { teacherId: 1, skillId: 6 });
  bCheck = await call('GET', `/api/students/${freshId}/badges`);
  check('badge-first-match awarded when exchange created', bCheck.data.find((b) => b.id === 'badge-first-match')?.earned === true);

  // Accept exchange and schedule session
  await call('PATCH', `/api/exchanges/${freshEx.data.ExchangeID}/status`, { status: 'Accepted' }, { Authorization: `Bearer ${vidhiToken}` });
  const freshSess = await call('POST', `/api/exchanges/${freshEx.data.ExchangeID}/sessions`, { sessionDate: '2026-12-01' });
  bCheck = await call('GET', `/api/students/${freshId}/badges`);
  check('badge-first-session awarded when session scheduled', bCheck.data.find((b) => b.id === 'badge-first-session')?.earned === true);

  // Marking session Completed sets exchange to Completed
  await call('PATCH', `/api/sessions/${freshSess.data.SessionID}`, { status: 'Completed' }, { Authorization: `Bearer ${vidhiToken}` });
  const exVerify = await call('GET', `/api/exchanges/${freshEx.data.ExchangeID}`);
  check('marking session Completed sets exchange to Completed', exVerify.status === 200 && exVerify.data.Status === 'Completed');

  // Feedback aspect ratings & wouldRecommend
  const fbSubmit = await call('POST', `/api/exchanges/${freshEx.data.ExchangeID}/feedback`, {
    rating: 5,
    comments: 'Super clear session with Vidhi!',
    clarityRating: 5,
    patienceRating: 5,
    punctualityRating: 5,
    wouldRecommend: 1
  });
  check('feedback submitted with aspect ratings & wouldRecommend', fbSubmit.status === 201 && fbSubmit.data.ClarityRating === 5 && fbSubmit.data.WouldRecommend === 1);

  // Duplicate feedback on same exchange by same user rejected
  const fbDup = await call('POST', `/api/exchanges/${freshEx.data.ExchangeID}/feedback`, {
    rating: 4
  });
  check('duplicate review on same exchange blocked with 409', fbDup.status === 409);

  // Reviewed student (Vidhi, teacher) received notification
  const vidhiReviewNotifs = await call('GET', '/api/students/1/notifications', null, { Authorization: `Bearer ${vidhiToken}` });
  check('reviewed student received review notification', vidhiReviewNotifs.data.some((n) => n.Type === 'review'));

  const notifCountBefore = (await call('GET', `/api/students/${freshId}/notifications`)).data.length;
  await call('GET', `/api/students/${freshId}/badges`);
  await call('GET', `/api/students/${freshId}/badges`);
  const notifCountAfter = (await call('GET', `/api/students/${freshId}/notifications`)).data.length;
  check('calling badges endpoint repeatedly does not create duplicate notifications', notifCountBefore === notifCountAfter);

  // =========================================================================
  // NO AUTO-ACCEPT & NO AUTOMATIC MESSAGES TESTS
  // =========================================================================
  console.log('No Auto-Accept and No Automatic Messages Verification');

  // 1. One send creates exactly one MESSAGE row and no reply after 3s
  const msgCountBefore1 = (await db.prepare('SELECT COUNT(*) AS c FROM MESSAGE').get()).c;
  const singleSend = await call('POST', '/api/messages', {
    receiverId: 1,
    body: 'Hello Vidhi, manual message test.'
  }, { Authorization: `Bearer ${freshToken}` });
  check('message send succeeds', singleSend.status === 201);
  const msgCountAfterSend = (await db.prepare('SELECT COUNT(*) AS c FROM MESSAGE').get()).c;
  check('one send creates exactly one MESSAGE row immediately', msgCountAfterSend === msgCountBefore1 + 1);

  // Wait 3 seconds to verify no bot / auto-reply runs
  await new Promise((res) => setTimeout(res, 3100));
  const msgCountAfter3s = (await db.prepare('SELECT COUNT(*) AS c FROM MESSAGE').get()).c;
  check('one send creates exactly one MESSAGE row and no reply after 3s', msgCountAfter3s === msgCountAfterSend);

  // 2. Request, accept and session create ZERO MESSAGE rows
  const msgCountBeforeReq = (await db.prepare('SELECT COUNT(*) AS c FROM MESSAGE').get()).c;

  // New student requests an exchange with Vidhi (teacher 1) for skill 7 (SQL)
  const testExReq = await call('POST', '/api/exchanges', {
    teacherId: 1,
    skillId: 7,
    note: 'Topic: Database Design | Preferred Time: Tomorrow 4pm | Mode: Online'
  }, { Authorization: `Bearer ${freshToken}` });
  check('request is Pending', testExReq.status === 201 && testExReq.data.Status === 'Pending');
  const msgCountAfterReq = (await db.prepare('SELECT COUNT(*) AS c FROM MESSAGE').get()).c;
  check('exchange request creates ZERO MESSAGE rows', msgCountAfterReq === msgCountBeforeReq);

  // Accept exchange as teacher
  const testExAccept = await call('PATCH', `/api/exchanges/${testExReq.data.ExchangeID}/status`, { status: 'Accepted' }, { Authorization: `Bearer ${vidhiToken}` });
  check('exchange accepted by teacher', testExAccept.status === 200 && testExAccept.data.Status === 'Accepted');
  const msgCountAfterAccept = (await db.prepare('SELECT COUNT(*) AS c FROM MESSAGE').get()).c;
  check('exchange accept creates ZERO MESSAGE rows', msgCountAfterAccept === msgCountBeforeReq);

  // Session on accepted exchange
  const testExSess = await call('POST', `/api/exchanges/${testExReq.data.ExchangeID}/sessions`, { sessionDate: '2026-12-15' }, { Authorization: `Bearer ${freshToken}` });
  check('session on accepted exchange created', testExSess.status === 201);
  const msgCountAfterSess = (await db.prepare('SELECT COUNT(*) AS c FROM MESSAGE').get()).c;
  check('request, accept and session create ZERO MESSAGE rows', msgCountAfterSess === msgCountBeforeReq);

  // 3. Sessions without Accepted return 409
  // Create an exchange that remains Pending (with Rohan (teacher 2) for skill 10 (C))
  const pendingEx = await call('POST', '/api/exchanges', { teacherId: 2, skillId: 10 }, { Authorization: `Bearer ${freshToken}` });
  check('pending exchange created', pendingEx.status === 201 && pendingEx.data.Status === 'Pending');
  const sessPendingDirect = await call('POST', `/api/exchanges/${pendingEx.data.ExchangeID}/sessions`, { sessionDate: '2026-12-20' }, { Authorization: `Bearer ${freshToken}` });
  check('sessions without Accepted return 409 (by exchangeId)', sessPendingDirect.status === 409);
  const sessPendingGeneric = await call('POST', '/api/sessions', {
    teacherId: 2,
    learnerId: freshId,
    skillId: 10,
    sessionDate: '2026-12-20'
  }, { Authorization: `Bearer ${freshToken}` });
  check('sessions without Accepted return 409 (generic POST /api/sessions)', sessPendingGeneric.status === 409);

  // 4. A new account can message another student
  const brandNewUser = await call('POST', '/api/register', {
    name: 'Brand New Student',
    email: 'brandnew@campus.edu',
    password: 'password123'
  }, { Authorization: '' });
  const brandNewId = brandNewUser.data.StudentID;
  const brandNewToken = brandNewUser.data.token;

  // New account can view empty thread with peer
  const emptyChatRes = await call('GET', `/api/students/${brandNewId}/messages/1`, null, { Authorization: `Bearer ${brandNewToken}` });
  check('new account can query empty chat with peer', emptyChatRes.status === 200 && emptyChatRes.data.messages.length === 0);

  // New account can message another student
  const brandNewMsg = await call('POST', '/api/messages', {
    receiverId: 1,
    body: 'Hi Vidhi! I just joined campus skill exchange.'
  }, { Authorization: `Bearer ${brandNewToken}` });
  check('a new account can message another student', brandNewMsg.status === 201 && brandNewMsg.data.Body.includes('Hi Vidhi'));

  console.log('\n--- PROBLEM 1 PROOF: 3 Brand-New Account Pairs - No Auto Decision & 15s Polling Stay Pending ---');
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const testPairs = [
    { prefix: 'p1', teacherSkill: 'Distributed Systems', extraSkill: 'Microservices Architecture' },
    { prefix: 'p2', teacherSkill: 'Quantum Computing', extraSkill: 'Quantum Algorithms' },
    { prefix: 'p3', teacherSkill: 'Cybersecurity & Cryptography', extraSkill: 'Network Defense' }
  ];

  await Promise.all(testPairs.map(async (pair, idx) => {
    const pairNum = idx + 1;
    const tEmail = `${pair.prefix}_t_${Date.now()}_${idx}@campus.edu`;
    const lEmail = `${pair.prefix}_l_${Date.now()}_${idx}@campus.edu`;

    // 1. Register Teacher A and Learner B
    const teacherReg = await call('POST', '/api/register', {
      name: `Teacher ${pairNum}`,
      email: tEmail,
      password: 'password123',
      department: 'Computer Science'
    }, { Authorization: '' });
    check(`[Pair ${pairNum}] Teacher registered`, teacherReg.status === 201);
    const teacherId = teacherReg.data.StudentID;
    const teacherToken = teacherReg.data.token;

    const learnerReg = await call('POST', '/api/register', {
      name: `Learner ${pairNum}`,
      email: lEmail,
      password: 'password123',
      department: 'Information Technology'
    }, { Authorization: '' });
    check(`[Pair ${pairNum}] Learner registered`, learnerReg.status === 201);
    const learnerId = learnerReg.data.StudentID;
    const learnerToken = learnerReg.data.token;

    // 2. Teacher offers skills
    const offerRes1 = await call('POST', `/api/students/${teacherId}/offered`, {
      skillName: pair.teacherSkill,
      category: 'Computer Science',
      level: 'Advanced',
      description: `Teaching ${pair.teacherSkill} fundamentals.`
    }, { Authorization: `Bearer ${teacherToken}` });
    check(`[Pair ${pairNum}] Teacher offered ${pair.teacherSkill}`, offerRes1.status === 201);
    const skill1Id = offerRes1.data.skillId || offerRes1.data.SkillID;

    const offerRes2 = await call('POST', `/api/students/${teacherId}/offered`, {
      skillName: pair.extraSkill,
      category: 'Computer Science',
      level: 'Intermediate',
      description: `Teaching ${pair.extraSkill}.`
    }, { Authorization: `Bearer ${teacherToken}` });
    check(`[Pair ${pairNum}] Teacher offered ${pair.extraSkill}`, offerRes2.status === 201);
    const skill2Id = offerRes2.data.skillId || offerRes2.data.SkillID;

    // 3. Learner wants skill 1
    const wantRes = await call('POST', `/api/students/${learnerId}/wanted`, {
      skillName: pair.teacherSkill,
      category: 'Computer Science',
      desiredLevel: 'Intermediate',
      description: `Want to learn ${pair.teacherSkill}`
    }, { Authorization: `Bearer ${learnerToken}` });
    check(`[Pair ${pairNum}] Learner posted wanted skill`, wantRes.status === 201);

    // 4. Learner requests exchange for skill 1
    const req1Res = await call('POST', '/api/exchanges', {
      teacherId,
      skillId: skill1Id,
      note: 'Topic: Fundamentals | Preferred Time: Tomorrow 4pm'
    }, { Authorization: `Bearer ${learnerToken}` });
    check(`[Pair ${pairNum}] Exchange request created with Pending status`, req1Res.status === 201 && req1Res.data.Status === 'Pending');
    const exchange1Id = req1Res.data.ExchangeID;

    // 5. Polling for 15 seconds: verify it stays Pending at every step
    console.log(`  [Pair ${pairNum}] Starting 15 seconds polling verification for exchange #${exchange1Id}...`);
    for (let sec = 3; sec <= 15; sec += 3) {
      await sleep(3000);

      // Check exchange directly
      const pollEx = await call('GET', `/api/exchanges/${exchange1Id}`, null, { Authorization: `Bearer ${learnerToken}` });
      check(`[Pair ${pairNum}] Poll at ${sec}s: exchange stays Pending`, pollEx.status === 200 && pollEx.data.Status === 'Pending');

      // Check learner wanted skills endpoint: must be Pending (never auto Matched)
      const pollWanted = await call('GET', `/api/students/${learnerId}/wanted`, null, { Authorization: `Bearer ${learnerToken}` });
      const wantedItem = pollWanted.data.find((w) => w.SkillID === skill1Id);
      check(`[Pair ${pairNum}] Poll at ${sec}s: wanted skill status is Pending (not Matched)`, wantedItem && wantedItem.status === 'Pending' && wantedItem.status !== 'Matched');

      // Check teacher requests endpoint: shows pending request
      const pollTeacherReqs = await call('GET', '/api/exchanges?status=Pending', null, { Authorization: `Bearer ${teacherToken}` });
      const teacherHasReq = pollTeacherReqs.data.some((e) => e.ExchangeID === exchange1Id && e.Status === 'Pending');
      check(`[Pair ${pairNum}] Poll at ${sec}s: teacher sees Pending request`, teacherHasReq);
    }

    // 6. Teacher explicitly accepts exchange 1
    const acceptRes = await call('PATCH', `/api/exchanges/${exchange1Id}/status`, { status: 'Accepted' }, { Authorization: `Bearer ${teacherToken}` });
    check(`[Pair ${pairNum}] Teacher explicitly accepts exchange 1`, acceptRes.status === 200 && acceptRes.data.Status === 'Accepted');

    const verifyAccepted = await call('GET', `/api/exchanges/${exchange1Id}`, null, { Authorization: `Bearer ${learnerToken}` });
    check(`[Pair ${pairNum}] Exchange 1 is now Accepted`, verifyAccepted.status === 200 && verifyAccepted.data.Status === 'Accepted');

    // 7. Learner requests exchange 2
    const req2Res = await call('POST', '/api/exchanges', {
      teacherId,
      skillId: skill2Id,
      note: 'Second request for another topic'
    }, { Authorization: `Bearer ${learnerToken}` });
    check(`[Pair ${pairNum}] Exchange 2 created with Pending status`, req2Res.status === 201 && req2Res.data.Status === 'Pending');
    const exchange2Id = req2Res.data.ExchangeID;

    // 8. Teacher explicitly rejects exchange 2
    const rejectRes = await call('PATCH', `/api/exchanges/${exchange2Id}/status`, { status: 'Rejected' }, { Authorization: `Bearer ${teacherToken}` });
    check(`[Pair ${pairNum}] Teacher explicitly rejects exchange 2`, rejectRes.status === 200 && rejectRes.data.Status === 'Rejected');

    // 9. Verify exchange 2 stays Rejected across polling
    await sleep(1000);
    const pollRejected = await call('GET', `/api/exchanges/${exchange2Id}`, null, { Authorization: `Bearer ${learnerToken}` });
    check(`[Pair ${pairNum}] Exchange 2 stays Rejected`, pollRejected.status === 200 && pollRejected.data.Status === 'Rejected');
  }));

  console.log('\n--- PROBLEM 2 PROOF: Brand-New Account Lists Students, Sends Msg, Receiver Unread, Replies ---');
  const userXEmail = `user_x_${Date.now()}@campus.edu`;
  const userYEmail = `user_y_${Date.now()}@campus.edu`;

  // Register User X and User Y
  const userXReg = await call('POST', '/api/register', {
    name: 'Xavier Student',
    email: userXEmail,
    password: 'password123',
    department: 'Design'
  }, { Authorization: '' });
  const userXId = userXReg.data.StudentID;
  const userXToken = userXReg.data.token;
  check('User X registered', userXReg.status === 201);

  const userYReg = await call('POST', '/api/register', {
    name: 'Yara Student',
    email: userYEmail,
    password: 'password123',
    department: 'Architecture'
  }, { Authorization: '' });
  const userYId = userYReg.data.StudentID;
  const userYToken = userYReg.data.token;
  check('User Y registered', userYReg.status === 201);

  // 1. User X lists all students
  const allStudentsRes = await call('GET', '/api/students', null, { Authorization: `Bearer ${userXToken}` });
  check('User X lists all students via GET /api/students', allStudentsRes.status === 200 && Array.isArray(allStudentsRes.data));
  const hasYara = allStudentsRes.data.some((s) => s.StudentID === userYId || s.id === userYId || s.Name === 'Yara Student');
  check('Student list includes Yara', hasYara);
  check('Student list contains NO password or email', allStudentsRes.data.every((s) => !s.Password && !s.password && !s.Email && !s.email));

  // 2. User X sends message to User Y
  const sendRes = await call('POST', '/api/messages', {
    receiverId: userYId,
    body: 'Hello Yara, are you interested in collaborating on design tokens?'
  }, { Authorization: `Bearer ${userXToken}` });
  check('User X sends message to User Y', sendRes.status === 201 && sendRes.data.Body.includes('collaborating on design tokens'));

  // 3. User Y checks conversations: sees User X with unreadCount === 1
  const yConvRes = await call('GET', `/api/students/${userYId}/conversations`, null, { Authorization: `Bearer ${userYToken}` });
  check('User Y loads conversations with token', yConvRes.status === 200 && Array.isArray(yConvRes.data));
  const xInYConv = yConvRes.data.find((c) => Number(c.peerId) === userXId);
  check('User Y sees conversation with User X', !!xInYConv);
  check('User Y sees unread count === 1', xInYConv && xInYConv.unreadCount === 1);
  check('User Y sees latest message text and time', xInYConv && xInYConv.messages.length === 1 && xInYConv.messages[0].text.includes('collaborating on design tokens'));

  // 4. User Y replies to User X
  const replyRes = await call('POST', '/api/messages', {
    receiverId: userXId,
    body: 'Hi Xavier! Yes absolutely, let us set up a time.'
  }, { Authorization: `Bearer ${userYToken}` });
  check('User Y replies to User X', replyRes.status === 201 && replyRes.data.Body.includes('Yes absolutely'));

  // 5. User X checks conversations: sees User Y with unreadCount === 1
  const xConvRes = await call('GET', `/api/students/${userXId}/conversations`, null, { Authorization: `Bearer ${userXToken}` });
  check('User X loads conversations with token', xConvRes.status === 200);
  const yInXConv = xConvRes.data.find((c) => Number(c.peerId) === userYId);
  check('User X sees conversation with User Y', !!yInXConv);
  check('User X sees unread count === 1 for reply', yInXConv && yInXConv.unreadCount === 1);
  check('User X sees 2 messages total in thread', yInXConv && yInXConv.messages.length === 2);

  // 6. User X marks conversation as read
  const userXMarkReadRes = await call('PATCH', `/api/students/${userXId}/messages/${userYId}/read`, null, { Authorization: `Bearer ${userXToken}` });
  check('User X marks conversation as read -> 200', userXMarkReadRes.status === 200);
  const xConvAfterRead = await call('GET', `/api/students/${userXId}/conversations`, null, { Authorization: `Bearer ${userXToken}` });
  const yInXAfter = xConvAfterRead.data.find((c) => Number(c.peerId) === userYId);
  check('User X unread count becomes 0 after marking read', yInXAfter && yInXAfter.unreadCount === 0);

  // =========================================================================
  // CHANGE 3 & CHANGE 4 TESTS: 3 BRAND-NEW ACCOUNT PAIRS
  // =========================================================================
  console.log('\n--- CHANGE 3 & 4: 3 Brand-New Account Pairs Tests ---');

  // PAIR 1: Alice (Teacher) & Bob (Learner)
  // Test: Deleting offered skill sets Pending exchange to Cancelled and notifies Bob
  const p1AliceReg = await call('POST', '/api/register', {
    name: 'Alice Springs',
    email: `alice.springs_${Date.now()}@campus.edu`,
    password: 'password123',
    department: 'Computer Science',
    year: '3rd Year'
  }, { Authorization: '' });
  check('[Pair 1] Alice registered', p1AliceReg.status === 201);
  const p1AliceId = p1AliceReg.data.StudentID;
  const p1AliceToken = p1AliceReg.data.token;

  const p1BobReg = await call('POST', '/api/register', {
    name: 'Bob Miller',
    email: `bob.miller_${Date.now()}@campus.edu`,
    password: 'password123',
    department: 'Software Engineering',
    year: '2nd Year'
  }, { Authorization: '' });
  check('[Pair 1] Bob registered', p1BobReg.status === 201);
  const p1BobId = p1BobReg.data.StudentID;
  const p1BobToken = p1BobReg.data.token;

  // Alice offers Rust Systems Programming
  const p1Offer = await call('POST', `/api/students/${p1AliceId}/offered`, {
    skillName: 'Rust Systems Programming',
    category: 'Computer Science',
    level: 'Advanced',
    description: 'Concurrency and memory safety with Rust',
    availability: 'Weekdays 5 PM'
  }, { Authorization: `Bearer ${p1AliceToken}` });
  check('[Pair 1] Alice offered Rust Systems Programming', p1Offer.status === 201);
  const p1SkillId = p1Offer.data.SkillID;

  // Bob requests an exchange with Alice
  const p1ExReq = await call('POST', '/api/exchanges', {
    teacherId: p1AliceId,
    learnerId: p1BobId,
    skillId: p1SkillId,
    note: 'Would love to learn memory safety with Rust'
  }, { Authorization: `Bearer ${p1BobToken}` });
  check('[Pair 1] Bob requested exchange (Pending)', p1ExReq.status === 201 && p1ExReq.data.Status === 'Pending');
  const p1ExId = p1ExReq.data.ExchangeID;

  // Alice deletes her offered skill
  const p1DelRes = await call('DELETE', `/api/students/${p1AliceId}/offered/${p1SkillId}`, null, {
    Authorization: `Bearer ${p1AliceToken}`
  });
  check('[Pair 1] Alice deleted skill -> 204', p1DelRes.status === 204);

  // Assert 1: Pending exchange is set to Cancelled
  const p1ExCheck = await db.prepare('SELECT Status FROM EXCHANGE WHERE ExchangeID = ?').get(p1ExId);
  check('[Pair 1] Pending exchange set to Cancelled on skill delete', p1ExCheck?.Status === 'Cancelled');

  // Assert 2: Bob receives notification
  const p1BobNotifs = await call('GET', `/api/students/${p1BobId}/notifications`, null, {
    Authorization: `Bearer ${p1BobToken}`
  });
  const bobNotif = p1BobNotifs.data?.find((n) => n.RelatedID === String(p1ExId) || (n.Message && n.Message.includes('Rust Systems Programming')));
  check('[Pair 1] Bob received cancellation notification', !!bobNotif && bobNotif.Message.includes('is no longer offering Rust Systems Programming'));


  // PAIR 2: Charlie (Teacher) & Dana (Learner)
  // Test: Deleting blocked with 409 while session is scheduled; allowed after session is cancelled
  const p2CharlieReg = await call('POST', '/api/register', {
    name: 'Charlie Davis',
    email: `charlie.davis_${Date.now()}@campus.edu`,
    password: 'password123',
    department: 'Data Science',
    year: '4th Year'
  }, { Authorization: '' });
  check('[Pair 2] Charlie registered', p2CharlieReg.status === 201);
  const p2CharlieId = p2CharlieReg.data.StudentID;
  const p2CharlieToken = p2CharlieReg.data.token;

  const p2DanaReg = await call('POST', '/api/register', {
    name: 'Dana White',
    email: `dana.white_${Date.now()}@campus.edu`,
    password: 'password123',
    department: 'Information Technology',
    year: '1st Year'
  }, { Authorization: '' });
  check('[Pair 2] Dana registered', p2DanaReg.status === 201);
  const p2DanaId = p2DanaReg.data.StudentID;
  const p2DanaToken = p2DanaReg.data.token;

  // Charlie offers GraphQL API Design
  const p2Offer = await call('POST', `/api/students/${p2CharlieId}/offered`, {
    skillName: 'GraphQL API Design',
    category: 'Web Development',
    level: 'Intermediate',
    description: 'Schemas, resolvers and Apollo Client'
  }, { Authorization: `Bearer ${p2CharlieToken}` });
  check('[Pair 2] Charlie offered GraphQL API Design', p2Offer.status === 201);
  const p2SkillId = p2Offer.data.SkillID;

  // Dana requests exchange
  const p2ExReq = await call('POST', '/api/exchanges', {
    teacherId: p2CharlieId,
    learnerId: p2DanaId,
    skillId: p2SkillId,
    note: 'Want to learn GraphQL schemas'
  }, { Authorization: `Bearer ${p2DanaToken}` });
  check('[Pair 2] Dana requested exchange', p2ExReq.status === 201);
  const p2ExId = p2ExReq.data.ExchangeID;

  // Charlie accepts exchange
  const p2Accept = await call('PATCH', `/api/exchanges/${p2ExId}/status`, { status: 'Accepted' }, {
    Authorization: `Bearer ${p2CharlieToken}`
  });
  check('[Pair 2] Charlie accepted exchange', p2Accept.status === 200 && p2Accept.data.Status === 'Accepted');

  // Charlie schedules a future session
  const p2Sess = await call('POST', '/api/sessions', {
    teacherId: p2CharlieId,
    learnerId: p2DanaId,
    skillId: p2SkillId,
    sessionDate: '2026-11-28',
    startTime: '15:00',
    durationMins: 60,
    topic: 'GraphQL Schema Design',
    mode: 'Online'
  }, { Authorization: `Bearer ${p2CharlieToken}` });
  check('[Pair 2] Session scheduled for future date', p2Sess.status === 201);
  const p2SessionId = p2Sess.data.SessionID || Number(String(p2Sess.data.id).replace(/\D/g, ''));

  // Charlie attempts to delete the offered skill -> must be BLOCKED with 409
  const p2BlockDel = await call('DELETE', `/api/students/${p2CharlieId}/offered/${p2SkillId}`, null, {
    Authorization: `Bearer ${p2CharlieToken}`
  });
  check('[Pair 2] Delete blocked with 409 while session scheduled', p2BlockDel.status === 409);
  check('[Pair 2] Correct error message returned', p2BlockDel.data?.error === 'You have upcoming sessions for this skill. Cancel them in Sessions first.' || p2BlockDel.data?.message === 'You have upcoming sessions for this skill. Cancel them in Sessions first.');

  // Dana cancels the scheduled session
  const p2CancelSess = await call('PATCH', `/api/sessions/${p2SessionId}`, {
    status: 'Cancelled',
    reason: 'Rescheduling for next month'
  }, { Authorization: `Bearer ${p2DanaToken}` });
  check('[Pair 2] Session cancelled -> 200', p2CancelSess.status === 200);

  // Charlie now attempts to delete the offered skill again -> ALLOWED after session cancelled
  const p2AllowedDel = await call('DELETE', `/api/students/${p2CharlieId}/offered/${p2SkillId}`, null, {
    Authorization: `Bearer ${p2CharlieToken}`
  });
  check('[Pair 2] Allowed after session is cancelled -> 204', p2AllowedDel.status === 204);


  // PAIR 3: Elena (Teacher) & Frank (Learner)
  // Test: Dashboard never lists cancelled or past-due sessions as upcoming;
  //       Learner deleting wanted skill cancels pending exchange & notifies teacher.
  const p3ElenaReg = await call('POST', '/api/register', {
    name: 'Elena Rostova',
    email: `elena.rostova_${Date.now()}@campus.edu`,
    password: 'password123',
    department: 'Cloud Computing',
    year: '3rd Year'
  }, { Authorization: '' });
  check('[Pair 3] Elena registered', p3ElenaReg.status === 201);
  const p3ElenaId = p3ElenaReg.data.StudentID;
  const p3ElenaToken = p3ElenaReg.data.token;

  const p3FrankReg = await call('POST', '/api/register', {
    name: 'Frank Ocean',
    email: `frank.ocean_${Date.now()}@campus.edu`,
    password: 'password123',
    department: 'Computer Science',
    year: '2nd Year'
  }, { Authorization: '' });
  check('[Pair 3] Frank registered', p3FrankReg.status === 201);
  const p3FrankId = p3FrankReg.data.StudentID;
  const p3FrankToken = p3FrankReg.data.token;

  // Elena offers Kubernetes
  const p3Offer = await call('POST', `/api/students/${p3ElenaId}/offered`, {
    skillName: 'Kubernetes Pod Networking',
    category: 'Cloud Computing',
    level: 'Advanced',
    description: 'CNI plugins and ingress controllers'
  }, { Authorization: `Bearer ${p3ElenaToken}` });
  check('[Pair 3] Elena offered Kubernetes', p3Offer.status === 201);
  const p3SkillId = p3Offer.data.SkillID;

  // Frank requests exchange & Elena accepts
  const p3ExReq = await call('POST', '/api/exchanges', {
    teacherId: p3ElenaId,
    learnerId: p3FrankId,
    skillId: p3SkillId
  }, { Authorization: `Bearer ${p3FrankToken}` });
  const p3ExId = p3ExReq.data.ExchangeID;
  await call('PATCH', `/api/exchanges/${p3ExId}/status`, { status: 'Accepted' }, { Authorization: `Bearer ${p3ElenaToken}` });

  // 1. Future scheduled session (date in future e.g. 2026-11-29)
  const p3FutureSess = await call('POST', '/api/sessions', {
    teacherId: p3ElenaId,
    learnerId: p3FrankId,
    skillId: p3SkillId,
    sessionDate: '2026-11-29',
    startTime: '14:00',
    topic: 'Future Kubernetes Session'
  }, { Authorization: `Bearer ${p3ElenaToken}` });
  check('[Pair 3] Future session created', p3FutureSess.status === 201);

  // 2. Cancelled session (scheduled then cancelled)
  const p3CancelSessReq = await call('POST', '/api/sessions', {
    teacherId: p3ElenaId,
    learnerId: p3FrankId,
    skillId: p3SkillId,
    sessionDate: '2026-11-30',
    startTime: '16:00',
    topic: 'Cancelled Session'
  }, { Authorization: `Bearer ${p3ElenaToken}` });
  const p3CancelSessId = p3CancelSessReq.data.SessionID || Number(String(p3CancelSessReq.data.id).replace(/\D/g, ''));
  await call('PATCH', `/api/sessions/${p3CancelSessId}`, { status: 'Cancelled' }, { Authorization: `Bearer ${p3ElenaToken}` });

  // 3. Past session (date in past e.g. 2026-10-10) inserted via database helper
  await db.prepare(
    `INSERT INTO SESSION (ExchangeID, SessionDate, StartTime, DurationMins, Topic, Mode, Location, Status)
     VALUES (?, '2026-10-10', '10:00', 60, 'Past Due Session', 'Offline', 'Library', 'Scheduled')`
  ).run(p3ExId);

  // Query Elena's dashboard
  const p3Dash = await call('GET', `/api/students/${p3ElenaId}/dashboard`, null, {
    Authorization: `Bearer ${p3ElenaToken}`
  });
  check('[Pair 3] Elena dashboard loaded -> 200', p3Dash.status === 200);

  const dashUpcoming = p3Dash.data.upcomingSessions;
  check('[Pair 3] Dashboard upcoming sessions contains future session', dashUpcoming.some((s) => s.topic === 'Future Kubernetes Session'));
  check('[Pair 3] Dashboard upcoming sessions NEVER contains cancelled session', !dashUpcoming.some((s) => s.topic === 'Cancelled Session' || s.status === 'Cancelled'));
  check('[Pair 3] Dashboard upcoming sessions NEVER contains past-due session', !dashUpcoming.some((s) => s.topic === 'Past Due Session' || s.date < '2026-11-01'));
  check('[Pair 3] Dashboard stats.upcomingSessions only counts future scheduled', p3Dash.data.stats.upcomingSessions === 1);

  // Frank tests deleting a wanted skill while an exchange is pending
  const p3FrankWant = await call('POST', `/api/students/${p3FrankId}/wanted`, {
    skillName: 'Compiler Optimizations',
    category: 'Computer Science',
    level: 'Intermediate'
  }, { Authorization: `Bearer ${p3FrankToken}` });
  const p3CompilerSkillId = p3FrankWant.data.SkillID;

  // Elena offers Compiler Optimizations
  await call('POST', `/api/students/${p3ElenaId}/offered`, {
    skillName: 'Compiler Optimizations',
    category: 'Computer Science',
    level: 'Expert'
  }, { Authorization: `Bearer ${p3ElenaToken}` });

  // Frank requests exchange with Elena
  const p3FrankExReq = await call('POST', '/api/exchanges', {
    teacherId: p3ElenaId,
    learnerId: p3FrankId,
    skillId: p3CompilerSkillId
  }, { Authorization: `Bearer ${p3FrankToken}` });
  const p3FrankExId = p3FrankExReq.data.ExchangeID;

  // Frank deletes wanted skill
  const p3DelWantedRes = await call('DELETE', `/api/students/${p3FrankId}/wanted/${p3CompilerSkillId}`, null, {
    Authorization: `Bearer ${p3FrankToken}`
  });
  check('[Pair 3] Frank deleted wanted skill -> 204', p3DelWantedRes.status === 204);

  // Assert pending exchange cancelled & Elena notified
  const p3ExStatus = await db.prepare('SELECT Status FROM EXCHANGE WHERE ExchangeID = ?').get(p3FrankExId);
  check('[Pair 3] Pending exchange cancelled on wanted skill delete', p3ExStatus?.Status === 'Cancelled');

  const p3ElenaNotifs = await call('GET', `/api/students/${p3ElenaId}/notifications`, null, {
    Authorization: `Bearer ${p3ElenaToken}`
  });
  const elenaNotif = p3ElenaNotifs.data?.find((n) => n.RelatedID === String(p3FrankExId) || (n.Message && n.Message.includes('Compiler Optimizations')));
  check('[Pair 3] Elena received notification that Frank is no longer requesting skill', !!elenaNotif && elenaNotif.Message.includes('is no longer requesting Compiler Optimizations'));

  // --- ITEM 1: Matches Empty State & Backend Matches ---
  console.log('\n--- ITEM 1: Matches Returns Backend Data (No Sample Fallback) ---');
  const newStudentRes = await call('POST', '/api/register', {
    name: 'Test Isolation Student',
    email: `isolated_${Date.now()}@campus.edu`,
    password: 'password123',
    department: 'Computer Science'
  }, { Authorization: '' });
  const isoStudentId = newStudentRes.data.StudentID;
  const isoStudentToken = newStudentRes.data.token;

  const isoMatchesRes = await call('GET', `/api/students/${isoStudentId}/matches`, null, {
    Authorization: `Bearer ${isoStudentToken}`
  });
  check('Item 1: student with no matches returns empty array [] from backend', Array.isArray(isoMatchesRes.data) && isoMatchesRes.data.length === 0);

  // --- ITEM 2: Dashboard Shows Only Enrolled Learners From Backend ---
  console.log('\n--- ITEM 2: Dashboard Enrolled Learners from Backend Only ---');
  const isoDashRes = await call('GET', `/api/students/${isoStudentId}/dashboard`, null, {
    Authorization: `Bearer ${isoStudentToken}`
  });
  check('Item 2: student dashboard loads with 200', isoDashRes.status === 200);
  const skillsOffered = isoDashRes.data?.student?.skillsOffered || [];
  check('Item 2: student with no offers has empty skillsOffered', skillsOffered.length === 0);

  // Have isolated student offer a skill
  const offerRes = await call('POST', `/api/students/${isoStudentId}/offered`, {
    skillName: 'Test Automation Engineering',
    category: 'Computer Science',
    level: 'Advanced',
    description: 'Unit testing and integration test suites'
  }, { Authorization: `Bearer ${isoStudentToken}` });
  check('Item 2: student offers a skill -> 201', offerRes.status === 201);

  const isoDashRes2 = await call('GET', `/api/students/${isoStudentId}/dashboard`, null, {
    Authorization: `Bearer ${isoStudentToken}`
  });
  const skillsOffered2 = isoDashRes2.data?.student?.skillsOffered || [];
  check('Item 2: student dashboard loads offered skills from backend', skillsOffered2.length === 1);
  check('Item 2: skill contains backend properties (skillId, courseId)', !!skillsOffered2[0]?.courseId && !!skillsOffered2[0]?.skillId);
  check('Item 2: skill with no enrollments has no fallback mock learners', !skillsOffered2[0]?.enrolledLearners || skillsOffered2[0].enrolledLearners.length === 0);

  // --- ITEM 4: Indexes in schema.sql and db.js Verification ---
  console.log('\n--- ITEM 4: Indexes Verification in Temporary Database ---');
  const allIndexes = db.isPostgres
    ? await db.query("SELECT indexname AS name FROM pg_indexes")
    : await db.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index'").all();
  const indexNames = new Set(allIndexes.map(i => i.name));

  check('Item 4: idx_exchange_skill exists', indexNames.has('idx_exchange_skill'));
  check('Item 4: idx_exchange_status exists', indexNames.has('idx_exchange_status'));
  check('Item 4: idx_session_exchange exists', indexNames.has('idx_session_exchange'));
  check('Item 4: idx_session_status_date exists', indexNames.has('idx_session_status_date'));
  check('Item 4: idx_feedback_exchange exists', indexNames.has('idx_feedback_exchange'));
  check('Item 4: idx_feedback_givenby exists', indexNames.has('idx_feedback_givenby'));
  check('Item 4: idx_message_receiver_read exists', indexNames.has('idx_message_receiver_read'));
  check('Item 4: idx_notification_student_read exists', indexNames.has('idx_notification_student_read'));
  check('Item 4: idx_exchange_active_unique partial index exists', indexNames.has('idx_exchange_active_unique'));

  let dupPendingFailed = false;
  try {
    await db.prepare("INSERT INTO EXCHANGE (TeacherID, LearnerID, SkillID, Status) VALUES (1, 2, 1, 'Pending')").run();
    await db.prepare("INSERT INTO EXCHANGE (TeacherID, LearnerID, SkillID, Status) VALUES (1, 2, 1, 'Pending')").run();
  } catch (err) {
    if (err && (err.code === '23505' || (err.message && err.message.toLowerCase().includes('unique')))) {
      dupPendingFailed = true;
    }
  }
  check('Item 4: unique partial index prevents duplicate Pending exchanges', dupPendingFailed);

  let dupCompletedSucceeded = false;
  try {
    await db.prepare("INSERT INTO EXCHANGE (TeacherID, LearnerID, SkillID, Status) VALUES (1, 3, 1, 'Completed')").run();
    await db.prepare("INSERT INTO EXCHANGE (TeacherID, LearnerID, SkillID, Status) VALUES (1, 3, 1, 'Completed')").run();
    dupCompletedSucceeded = true;
  } catch (err) {
    dupCompletedSucceeded = false;
  }
  check('Item 4: unique partial index allows duplicate Completed exchanges', dupCompletedSucceeded);

  // --- PART 4: Verification with 3 New Account Pairs ---
  console.log('\n--- PART 4: Verification with 3 New Account Pairs ---');

  // Pair 1: Learner review allowed only for Completed exchange + 1 review per exchange per person
  const p4_t1_res = await call('POST', '/api/register', {
    name: 'P4 Teacher One',
    email: `p4_t1_${Date.now()}_${Math.random().toString(36).slice(2)}@campus.edu`,
    password: 'password123',
    department: 'Computer Science'
  }, { Authorization: '' });
  const p4_t1_id = p4_t1_res.data.StudentID;
  const p4_t1_token = p4_t1_res.data.token;

  const p4_l1_res = await call('POST', '/api/register', {
    name: 'P4 Learner One',
    email: `p4_l1_${Date.now()}_${Math.random().toString(36).slice(2)}@campus.edu`,
    password: 'password123',
    department: 'Computer Science'
  }, { Authorization: '' });
  const p4_l1_id = p4_l1_res.data.StudentID;
  const p4_l1_token = p4_l1_res.data.token;

  const p4_off1_res = await call('POST', `/api/students/${p4_t1_id}/offered`, {
    skillName: 'Cloud Infrastructure Architecture',
    category: 'Computer Science',
    level: 'Advanced',
    description: 'AWS and Cloud Design'
  }, { Authorization: `Bearer ${p4_t1_token}` });
  const p4_skill1_id = p4_off1_res.data.skillId || p4_off1_res.data.SkillID;

  const p4_ex1_res = await call('POST', '/api/exchanges', {
    teacherId: p4_t1_id,
    skillId: p4_skill1_id,
    note: 'Help with cloud architecture'
  }, { Authorization: `Bearer ${p4_l1_token}` });
  const p4_ex1_id = p4_ex1_res.data.ExchangeID;
  check('Part 4 Pair 1: Exchange created with Pending status', p4_ex1_res.status === 201 && p4_ex1_res.data.Status === 'Pending');

  // Attempt review on Pending exchange -> must fail 400
  const p4_rev_pending = await call('POST', `/api/exchanges/${p4_ex1_id}/feedback`, {
    rating: 5,
    comments: 'Great session on cloud architecture, very informative!'
  }, { Authorization: `Bearer ${p4_l1_token}` });
  check('Part 4 Pair 1: Review blocked on Pending exchange with 400', p4_rev_pending.status === 400);

  // Teacher accepts exchange
  await call('PATCH', `/api/exchanges/${p4_ex1_id}/status`, { status: 'Accepted' }, { Authorization: `Bearer ${p4_t1_token}` });

  // Schedule a session for this exchange
  const p4_ses1_res = await call('POST', '/api/sessions', {
    exchangeId: p4_ex1_id,
    sessionDate: '2026-11-25',
    timeSlot: '14:00 - 15:00',
    meetingLink: 'https://meet.google.com/p4-test-meet',
    notes: 'Cloud architecture design session'
  }, { Authorization: `Bearer ${p4_t1_token}` });
  const p4_ses1_id = p4_ses1_res.data.SessionID || p4_ses1_res.data.sessionId || p4_ses1_res.data.id;

  // Attempt review on Accepted exchange -> must fail 400
  const p4_rev_accepted = await call('POST', `/api/exchanges/${p4_ex1_id}/feedback`, {
    rating: 5,
    comments: 'Great session on cloud architecture, very informative!'
  }, { Authorization: `Bearer ${p4_l1_token}` });
  check('Part 4 Pair 1: Review blocked on Accepted exchange with 400', p4_rev_accepted.status === 400);

  // Before completion: verify reviewable is empty and session canReview is false
  const p4_sess_before = await call('GET', `/api/students/${p4_l1_id}/sessions`, null, { Authorization: `Bearer ${p4_l1_token}` });
  const p4_s1 = p4_sess_before.data?.find(s => s.exchangeId === p4_ex1_id || s.ExchangeID === p4_ex1_id);
  check('Part 4 Pair 1: Uncompleted session canReview is false', p4_s1?.canReview === false);
  check('Part 4 Pair 1: Uncompleted session hasReviewed is false', p4_s1?.hasReviewed === false);

  const p4_rev_before = await call('GET', `/api/students/${p4_l1_id}/reviewable`, null, { Authorization: `Bearer ${p4_l1_token}` });
  const p4_in_rev_before = p4_rev_before.data?.some(r => r.exchangeId === p4_ex1_id);
  check('Part 4 Pair 1: Uncompleted exchange not in reviewable list', !p4_in_rev_before);

  // Teacher marks exchange and session Completed
  await call('PATCH', `/api/sessions/${p4_ses1_id}`, { status: 'Completed' }, { Authorization: `Bearer ${p4_t1_token}` });
  await call('PATCH', `/api/exchanges/${p4_ex1_id}/status`, { status: 'Completed' }, { Authorization: `Bearer ${p4_t1_token}` });

  // Completed but unreviewed session has canReview=true and is present in reviewable list
  const p4_sess_completed = await call('GET', `/api/students/${p4_l1_id}/sessions`, null, { Authorization: `Bearer ${p4_l1_token}` });
  const p4_s1_comp = p4_sess_completed.data?.find(s => s.exchangeId === p4_ex1_id || s.ExchangeID === p4_ex1_id);
  check('Part 4 Pair 1: Completed unreviewed session canReview is true', p4_s1_comp?.canReview === true);
  check('Part 4 Pair 1: Completed unreviewed session hasReviewed is false', p4_s1_comp?.hasReviewed === false);

  const p4_rev_completed = await call('GET', `/api/students/${p4_l1_id}/reviewable`, null, { Authorization: `Bearer ${p4_l1_token}` });
  const p4_rev_item = p4_rev_completed.data?.find(r => r.exchangeId === p4_ex1_id);
  check('Part 4 Pair 1: Reviewable list includes completed unreviewed exchange', !!p4_rev_item);
  check('Part 4 Pair 1: Reviewable item has name', typeof p4_rev_item?.name === 'string' && p4_rev_item.name.length > 0);
  check('Part 4 Pair 1: Reviewable item has studentId', typeof p4_rev_item?.studentId === 'string' && /^STU\d{3}$/.test(p4_rev_item.studentId));
  check('Part 4 Pair 1: Reviewable item has department', typeof p4_rev_item?.department === 'string' && p4_rev_item.department.length > 0);
  check('Part 4 Pair 1: Reviewable item has skill', typeof p4_rev_item?.skill === 'string' && p4_rev_item.skill.length > 0);
  check('Part 4 Pair 1: Reviewable item has date', typeof p4_rev_item?.date === 'string' && p4_rev_item.date.length > 0);

  // Learner reviews Completed exchange -> succeeds 201
  const p4_rev_ok = await call('POST', `/api/exchanges/${p4_ex1_id}/feedback`, {
    rating: 5,
    comments: 'Great session on cloud architecture, very informative!'
  }, { Authorization: `Bearer ${p4_l1_token}` });
  check('Part 4 Pair 1: Review allowed on Completed exchange with 201', p4_rev_ok.status === 201);

  // After review: verify canReview is false, hasReviewed is true, and reviewable no longer contains it
  const p4_sess_after = await call('GET', `/api/students/${p4_l1_id}/sessions`, null, { Authorization: `Bearer ${p4_l1_token}` });
  const p4_s1_after = p4_sess_after.data?.find(s => s.exchangeId === p4_ex1_id || s.ExchangeID === p4_ex1_id);
  check('Part 4 Pair 1: Reviewed session canReview is false', p4_s1_after?.canReview === false);
  check('Part 4 Pair 1: Reviewed session hasReviewed is true', p4_s1_after?.hasReviewed === true);

  const p4_rev_after = await call('GET', `/api/students/${p4_l1_id}/reviewable`, null, { Authorization: `Bearer ${p4_l1_token}` });
  const p4_in_rev_after = p4_rev_after.data?.some(r => r.exchangeId === p4_ex1_id);
  check('Part 4 Pair 1: Reviewed exchange removed from reviewable list', !p4_in_rev_after);

  // Learner attempts duplicate review on same exchange -> fails 409
  const p4_rev_dup = await call('POST', `/api/exchanges/${p4_ex1_id}/feedback`, {
    rating: 4,
    comments: 'Attempting a second review on the same exchange!'
  }, { Authorization: `Bearer ${p4_l1_token}` });
  check('Part 4 Pair 1: Duplicate review by same student rejected with 409', p4_rev_dup.status === 409);

  // Pair 2: Teacher review allowed only for Completed exchange + 1 review per exchange per person
  const p4_t2_res = await call('POST', '/api/register', {
    name: 'P4 Teacher Two',
    email: `p4_t2_${Date.now()}_${Math.random().toString(36).slice(2)}@campus.edu`,
    password: 'password123',
    department: 'Electrical Engineering'
  }, { Authorization: '' });
  const p4_t2_id = p4_t2_res.data.StudentID;
  const p4_t2_token = p4_t2_res.data.token;

  const p4_l2_res = await call('POST', '/api/register', {
    name: 'P4 Learner Two',
    email: `p4_l2_${Date.now()}_${Math.random().toString(36).slice(2)}@campus.edu`,
    password: 'password123',
    department: 'Electrical Engineering'
  }, { Authorization: '' });
  const p4_l2_id = p4_l2_res.data.StudentID;
  const p4_l2_token = p4_l2_res.data.token;

  const p4_off2_res = await call('POST', `/api/students/${p4_t2_id}/offered`, {
    skillName: 'VLSI Circuit Design',
    category: 'Engineering',
    level: 'Intermediate',
    description: 'Digital layout and Verilog'
  }, { Authorization: `Bearer ${p4_t2_token}` });
  const p4_skill2_id = p4_off2_res.data.skillId || p4_off2_res.data.SkillID;

  const p4_ex2_res = await call('POST', '/api/exchanges', {
    teacherId: p4_t2_id,
    skillId: p4_skill2_id,
    note: 'Need help with FPGA layout'
  }, { Authorization: `Bearer ${p4_l2_token}` });
  const p4_ex2_id = p4_ex2_res.data.ExchangeID;

  // Teacher attempts review on Pending exchange -> 400
  const p4_t2_rev_pending = await call('POST', `/api/exchanges/${p4_ex2_id}/feedback`, {
    rating: 5,
    comments: 'Punctual and engaged learner, eager to learn!'
  }, { Authorization: `Bearer ${p4_t2_token}` });
  check('Part 4 Pair 2: Teacher review blocked on Pending exchange with 400', p4_t2_rev_pending.status === 400);

  // Teacher accepts exchange then marks Completed
  await call('PATCH', `/api/exchanges/${p4_ex2_id}/status`, { status: 'Accepted' }, { Authorization: `Bearer ${p4_t2_token}` });
  await call('PATCH', `/api/exchanges/${p4_ex2_id}/status`, { status: 'Completed' }, { Authorization: `Bearer ${p4_t2_token}` });

  // Teacher leaves review on Completed exchange -> 201
  const p4_t2_rev_ok = await call('POST', `/api/exchanges/${p4_ex2_id}/feedback`, {
    rating: 5,
    comments: 'Punctual and engaged learner, eager to learn!'
  }, { Authorization: `Bearer ${p4_t2_token}` });
  check('Part 4 Pair 2: Teacher review allowed on Completed exchange with 201', p4_t2_rev_ok.status === 201);

  // Teacher attempts duplicate review on same exchange -> 409
  const p4_t2_rev_dup = await call('POST', `/api/exchanges/${p4_ex2_id}/feedback`, {
    rating: 5,
    comments: 'Duplicate review from teacher on same exchange.'
  }, { Authorization: `Bearer ${p4_t2_token}` });
  check('Part 4 Pair 2: Duplicate review from teacher rejected with 409', p4_t2_rev_dup.status === 409);

  // Pair 3: Brand new account shows rating null and reviewCount 0 on every endpoint
  const p4_new_res = await call('POST', '/api/register', {
    name: 'P4 Fresh Student',
    email: `p4_fresh_${Date.now()}_${Math.random().toString(36).slice(2)}@campus.edu`,
    password: 'password123',
    department: 'Mathematics'
  }, { Authorization: '' });
  const p4_new_id = p4_new_res.data.StudentID;
  const p4_new_token = p4_new_res.data.token;

  // 1. Register response has rating null and reviewCount 0
  check('Part 4 Pair 3: Register response rating is null', p4_new_res.data.rating === null);
  check('Part 4 Pair 3: Register response reviewCount is 0', (p4_new_res.data.reviewCount || 0) === 0 && (p4_new_res.data.reviewsCount || 0) === 0);

  // 2. Profile endpoint /api/students/:id
  const p4_prof_res = await call('GET', `/api/students/${p4_new_id}`, null, { Authorization: `Bearer ${p4_new_token}` });
  check('Part 4 Pair 3: New account profile rating is null', p4_prof_res.data.rating === null);
  check('Part 4 Pair 3: New account profile reviewCount is 0', (p4_prof_res.data.reviewCount || 0) === 0 && (p4_prof_res.data.reviewsCount || 0) === 0);

  // 3. Students directory endpoint /api/students
  const p4_students_res = await call('GET', '/api/students', null, { Authorization: `Bearer ${p4_new_token}` });
  const p4_student_in_dir = p4_students_res.data?.find(s => s.StudentID === p4_new_id || s.studentId === p4_new_id || s.id === p4_new_id);
  check('Part 4 Pair 3: Directory listing rating is null', p4_student_in_dir?.rating === null);
  check('Part 4 Pair 3: Directory listing reviewCount is 0', (p4_student_in_dir?.reviewCount || 0) === 0 && (p4_student_in_dir?.reviewsCount || 0) === 0);

  // 4. Dashboard endpoint /api/students/:id/dashboard
  const p4_dash_res = await call('GET', `/api/students/${p4_new_id}/dashboard`, null, { Authorization: `Bearer ${p4_new_token}` });
  check('Part 4 Pair 3: Dashboard stats rating is null', p4_dash_res.data?.stats?.rating === null);
  check('Part 4 Pair 3: Dashboard stats reviewCount is 0', (p4_dash_res.data?.stats?.reviewCount || 0) === 0 && (p4_dash_res.data?.stats?.reviewsCount || 0) === 0);

  // 5. Matches endpoint /api/students/:id/matches
  const p4_match_res = await call('GET', `/api/students/${p4_new_id}/matches`, null, { Authorization: `Bearer ${p4_new_token}` });
  check('Part 4 Pair 3: Matches endpoint returns 200', p4_match_res.status === 200);

  // 6. Explore endpoint /api/explore
  const p4_exp_res = await call('GET', '/api/explore', null, { Authorization: `Bearer ${p4_new_token}` });
  check('Part 4 Pair 3: Explore endpoint returns 200', p4_exp_res.status === 200);

  // 7. Check leaderboard
  const p4_lb_res = await call('GET', '/api/leaderboard', null, { Authorization: '' });
  check('Part 4 Pair 3: Leaderboard endpoint returned 200', p4_lb_res.status === 200);
  const lbEntries = p4_lb_res.data;
  const newAccountLb = lbEntries.find(e => e.studentId === p4_new_id || e.StudentID === p4_new_id || e.id === p4_new_id || e.numericId === p4_new_id);
  const teacherWithReviews = lbEntries.find(e => (e.reviewsCount || e.reviews || e.teachingReviewsCount || 0) > 0);

  check('Part 4 Pair 3: New account leaderboard rating is null', newAccountLb?.rating === null);
  check('Part 4 Pair 3: New account leaderboard reviews is 0', (newAccountLb?.reviewsCount || newAccountLb?.reviews || newAccountLb?.teachingReviewsCount || 0) === 0);
  if (newAccountLb && teacherWithReviews) {
    check('Part 4 Pair 3: New account ranks below teacher with real reviews', (teacherWithReviews.score || 0) > (newAccountLb.score || 0));
  } else {
    check('Part 4 Pair 3: Leaderboard entry exists', !!newAccountLb);
  }

  // Static check: routes for /matches#requests and /profile in App.jsx
  const appJsxPath = path.resolve(__dirname, '../src/App.jsx');
  const appJsxContent = fs.readFileSync(appJsxPath, 'utf-8');
  check('Part 4 Static: /matches route exists in App.jsx', appJsxContent.includes('path="matches"') || appJsxContent.includes("path='matches'"));
  check('Part 4 Static: /profile route exists in App.jsx', appJsxContent.includes('path="profile"') || appJsxContent.includes("path='profile'"));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (testServer) {
    testServer.close(async () => {
      try { await db.close(); } catch {}
      try { if (tempDbPath) fs.unlinkSync(tempDbPath); } catch {}
      process.exit(failed ? 1 : 0);
    });
  } else {
    try { await db.close(); } catch {}
    try { if (tempDbPath) fs.unlinkSync(tempDbPath); } catch {}
    process.exit(failed ? 1 : 0);
  }
})();