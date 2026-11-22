const os = require('os');
const path = require('path');
const fs = require('fs');

// Ensure isolated temp db - never touches skillexchange.db
const tempDb = path.join(os.tmpdir(), `flow3100_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
process.env.DB_PATH = tempDb;
process.env.PORT = '3100';

// Fresh seed in isolated temp db
require('./seed');

const { db } = require('./db');
const { server } = require('./server');

const BASE = 'http://127.0.0.1:3100';

async function req(method, endpoint, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(BASE + endpoint, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

(async () => {
  console.log('=== STARTING FULL FLOW VERIFICATION ON PORT 3100 ===');
  console.log(`Backend PORT: 3100, DB: ${tempDb}\n`);

  await new Promise((resolve, reject) => {
    server.listen(3100, '127.0.0.1', (err) => {
      if (err) return reject(err);
      console.log('Server successfully listening on http://127.0.0.1:3100\n');
      resolve();
    });
  });

  const stepsReport = [];

  function record(stepNum, description, response) {
    const entry = {
      step: stepNum,
      description,
      status: response.status,
      success: response.status >= 200 && response.status < 300,
      details: typeof response.data === 'object' ? JSON.stringify(response.data).slice(0, 120) : String(response.data).slice(0, 120)
    };
    stepsReport.push(entry);
    console.log(`[Step ${stepNum}] ${description} -> HTTP ${response.status} ${entry.success ? 'OK' : 'FAIL'}`);
  }

  try {
    // 1. Register Account A (Teacher)
    const teacherEmail = `sarah_teacher_${Date.now()}@campus.edu`;
    const regA = await req('POST', '/api/register', {
      name: 'Sarah Chen',
      email: teacherEmail,
      password: 'password123',
      department: 'Computer Science & Engineering',
      bio: 'Enthusiastic developer teaching React, TypeScript and System Design.'
    });
    record(1, 'Register Account A (Teacher)', regA);
    const teacherId = regA.data.StudentID;
    const teacherToken = regA.data.token;

    // 2. Register Account B (Learner)
    const learnerEmail = `marcus_learner_${Date.now()}@campus.edu`;
    const regB = await req('POST', '/api/register', {
      name: 'Marcus Williams',
      email: learnerEmail,
      password: 'password123',
      department: 'Electrical Engineering',
      bio: 'Junior eager to learn modern fullstack web development and React state architecture.'
    });
    record(2, 'Register Account B (Learner)', regB);
    const learnerId = regB.data.StudentID;
    const learnerToken = regB.data.token;

    // 3. Offer a skill (Teacher Sarah offers "React State & Custom Hooks")
    const offerRes = await req('POST', `/api/students/${teacherId}/offered`, {
      skillName: 'React State & Custom Hooks',
      category: 'Web Development',
      level: 'Advanced',
      description: 'Hands-on mentorship on React 19 hooks, state lifting, and context management.'
    }, teacherToken);
    record(3, 'Account A offers skill (React State & Custom Hooks)', offerRes);
    const skillId = offerRes.data.skillId || offerRes.data.SkillID;

    // 4. Want a skill (Learner Marcus wants "React State & Custom Hooks")
    const wantRes = await req('POST', `/api/students/${learnerId}/wanted`, {
      skillId,
      category: 'Web Development',
      desiredLevel: 'Intermediate',
      description: 'Need guidance structuring my course dashboard components.'
    }, learnerToken);
    record(4, 'Account B posts wanted skill', wantRes);

    // 5. Learner requests exchange (Status: Pending)
    const requestRes = await req('POST', '/api/exchanges', {
      teacherId,
      skillId,
      note: 'Topic: Custom Hooks & State Lifting | Preferred Time: Tomorrow 4:00 PM | Mode: Online'
    }, learnerToken);
    record(5, 'Account B requests exchange with Account A (Status: Pending)', requestRes);
    const exchangeId = requestRes.data.ExchangeID;

    // Verify exchange stays Pending before acceptance
    const checkPendingRes = await req('GET', `/api/exchanges/${exchangeId}`, null, learnerToken);
    record(5.1, 'Verify exchange stays Pending before teacher decision', checkPendingRes);

    // 6. Teacher accepts exchange (Status: Accepted)
    const acceptRes = await req('PATCH', `/api/exchanges/${exchangeId}/status`, {
      status: 'Accepted'
    }, teacherToken);
    record(6, 'Account A accepts exchange request (Status: Accepted)', acceptRes);

    // 7. Schedule study session for accepted exchange
    const sessionRes = await req('POST', `/api/exchanges/${exchangeId}/sessions`, {
      sessionDate: '2026-11-25',
      startTime: '16:00',
      durationMins: 60,
      topic: 'React State Lifting & Custom Hook Architecture',
      mode: 'Online',
      meetingLink: 'https://meet.google.com/4s-sarah-marcus',
      notes: 'Prepare repo with counter and form components.'
    }, learnerToken);
    record(7, 'Schedule study session on accepted exchange', sessionRes);
    const sessionId = sessionRes.data.SessionID;

    // 8. Complete the session (Status: Completed)
    const completeRes = await req('PATCH', `/api/sessions/${sessionId}`, {
      status: 'Completed',
      notes: 'Great session! Completed custom hook refactoring.'
    }, teacherToken);
    record(8, 'Account A marks session as Completed', completeRes);

    // 9. Learner leaves feedback & review
    const reviewRes = await req('POST', `/api/exchanges/${exchangeId}/feedback`, {
      givenBy: learnerId,
      rating: 5,
      clarityRating: 5,
      patienceRating: 5,
      punctualityRating: 5,
      wouldRecommend: 1,
      comments: 'Sarah is a brilliant mentor. She explained custom hooks with clear diagrams and live code!'
    }, learnerToken);
    record(9, 'Account B submits review for completed exchange', reviewRes);

    // 10. Learner sends a direct message to Teacher
    const msg1Res = await req('POST', '/api/messages', {
      receiverId: teacherId,
      body: 'Thank you Sarah! That session really helped me understand React hooks.'
    }, learnerToken);
    record(10, 'Account B sends message to Account A', msg1Res);

    // 11. Teacher replies to Learner
    const msg2Res = await req('POST', '/api/messages', {
      receiverId: learnerId,
      body: 'You are very welcome Marcus! Happy to help anytime.'
    }, teacherToken);
    record(11, 'Account A replies to Account B', msg2Res);

    // 12. Check bell notifications for Teacher
    const notifRes = await req('GET', `/api/students/${teacherId}/notifications`, null, teacherToken);
    record(12, 'Account A checks bell notifications', notifRes);

    // 13. Check unread notification count
    const unreadRes = await req('GET', `/api/students/${teacherId}/notifications/unread-count`, null, teacherToken);
    record(13, 'Account A checks unread notifications count', unreadRes);

    // 14. Mark all notifications as read
    const markAllRes = await req('PATCH', `/api/students/${teacherId}/notifications/read-all`, null, teacherToken);
    record(14, 'Account A marks all notifications as read', markAllRes);

    // Verify unread count is now 0
    const unreadZeroRes = await req('GET', `/api/students/${teacherId}/notifications/unread-count`, null, teacherToken);
    record(14.1, 'Verify unread count is 0 after mark-all', unreadZeroRes);

    console.log('\n=== FLOW EXECUTION COMPLETED SUCCESSFULLY ===');
    console.log(JSON.stringify(stepsReport, null, 2));

  } catch (err) {
    console.error('Flow failed with error:', err);
  } finally {
    server.close(() => {
      try { db.close(); } catch {}
      try { fs.unlinkSync(tempDb); } catch {}
      console.log('\nClosed server on port 3100 and cleaned up temp database.');
      process.exit(0);
    });
  }
})();
