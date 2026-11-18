import { useState, useEffect, useCallback } from 'react';
import api, { normalizeStudentId } from './api.js';
import {
  resolveOrAddCourse,
  getCourseCatalog,
  getCourseById,
  getNextStudentId,
  getNextTeachingId,
  getNextLearningId,
  getNextMatchId,
  getNextSessionId,
  getNextRatingId,
  formatDisplayId,
  findMatches,
  calculateMultiFactorMatch
} from './courseEngine.js';
import {
  getReadableId,
  backfillUserReadableIds,
  extractStudentNumber,
  formatStudentId,
  getOrAssignTeacherCourse,
  buildLearningId,
  AWAITING_TEACHER_ID
} from './idEngine.js';
import {
  calculateDynamicAchievements,
  getBadgeProgress,
  SKILL_MASTER_TARGET
} from './badgeEngine.js';

export {
  resolveOrAddCourse,
  getCourseCatalog,
  getCourseById,
  getNextStudentId,
  getNextTeachingId,
  getNextLearningId,
  getNextMatchId,
  getNextSessionId,
  getNextRatingId,
  formatDisplayId,
  findMatches,
  calculateMultiFactorMatch,
  getReadableId,
  backfillUserReadableIds,
  extractStudentNumber,
  formatStudentId,
  getOrAssignTeacherCourse,
  buildLearningId,
  AWAITING_TEACHER_ID,
  calculateDynamicAchievements,
  getBadgeProgress,
  SKILL_MASTER_TARGET
};

export const DEFAULT_WEEKLY_AVAILABILITY = [
  { day: 'Monday', dayShort: 'Mon', enabled: false, slots: [] },
  { day: 'Tuesday', dayShort: 'Tue', enabled: false, slots: [] },
  { day: 'Wednesday', dayShort: 'Wed', enabled: false, slots: [] },
  { day: 'Thursday', dayShort: 'Thu', enabled: false, slots: [] },
  { day: 'Friday', dayShort: 'Fri', enabled: false, slots: [] },
  { day: 'Saturday', dayShort: 'Sat', enabled: false, slots: [] },
  { day: 'Sunday', dayShort: 'Sun', enabled: false, slots: [] }
];

export const INITIAL_SESSIONS = [];

export const INITIAL_CONVERSATIONS = [];

export const DEFAULT_USER = {
  id: 'usr_vidhi_kedia_4s',
  studentId: 'STU001',
  name: 'Vidhi Kedia',
  email: 'kediavidhi62@gmail.com',
  department: 'Computer Science & Engineering',
  year: '3rd Year',
  bio: 'CS student passionate about Full-Stack Web Development, Data Structures, and Database Design. Love teaching frontend basics and excited to learn Machine Learning & Cloud Architectures.',
  rating: '4.95',
  sessionsTaught: 18,
  sessionsAttended: 12,
  skillsOffered: [
    {
      id: 'teach-1',
      teachingId: 'TCH001',
      SS_ID: 'TCH-0001',
      studentId: 'STU001',
      Student_ID: 'STU001',
      courseId: 'CRS003',
      Skill_ID: 'CRS003',
      name: 'React.js & Frontend Architecture',
      category: 'Web Development',
      proficiency: 'Advanced',
      Proficiency_Level: 'Advanced',
      level: 'Advanced',
      experience: 14,
      Years_of_Experience: 14,
      availability: 'Weekdays after 4 PM',
      learnersHelped: 14,
      rating: 5.0,
      description: 'Component lifecycles, custom hooks, state management, and responsive UI with Tailwind CSS.',
      Description: 'Component lifecycles, custom hooks, state management, and responsive UI with Tailwind CSS.'
    },
    {
      id: 'teach-2',
      teachingId: 'TCH002',
      SS_ID: 'TCH-0002',
      studentId: 'STU001',
      Student_ID: 'STU001',
      courseId: 'CRS004',
      Skill_ID: 'CRS004',
      name: 'Database Systems & SQL Optimization',
      category: 'Data Science',
      proficiency: 'Advanced',
      Proficiency_Level: 'Advanced',
      level: 'Advanced',
      experience: 19,
      Years_of_Experience: 19,
      availability: 'Weekends & Evenings',
      learnersHelped: 19,
      rating: 4.9,
      description: 'Relational schema design, normalization, joins, indexing, and transaction ACID properties.',
      Description: 'Relational schema design, normalization, joins, indexing, and transaction ACID properties.'
    },
    {
      id: 'teach-3',
      teachingId: 'TCH003',
      SS_ID: 'TCH-0003',
      studentId: 'STU001',
      Student_ID: 'STU001',
      courseId: 'CRS001',
      Skill_ID: 'CRS001',
      name: 'Python for Beginners & OOP',
      category: 'Python',
      proficiency: 'Intermediate',
      Proficiency_Level: 'Intermediate',
      level: 'Intermediate',
      experience: 11,
      Years_of_Experience: 11,
      availability: 'Weekdays 5 PM – 7 PM',
      learnersHelped: 11,
      rating: 4.8,
      description: 'Python syntax fundamentals, data structures, object-oriented principles, and scripting.',
      Description: 'Python syntax fundamentals, data structures, object-oriented principles, and scripting.'
    },
    {
      id: 'teach-4',
      teachingId: 'TCH004',
      SS_ID: 'TCH-0004',
      studentId: 'STU001',
      Student_ID: 'STU001',
      courseId: 'CRS005',
      Skill_ID: 'CRS005',
      name: 'UI Prototyping & Figma Basics',
      category: 'UI/UX Design',
      proficiency: 'Intermediate',
      Proficiency_Level: 'Intermediate',
      level: 'Intermediate',
      experience: 8,
      Years_of_Experience: 8,
      availability: 'Flexible (Anytime)',
      learnersHelped: 8,
      rating: 5.0,
      description: 'Wireframing, auto-layout, design tokens, interactive components, and developer handoff.',
      Description: 'Wireframing, auto-layout, design tokens, interactive components, and developer handoff.'
    }
  ],
  skillsWanted: [
    {
      id: 'req-1',
      learningId: 'LRN001',
      Request_ID: 'LRN-0001',
      studentId: 'STU001',
      Student_ID: 'STU001',
      courseId: 'CRS004',
      Skill_ID: 'CRS004',
      name: 'Machine Learning with Scikit-Learn',
      category: 'Data Science',
      currentLevel: 'Beginner',
      desiredLevel: 'Advanced',
      Desired_Level: 'Advanced',
      preferredLevel: 'Advanced',
      priority: 'High',
      Priority_Level: 'High',
      status: 'Matched',
      description: 'Want to build predictive models for final semester DBMS & AI mini-project.',
      Description: 'Want to build predictive models for final semester DBMS & AI mini-project.',
      learningGoal: 'Want to build predictive models for final semester DBMS & AI mini-project.',
      targetGoal: 'Want to build predictive models for final semester DBMS & AI mini-project.',
      preferredAvailability: 'Weekday Evenings & Weekends'
    },
    {
      id: 'req-2',
      learningId: 'LRN002',
      Request_ID: 'LRN-0002',
      studentId: 'STU001',
      Student_ID: 'STU001',
      courseId: 'CRS003',
      Skill_ID: 'CRS003',
      name: 'Docker & Cloud Deployment Basics',
      category: 'Web Development',
      currentLevel: 'Beginner',
      desiredLevel: 'Intermediate',
      Desired_Level: 'Intermediate',
      preferredLevel: 'Intermediate',
      priority: 'Medium',
      Priority_Level: 'Medium',
      status: 'Open',
      description: 'Learn containerizing React + Node applications and deploying to cloud containers.',
      Description: 'Learn containerizing React + Node applications and deploying to cloud containers.',
      learningGoal: 'Learn containerizing React + Node applications and deploying to cloud containers.',
      targetGoal: 'Learn containerizing React + Node applications and deploying to cloud containers.',
      preferredAvailability: 'Weekdays'
    },
    {
      id: 'req-3',
      learningId: 'LRN003',
      Request_ID: 'LRN-0003',
      studentId: 'STU001',
      Student_ID: 'STU001',
      courseId: 'CRS007',
      Skill_ID: 'CRS007',
      name: 'Technical Public Speaking & Pitching',
      category: 'Communication',
      currentLevel: 'Intermediate',
      desiredLevel: 'Advanced',
      Desired_Level: 'Advanced',
      preferredLevel: 'Advanced',
      priority: 'High',
      Priority_Level: 'High',
      status: 'Open',
      description: 'Overcome stage anxiety for upcoming college hackathon presentations.',
      Description: 'Overcome stage anxiety for upcoming college hackathon presentations.',
      learningGoal: 'Overcome stage anxiety for upcoming college hackathon presentations.',
      targetGoal: 'Overcome stage anxiety for upcoming college hackathon presentations.',
      preferredAvailability: 'Evenings (6 PM – 8 PM)'
    },
    {
      id: 'req-4',
      learningId: 'LRN004',
      Request_ID: 'LRN-0004',
      studentId: 'STU001',
      Student_ID: 'STU001',
      courseId: 'CRS002',
      Skill_ID: 'CRS002',
      name: 'Systems Programming in C',
      category: 'C',
      currentLevel: 'Beginner',
      desiredLevel: 'Intermediate',
      Desired_Level: 'Intermediate',
      preferredLevel: 'Intermediate',
      priority: 'Medium',
      Priority_Level: 'Medium',
      status: 'Matched',
      description: 'Understand pointers arithmetic, struct memory alignment, and Unix process system calls.',
      Description: 'Understand pointers arithmetic, struct memory alignment, and Unix process system calls.',
      learningGoal: 'Understand pointers arithmetic, struct memory alignment, and Unix process system calls.',
      targetGoal: 'Understand pointers arithmetic, struct memory alignment, and Unix process system calls.',
      preferredAvailability: 'Weekdays after 4 PM'
    }
  ],
  upcomingSessions: [],
  weeklyAvailability: [],
  recentMessages: [],
  achievements: [],
  recentReviews: []
};

// Retrieve stored user or return null (no DEFAULT_USER demo fallback)
export const getStoredUser = () => {
  try {
    const raw = localStorage.getItem('4s_active_user');
    if (!raw) return null;
    let user = JSON.parse(raw);
    if (!user || typeof user !== 'object') return null;

    const studentId = user.studentId || (user.id ? `STU${String(user.id).padStart(3, '0')}` : '');

    return {
      ...user,
      id: user.id || user.StudentID || studentId,
      studentId,
      name: user.name || user.Name || '',
      email: user.email || user.Email || '',
      department: user.department || user.Department || '',
      year: user.year || user.YearOfStudy || '',
      bio: user.bio || user.Bio || '',
      rating: user.rating != null ? String(user.rating) : '5.00',
      sessionsTaught: user.sessionsTaught || 0,
      sessionsAttended: user.sessionsAttended || 0,
      skillsOffered: Array.isArray(user.skillsOffered)
        ? user.skillsOffered
        : Array.isArray(user.offered)
        ? user.offered
        : [],
      skillsWanted: Array.isArray(user.skillsWanted)
        ? user.skillsWanted
        : Array.isArray(user.wanted)
        ? user.wanted
        : [],
      upcomingSessions: Array.isArray(user.upcomingSessions) ? user.upcomingSessions : [],
      weeklyAvailability: Array.isArray(user.weeklyAvailability) ? user.weeklyAvailability : [],
      recentReviews: Array.isArray(user.recentReviews) ? user.recentReviews : [],
      achievements: Array.isArray(user.achievements) ? user.achievements : []
    };
  } catch (e) {
    console.error('Error reading user from localStorage', e);
    return null;
  }
};

// Check if explicitly logged in
export const isUserLoggedIn = () => {
  try {
    return localStorage.getItem('4s_is_logged_in') === 'true';
  } catch {
    return false;
  }
};

// Save user into localStorage
export const saveUser = (userData) => {
  try {
    if (userData?.token) {
      localStorage.setItem('4s_auth_token', userData.token);
    }
    localStorage.setItem('4s_active_user', JSON.stringify(userData));
    localStorage.setItem('4s_is_logged_in', 'true');
    window.dispatchEvent(new Event('4s_auth_change'));
  } catch (e) {
    console.error('Error saving user to localStorage', e);
  }
};

// Skills Offered CRUD helpers
export const getUserSkills = () => {
  const user = getStoredUser();
  return user?.skillsOffered || [];
};

export const addUserSkill = (skill) => {
  const user = getStoredUser();
  if (!user) return [];
  const currentSkills = user.skillsOffered || [];
  const rawTeachingId = getNextTeachingId();
  const SS_ID = formatDisplayId('TCH', rawTeachingId);
  const courseId = skill.courseId || skill.Skill_ID || resolveOrAddCourse(skill.name, skill.category);
  const stuId = user.studentId || 'STU001';
  const readableId = getOrAssignTeacherCourse(stuId, skill.name);

  const newSkillWithId = {
    ...skill,
    id: SS_ID,
    teachingId: readableId,
    SS_ID,
    readableId,
    displayId: readableId,
    studentId: stuId,
    Student_ID: stuId,
    courseId,
    Skill_ID: courseId,
    enrolledLearners: [],
    proficiency: skill.level || skill.proficiency || skill.Proficiency_Level || 'Intermediate',
    Proficiency_Level: skill.level || skill.proficiency || skill.Proficiency_Level || 'Intermediate',
    level: skill.level || skill.proficiency || skill.Proficiency_Level || 'Intermediate',
    rating: 5.0,
    learnersHelped: 0,
    experience: Number(skill.experience || skill.Years_of_Experience || 0),
    Years_of_Experience: Number(skill.experience || skill.Years_of_Experience || 0),
    description: skill.description || skill.Description || '',
    Description: skill.description || skill.Description || ''
  };
  const updatedSkills = [newSkillWithId, ...currentSkills];
  user.skillsOffered = updatedSkills;
  saveUser(user);
  return updatedSkills;
};

export const updateUserSkill = (updatedSkill) => {
  const user = getStoredUser();
  if (!user) return [];
  const currentSkills = user.skillsOffered || [];
  const index = currentSkills.findIndex((s) => s.id === updatedSkill.id || s.teachingId === updatedSkill.teachingId || s.SS_ID === updatedSkill.SS_ID);
  if (index !== -1) {
    const courseId = updatedSkill.courseId || updatedSkill.Skill_ID || resolveOrAddCourse(updatedSkill.name, updatedSkill.category);
    currentSkills[index] = {
      ...currentSkills[index],
      ...updatedSkill,
      courseId,
      Skill_ID: courseId,
      proficiency: updatedSkill.level || updatedSkill.proficiency || updatedSkill.Proficiency_Level || currentSkills[index].proficiency,
      Proficiency_Level: updatedSkill.level || updatedSkill.proficiency || updatedSkill.Proficiency_Level || currentSkills[index].proficiency
    };
    user.skillsOffered = currentSkills;
    saveUser(user);
  }
  return user.skillsOffered;
};

export const deleteUserSkill = (skillId) => {
  const user = getStoredUser();
  if (!user) return [];
  const currentSkills = user.skillsOffered || [];
  const filtered = currentSkills.filter((s) => s.id !== skillId && s.teachingId !== skillId && s.SS_ID !== skillId);
  user.skillsOffered = filtered;
  saveUser(user);
  return filtered;
};

// Learning Requests CRUD helpers
export const getUserRequests = () => {
  const user = getStoredUser();
  return user?.skillsWanted || [];
};

export const addUserRequest = (request) => {
  const user = getStoredUser();
  if (!user) return [];
  const currentRequests = user.skillsWanted || [];
  const rawLearningId = getNextLearningId();
  const Request_ID = formatDisplayId('LRN', rawLearningId);
  const courseId = request.courseId || request.Skill_ID || resolveOrAddCourse(request.name, request.category);

  const stuId = user.studentId || 'STU001';
  const status = request.status || 'Open';
  const readableId = status === 'Matched' && request.teacherStudentId
    ? buildLearningId(stuId, getOrAssignTeacherCourse(request.teacherStudentId, request.name))
    : AWAITING_TEACHER_ID;

  const newRequestWithId = {
    ...request,
    id: Request_ID,
    learningId: readableId,
    displayId: readableId,
    readableId: readableId,
    Request_ID,
    studentId: stuId,
    Student_ID: stuId,
    courseId,
    Skill_ID: courseId,
    currentLevel: request.currentLevel || 'Beginner',
    desiredLevel: request.desiredLevel || request.preferredLevel || request.Desired_Level || 'Intermediate',
    Desired_Level: request.desiredLevel || request.preferredLevel || request.Desired_Level || 'Intermediate',
    preferredLevel: request.desiredLevel || request.preferredLevel || request.Desired_Level || 'Intermediate',
    priority: request.priority || request.Priority_Level || 'Medium',
    Priority_Level: request.priority || request.Priority_Level || 'Medium',
    description: request.targetGoal || request.learningGoal || request.description || request.Description || `Learn and master ${request.name}`,
    Description: request.targetGoal || request.learningGoal || request.description || request.Description || `Learn and master ${request.name}`,
    learningGoal: request.learningGoal || request.targetGoal || `Learn and master ${request.name}`,
    targetGoal: request.learningGoal || request.targetGoal || `Learn and master ${request.name}`,
    preferredAvailability: request.preferredAvailability || request.availability || 'Flexible',
    status: request.status || 'Open'
  };
  const updatedRequests = [newRequestWithId, ...currentRequests];
  user.skillsWanted = updatedRequests;
  saveUser(user);
  return updatedRequests;
};

export const updateUserRequest = (updatedRequest) => {
  const user = getStoredUser();
  if (!user) return [];
  const currentRequests = user.skillsWanted || [];
  const index = currentRequests.findIndex((r) => r.id === updatedRequest.id || r.learningId === updatedRequest.learningId || r.Request_ID === updatedRequest.Request_ID);
  if (index !== -1) {
    const courseId = updatedRequest.courseId || updatedRequest.Skill_ID || resolveOrAddCourse(updatedRequest.name, updatedRequest.category);
    currentRequests[index] = {
      ...currentRequests[index],
      ...updatedRequest,
      courseId,
      Skill_ID: courseId,
      desiredLevel: updatedRequest.desiredLevel || updatedRequest.preferredLevel || updatedRequest.Desired_Level || currentRequests[index].desiredLevel,
      Desired_Level: updatedRequest.desiredLevel || updatedRequest.preferredLevel || updatedRequest.Desired_Level || currentRequests[index].desiredLevel
    };
    user.skillsWanted = currentRequests;
    saveUser(user);
  }
  return user.skillsWanted;
};

export const deleteUserRequest = (requestId) => {
  const user = getStoredUser();
  if (!user) return [];
  const currentRequests = user.skillsWanted || [];
  const filtered = currentRequests.filter((r) => r.id !== requestId && r.learningId !== requestId && r.Request_ID !== requestId);
  user.skillsWanted = filtered;
  saveUser(user);
  return filtered;
};

// Record a new learning request made by the student from Explore Skills
export const submitLearningRequest = (requestData) => {
  const user = getStoredUser();
  if (!user) return null;
  const currentRequests = user.skillsWanted || [];
  const rawLearningId = getNextLearningId();
  const Request_ID = formatDisplayId('LRN', rawLearningId);
  const courseId = requestData.courseId || requestData.Skill_ID || resolveOrAddCourse(requestData.skillName, requestData.category);

  const newReq = {
    id: Request_ID,
    learningId: Request_ID,
    Request_ID,
    studentId: user.studentId || 'STU001',
    Student_ID: user.studentId || 'STU001',
    courseId,
    Skill_ID: courseId,
    name: requestData.skillName,
    category: requestData.category,
    currentLevel: 'Beginner',
    desiredLevel: 'Intermediate',
    Desired_Level: 'Intermediate',
    preferredLevel: 'Intermediate',
    priority: 'High',
    Priority_Level: 'High',
    status: 'Open',
    description: requestData.note || `Request to learn ${requestData.skillName} from ${requestData.mentorName}`,
    Description: requestData.note || `Request to learn ${requestData.skillName} from ${requestData.mentorName}`,
    learningGoal: requestData.note || `Request to learn ${requestData.skillName} from ${requestData.mentorName}`,
    targetGoal: requestData.note || `Request to learn ${requestData.skillName} from ${requestData.mentorName}`,
    preferredAvailability: requestData.timeSlot || 'Flexible',
    preferredTimeSlot: requestData.timeSlot,
    mentorRequested: requestData.mentorName
  };
  user.skillsWanted = [newReq, ...currentRequests];
  saveUser(user);

  return newReq;
};

// -----------------------------------------------------------------------------
// SESSIONS CRUD HELPERS
// -----------------------------------------------------------------------------
let cachedSessions = [];

export const getUserSessions = () => {
  return cachedSessions;
};

export const scheduleSession = async (sessionData) => {
  const user = getStoredUser();
  const currentStudentId = user?.StudentID || user?.studentId || user?.id;

  const isTeaching = sessionData.userRole === 'Teacher' || sessionData.role === 'Teaching';
  const teacherId = isTeaching ? currentStudentId : (sessionData.teacherId || sessionData.teacherStudentId || sessionData.partnerId);
  const learnerId = isTeaching ? (sessionData.learnerId || sessionData.learnerStudentId || sessionData.partnerId) : currentStudentId;

  const payload = {
    exchangeId: sessionData.exchangeId || sessionData.ExchangeID,
    teacherId: normalizeStudentId(teacherId),
    learnerId: normalizeStudentId(learnerId),
    skillId: sessionData.skillId,
    skill: sessionData.skill || sessionData.topic,
    topic: sessionData.topic || sessionData.skill,
    sessionDate: sessionData.date || sessionData.sessionDate || new Date().toISOString().split('T')[0],
    startTime: sessionData.time || sessionData.startTime || '16:00',
    durationMins: sessionData.durationMins || parseInt(sessionData.duration, 10) || 60,
    mode: sessionData.mode || 'Google Meet',
    link: sessionData.link,
    location: sessionData.link || sessionData.location,
    notes: sessionData.notes,
    studentId: currentStudentId,
  };

  try {
    const res = await api.sessions.bookSession(payload);
    window.dispatchEvent(new Event('4s_sessions_change'));
    return res;
  } catch (err) {
    console.error('Failed to schedule session on backend:', err);
    throw err;
  }
};

export const updateSessionStatus = async (sessionId, newStatus, extraNotes = '') => {
  const user = getStoredUser();
  const currentStudentId = user?.StudentID || user?.studentId || user?.id;
  try {
    const res = await api.sessions.update(sessionId, {
      status: newStatus,
      notes: extraNotes || undefined,
      studentId: currentStudentId,
    });
    window.dispatchEvent(new Event('4s_sessions_change'));
    return res;
  } catch (err) {
    console.error('Failed to update session status on backend:', err);
    throw err;
  }
};

export const cancelSession = async (sessionId, reason = 'Cancelled by student') => {
  return updateSessionStatus(sessionId, 'Cancelled', reason);
};

export const deleteSession = async (sessionId) => {
  return cancelSession(sessionId, 'Cancelled and removed');
};

// -----------------------------------------------------------------------------
// AVAILABILITY CRUD HELPERS
// -----------------------------------------------------------------------------
let cachedAvailability = DEFAULT_WEEKLY_AVAILABILITY;

export const getUserAvailability = () => {
  return cachedAvailability;
};

export const saveUserAvailability = async (weeklyAvailability) => {
  const user = getStoredUser();
  const currentStudentId = user?.StudentID || user?.studentId || user?.id;
  cachedAvailability = weeklyAvailability;
  if (!currentStudentId) return weeklyAvailability;
  try {
    const res = await api.availability.update(currentStudentId, weeklyAvailability);
    cachedAvailability = res;
    window.dispatchEvent(new Event('4s_availability_change'));
    return res;
  } catch (err) {
    console.error('Failed to save availability on backend:', err);
    throw err;
  }
};

export const toggleDayAvailability = async (dayName, currentSchedule) => {
  const base = currentSchedule || cachedAvailability || DEFAULT_WEEKLY_AVAILABILITY;
  const updated = base.map((item) => {
    if (item.day.toLowerCase() === dayName.toLowerCase()) {
      return { ...item, enabled: !item.enabled };
    }
    return item;
  });
  return saveUserAvailability(updated);
};

export const addAvailabilitySlot = async (dayName, slot, currentSchedule) => {
  const base = currentSchedule || cachedAvailability || DEFAULT_WEEKLY_AVAILABILITY;
  const updated = base.map((item) => {
    if (item.day.toLowerCase() === dayName.toLowerCase()) {
      const newSlot = {
        id: `slot_${Date.now()}`,
        start: slot.start || '16:00',
        end: slot.end || '18:00',
        label: slot.label || `${slot.start} – ${slot.end}`,
        period: slot.period || 'General Study Slot'
      };
      return {
        ...item,
        enabled: true,
        slots: [...(item.slots || []), newSlot]
      };
    }
    return item;
  });
  return saveUserAvailability(updated);
};

export const removeAvailabilitySlot = async (dayName, slotId, currentSchedule) => {
  const base = currentSchedule || cachedAvailability || DEFAULT_WEEKLY_AVAILABILITY;
  const updated = base.map((item) => {
    if (item.day.toLowerCase() === dayName.toLowerCase()) {
      const filteredSlots = (item.slots || []).filter((s) => s.id !== slotId);
      return {
        ...item,
        slots: filteredSlots,
        enabled: filteredSlots.length > 0
      };
    }
    return item;
  });
  return saveUserAvailability(updated);
};

// -----------------------------------------------------------------------------
// MESSAGING & CHAT HELPERS
// -----------------------------------------------------------------------------
let cachedConversations = [];

export const getChatConversations = () => {
  return cachedConversations;
};

export const saveChatConversations = (conversations) => {
  cachedConversations = Array.isArray(conversations) ? conversations : [];
  try {
    localStorage.removeItem('4s_chat_conversations');
  } catch {}
  window.dispatchEvent(new Event('4s_chat_change'));
};

export const sendChatMessage = async (peerNameOrId, text, receiverIdOpt) => {
  const user = getStoredUser();
  const currentStudentId = user?.StudentID || user?.studentId || user?.id;
  if (!currentStudentId || !text || !text.trim()) return [];

  let receiverId = receiverIdOpt;
  if (!receiverId) {
    const norm = normalizeStudentId(peerNameOrId);
    if (typeof norm === 'number' || (typeof norm === 'string' && /^\d+$/.test(norm))) {
      receiverId = Number(norm);
    }
  }

  if (receiverId) {
    try {
      await api.messages.sendMessage({
        senderId: currentStudentId,
        receiverId,
        body: text.trim(),
      });
      window.dispatchEvent(new Event('4s_chat_change'));
    } catch (err) {
      console.error('Failed to send chat message:', err);
      throw err;
    }
  }
};

export const markConversationAsRead = async (peerNameOrId, peerIdOpt) => {
  const user = getStoredUser();
  const currentStudentId = user?.StudentID || user?.studentId || user?.id;
  if (!currentStudentId) return;

  let peerId = peerIdOpt;
  if (!peerId) {
    const norm = normalizeStudentId(peerNameOrId);
    if (typeof norm === 'number' || (typeof norm === 'string' && /^\d+$/.test(norm))) {
      peerId = Number(norm);
    }
  }

  if (peerId) {
    try {
      await api.messages.markAsRead(currentStudentId, peerId);
      window.dispatchEvent(new Event('4s_chat_change'));
    } catch (err) {
      console.warn('Failed to mark conversation as read:', err);
    }
  }
};

// Single message bridge
export const sendMessageToPeer = (peerNameOrId, snippet, peerAvatar = 'SP', peerIdOpt) => {
  const targetId = peerIdOpt || normalizeStudentId(peerNameOrId);
  sendChatMessage(targetId || peerNameOrId, snippet, targetId);
};

// -----------------------------------------------------------------------------
// PROFILE & REVIEWS CRUD HELPERS
// -----------------------------------------------------------------------------
export const updateUserProfile = (profileData) => {
  const user = getStoredUser();
  if (!user) return null;
  user.name = profileData.name !== undefined ? profileData.name.trim() : user.name;
  user.email = profileData.email !== undefined ? profileData.email.trim() : user.email;
  user.department = profileData.department !== undefined ? profileData.department.trim() : user.department;
  user.year = profileData.year !== undefined ? profileData.year : user.year;
  user.bio = profileData.bio !== undefined ? profileData.bio.trim() : user.bio;
  if (profileData.avatar) user.avatar = profileData.avatar;
  saveUser(user);
  return user;
};

export const getUserReviews = () => {
  const user = getStoredUser();
  return user?.recentReviews || [];
};

export const addUserReview = (reviewData) => {
  const user = getStoredUser();
  if (!user) return [];
  const currentReviews = user.recentReviews || [];
  const rawRatingId = reviewData.ratingId || reviewData.Rating_ID || getNextRatingId();
  const Rating_ID = formatDisplayId('RAT', rawRatingId);
  const rawSessionId = reviewData.Session_ID || reviewData.sessionId || 'SES-0104';
  const Session_ID = formatDisplayId('SES', rawSessionId);

  const newReview = {
    id: Rating_ID,
    ratingId: Rating_ID,
    Rating_ID,
    Session_ID,
    sessionId: Session_ID,
    author: reviewData.author?.trim() || 'Fellow Campus Peer',
    authorRole: reviewData.authorRole || 'Learner',
    rating: Number(reviewData.rating) || 5,
    skill: reviewData.skill?.trim() || 'Peer Knowledge Exchange',
    sessionDate: reviewData.sessionDate || new Date().toISOString().split('T')[0],
    date: 'Just now',
    comment: reviewData.comment?.trim() || 'Great collaborative learning exchange!'
  };

  const updatedReviews = [newReview, ...currentReviews];
  user.recentReviews = updatedReviews;

  // Re-calculate user rating
  const totalStars = updatedReviews.reduce((sum, r) => sum + (Number(r.rating) || 5), 0);
  user.rating = (totalStars / updatedReviews.length).toFixed(2);

  saveUser(user);
  return updatedReviews;
};

// Logout helper
export const logoutUser = () => {
  try {
    localStorage.removeItem('4s_auth_token');
    localStorage.removeItem('4s_active_user');
    localStorage.removeItem('4s_is_logged_in');
    localStorage.removeItem('4s_chat_conversations');
    window.dispatchEvent(new Event('4s_auth_change'));
  } catch (e) {
    console.error('Error logging out', e);
  }
};

// React hook for observing auth state
export const useAuth = () => {
  const [user, setUser] = useState(getStoredUser());
  const [loggedIn, setLoggedIn] = useState(isUserLoggedIn());
  const [conversations, setConversations] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [availability, setAvailability] = useState([]);

  const studentId = user?.StudentID || user?.studentId || user?.id;

  const refreshConversations = useCallback(async () => {
    if (!studentId) return;
    try {
      const data = await api.messages.getConversations(studentId);
      if (Array.isArray(data)) {
        cachedConversations = data;
        setConversations(data);
      }
    } catch (err) {
      console.warn('Failed to fetch conversations:', err);
    }
  }, [studentId]);

  const refreshSessions = useCallback(async () => {
    if (!studentId) return;
    try {
      const data = await api.sessions.getByStudent(studentId);
      if (Array.isArray(data)) {
        cachedSessions = data;
        setSessions(data);
      }
    } catch (err) {
      console.warn('Failed to fetch sessions:', err);
    }
  }, [studentId]);

  const refreshAvailability = useCallback(async () => {
    if (!studentId) return;
    try {
      const data = await api.availability.getByStudent(studentId);
      if (Array.isArray(data)) {
        cachedAvailability = data;
        setAvailability(data);
      }
    } catch (err) {
      console.warn('Failed to fetch availability:', err);
    }
  }, [studentId]);

  useEffect(() => {
    const syncAuth = () => {
      const u = getStoredUser();
      setUser(u);
      setLoggedIn(isUserLoggedIn());
    };

    window.addEventListener('4s_auth_change', syncAuth);
    window.addEventListener('4s_chat_change', refreshConversations);
    window.addEventListener('4s_sessions_change', refreshSessions);
    window.addEventListener('4s_availability_change', refreshAvailability);
    window.addEventListener('storage', syncAuth);

    return () => {
      window.removeEventListener('4s_auth_change', syncAuth);
      window.removeEventListener('4s_chat_change', refreshConversations);
      window.removeEventListener('4s_sessions_change', refreshSessions);
      window.removeEventListener('4s_availability_change', refreshAvailability);
      window.removeEventListener('storage', syncAuth);
    };
  }, [refreshConversations, refreshSessions, refreshAvailability]);

  // Initial fetch and 10s polling for real backend synchronization
  useEffect(() => {
    if (!studentId) return;

    refreshConversations();
    refreshSessions();
    refreshAvailability();

    const interval = setInterval(() => {
      refreshConversations();
      refreshSessions();
      refreshAvailability();
    }, 10000);

    const onFocus = () => {
      refreshConversations();
      refreshSessions();
      refreshAvailability();
    };
    window.addEventListener('focus', onFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [studentId, refreshConversations, refreshSessions, refreshAvailability]);

  const safeUser = user || {
    id: '',
    studentId: '',
    name: '',
    email: '',
    department: '',
    year: '',
    bio: '',
    rating: '5.00',
    sessionsTaught: 0,
    sessionsAttended: 0,
    skillsOffered: [],
    skillsWanted: [],
    upcomingSessions: [],
    weeklyAvailability: [],
    recentReviews: [],
    achievements: []
  };

  return {
    user: safeUser,
    loggedIn,
    saveUser,
    logoutUser,
    skills: safeUser.skillsOffered || [],
    requests: safeUser.skillsWanted || [],
    sessions,
    availability,
    reviews: safeUser.recentReviews || [],
    achievements: safeUser.achievements || [],
    conversations,
    refreshConversations,
    refreshSessions,
    refreshAvailability,
    addUserSkill,
    updateUserSkill,
    deleteUserSkill,
    addUserRequest,
    updateUserRequest,
    deleteUserRequest,
    scheduleSession,
    updateSessionStatus,
    cancelSession,
    deleteSession,
    saveUserAvailability,
    toggleDayAvailability,
    addAvailabilitySlot,
    removeAvailabilitySlot,
    sendChatMessage,
    markConversationAsRead,
    sendMessageToPeer,
    updateUserProfile,
    addUserReview,
    calculateDynamicAchievements
  };
};
