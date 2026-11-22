import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import {
  Users,
  Search,
  Star,
  Clock,
  Sparkles,
  ArrowRight,
  MessageSquare,
  Calendar,
  Send,
  CheckCircle2,
  X,
  Share2,
  BookmarkPlus,
  Video,
  MapPin,
  ExternalLink,
  ChevronRight,
  Info,
  Layers,
  GraduationCap
} from 'lucide-react';
import {
  SAMPLE_PEER_MATCHES,
  ALL_CATEGORIES,
  doesStudentOfferSkill,
  getStudentOfferedSkills,
  getMatchingSkillDisplay,
  calculateCompatibility,
  normalizeText,
  findMatchesForLearningRequest,
  resolveOrAddCourse,
  getCourseById,
  formatDisplayId,
  findMatches
} from '../utils/mockData.js';
import { useAuth, sendMessageToPeer } from '../utils/auth.js';
import api, { normalizeStudentId } from '../utils/api.js';
import AnimatedCounter from '../components/AnimatedCounter.jsx';
import ComicBurstBadge from '../components/ComicBurstBadge.jsx';
import TeamUpLine from '../components/TeamUpLine.jsx';
import MatchFoundAnimation from '../components/MatchFoundAnimation.jsx';
import MangaCard from '../components/MangaCard.jsx';
import PowerLevelMeter from '../components/PowerLevelMeter.jsx';
import AnimeIdChip from '../components/AnimeIdChip.jsx';
import { getOrAssignTeacherCourse, buildLearningId } from '../utils/idEngine.js';
import { getCategoryAccentColor } from '../utils/categoryColors.js';
import { resetScrollToTop } from '../utils/useScrollToTop.js';
import RequestsPanel from '../components/RequestsPanel.jsx';
import './Matches.css';

const Matches = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, requests } = useAuth();
  const [backendMatches, setBackendMatches] = useState([]);
  const [backendRequests, setBackendRequests] = useState([]);

  const fetchMatchesData = async () => {
    const studentId = user?.id || user?.StudentID || user?.studentId;
    if (!studentId) return;
    try {
      const [matchesRes, wantedRes] = await Promise.all([
        api.matches.getMatches(studentId).catch(() => []),
        api.wanted.getByStudent(studentId).catch(() => [])
      ]);
      if (Array.isArray(matchesRes)) {
        setBackendMatches(matchesRes);
      }
      if (Array.isArray(wantedRes)) {
        setBackendRequests(wantedRes);
      }
    } catch (err) {
      console.error('Failed to load matches from backend:', err);
    }
  };

  useEffect(() => {
    fetchMatchesData();
  }, [user?.id, user?.studentId]);

  // Auto-scroll to #requests if hash is present
  useEffect(() => {
    const handleHashScroll = () => {
      if (window.location.hash === '#requests') {
        setTimeout(() => {
          const el = document.getElementById('requests');
          if (el) {
            el.scrollIntoView({ behavior: 'smooth' });
          }
        }, 150);
      }
    };

    handleHashScroll();
    window.addEventListener('hashchange', handleHashScroll);
    return () => window.removeEventListener('hashchange', handleHashScroll);
  }, []);

  // Active student's learning requests from auth/backend
  const userRequests = useMemo(() => {
    if (backendRequests.length > 0) return backendRequests;
    return requests || user?.skillsWanted || [];
  }, [backendRequests, requests, user]);

  // Query parameter pre-filtering
  const skillParam = searchParams.get('skill');
  const courseParam = searchParams.get('courseId');
  const learningParam = searchParams.get('learningId');

  // Selected learning request (default to ALL or matching URL param)
  const [selectedLearningId, setSelectedLearningId] = useState(() => {
    if (learningParam) return learningParam;
    if (skillParam && userRequests.length > 0) {
      const matchReq = userRequests.find(
        (r) =>
          normalizeText(r.name) === normalizeText(skillParam) ||
          normalizeText(r.category) === normalizeText(skillParam)
      );
      if (matchReq) return matchReq.learningId || matchReq.id;
    }
    return 'ALL';
  });

  const [searchQuery, setSearchQuery] = useState(skillParam || '');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedTiming, setSelectedTiming] = useState('All');

  // Interactive Modals
  const [profileModalPeer, setProfileModalPeer] = useState(null);
  const [messageModalPeer, setMessageModalPeer] = useState(null);
  const [sessionModalPeer, setSessionModalPeer] = useState(null);
  const [matchPopupData, setMatchPopupData] = useState(null);
  const hasAutoMatchedRef = useRef(false);

  // Lock body scroll whenever any modal popup is open and ensure modal is scrolled to top
  useEffect(() => {
    const isAnyModalOpen = Boolean(profileModalPeer || messageModalPeer || sessionModalPeer || matchPopupData);
    if (isAnyModalOpen) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      // Reset scroll on all modal cards
      requestAnimationFrame(() => {
        const modalCards = document.querySelectorAll('.modal-card, .modal-dialog, .modal-body');
        modalCards.forEach((c) => {
          if (c) c.scrollTop = 0;
        });
      });

      const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
          setProfileModalPeer(null);
          setMessageModalPeer(null);
          setSessionModalPeer(null);
          setMatchPopupData(null);
        }
      };
      window.addEventListener('keydown', handleKeyDown);

      return () => {
        document.body.style.overflow = prevOverflow;
        window.removeEventListener('keydown', handleKeyDown);
      };
    } else {
      document.body.style.overflow = '';
    }
  }, [profileModalPeer, messageModalPeer, sessionModalPeer, matchPopupData]);

  // Message Form State
  const [messageText, setMessageText] = useState('');

  // Session Booking Form State
  const [sessionForm, setSessionForm] = useState({
    topic: '',
    dateTime: 'Tomorrow · 4:00 PM – 5:00 PM',
    mode: 'Google Meet',
    notes: ''
  });

  const [toastMessage, setToastMessage] = useState(null);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  // Sync if URL search param updates
  useEffect(() => {
    if (skillParam !== null && skillParam !== undefined) {
      setSearchQuery(skillParam);
    }
  }, [skillParam]);

  // Active selected learning request object
  const activeLearningRequest = useMemo(() => {
    if (!selectedLearningId || selectedLearningId === 'ALL') return null;
    return userRequests.find(
      (r) => (r.learningId || r.id) === selectedLearningId
    );
  }, [selectedLearningId, userRequests]);

  // ---------------------------------------------------------------------------
  // MULTI-FACTOR MATCHING ENGINE DERIVATION (Requirements 6, 7, 8, 9, 10, 11)
  // ---------------------------------------------------------------------------
  const matchedTeachersList = useMemo(() => {
    const currentStudentId = user?.studentId || 'STU001';
    const trimmedQuery = searchQuery.trim();

    // Source pool: backend matches if available, otherwise safely mapped fallback pool
    let pool = [];

    if (backendMatches && backendMatches.length > 0) {
      pool = backendMatches.map((r, idx) => {
        const peerStuId = r.studentId || `STU${String(r.teacherId || 4).padStart(3, '0')}`;
        const courseId = r.courseId || `CRS${String(r.skillId || 1).padStart(3, '0')}`;
        const teachingId = r.teachingId || `TCH${String(r.teacherId || 1).padStart(3, '0')}`;
        const skillName = r.skillOffered || r.SkillName || r.name || 'Skill';
        const reasons = Array.isArray(r.matchReasons) && r.matchReasons.length > 0
          ? r.matchReasons
          : [
              `Campus Peer Mentor: ${r.name || 'Student'}`,
              `Offers ${skillName} (${r.category || 'General'})`,
              r.mutualSwap ? 'Mutual Reciprocal Skill Swap Available' : 'Available on your learning wishlist'
            ];

        return {
          matchId: r.matchId || `MAT_${peerStuId}_${courseId}`,
          Match_ID: r.matchId || `MAT_${peerStuId}_${courseId}`,
          studentId: currentStudentId,
          teacherStudentId: peerStuId,
          Student_ID: peerStuId,
          teacherId: r.teacherId,
          skillId: r.skillId,
          learningId: r.learningId || 'LRN001',
          teachingId,
          SS_ID: teachingId,
          courseId,
          courseName: skillName,
          score: r.compatibilityScore || r.score || (r.mutualSwap ? 96 : 88),
          Match_Score: r.compatibilityScore || r.score || (r.mutualSwap ? 96 : 88),
          matchReasons: reasons,
          status: 'Suggested',
          peerId: r.id || `peer-${idx}`,
          name: r.name || 'Campus Student',
          dept: r.dept || 'Engineering',
          avatar: r.avatar || ((r.name || 'ST').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase()),
          avatarBg: r.avatarBg || 'avatar-indigo',
          rating: r.rating || '5.0',
          sessionsDelivered: r.sessionsDelivered != null ? r.sessionsDelivered : 12,
          skillOffered: skillName,
          teachSkill: skillName,
          category: r.category || 'General',
          proficiencyLevel: r.proficiencyLevel || 'Advanced',
          availability: r.availability || 'Flexible Schedule',
          bio: r.bio || `${r.name || 'Student'} is a skilled mentor ready to guide you.`,
          wantsToLearn: r.wantsToLearn || '',
          mutualSwap: Boolean(r.mutualSwap || r.mutualSwapAvailable),
          peerOriginal: r
        };
      });
    } else {
      // Safe fallback from SAMPLE_PEER_MATCHES if backend has not returned matches yet
      pool = SAMPLE_PEER_MATCHES.filter((p) => p.studentId !== currentStudentId).map((p, idx) => {
        const rec = p.teachingRecords?.[0] || {
          teachingId: p.teachingId || `TCH00${idx + 1}`,
          courseId: p.courseId || `CRS00${idx + 1}`,
          skillName: p.skillOffered || 'Skill',
          category: p.category || 'General',
          proficiency: p.proficiencyLevel || 'Advanced',
          availability: p.availability || 'Flexible Schedule'
        };
        const courseName = rec.skillName || p.skillOffered || 'Skill';
        return {
          matchId: `MAT_ALL_${rec.teachingId}`,
          Match_ID: `MAT_ALL_${rec.teachingId}`,
          studentId: currentStudentId,
          teacherStudentId: p.studentId,
          Student_ID: p.studentId,
          teacherId: Number(String(p.studentId || '').replace(/\D/g, '')) || idx + 2,
          skillId: idx + 1,
          learningId: 'LRN001',
          teachingId: rec.teachingId,
          SS_ID: rec.teachingId,
          courseId: rec.courseId,
          courseName,
          score: p.compatibilityScore || 88,
          Match_Score: p.compatibilityScore || 88,
          matchReasons: [
            `Campus Peer Mentor: ${p.name || 'Peer'}`,
            `Offers ${rec.skillName} (${rec.courseId})`
          ],
          status: 'Suggested',
          peerId: p.id,
          name: p.name || 'Campus Peer',
          dept: p.dept || 'Engineering',
          avatar: p.avatar || 'SP',
          avatarBg: p.avatarBg || 'avatar-indigo',
          rating: p.rating || '5.0',
          sessionsDelivered: p.sessionsDelivered || 10,
          skillOffered: rec.skillName,
          teachSkill: rec.skillName,
          category: rec.category,
          proficiencyLevel: rec.proficiency || p.proficiencyLevel || 'Advanced',
          availability: rec.availability || p.availability || 'Flexible Schedule',
          bio: p.bio || '',
          wantsToLearn: p.wantsToLearn || '',
          mutualSwap: Boolean(p.mutualSwapAvailable),
          teachingRecord: rec,
          peerOriginal: p
        };
      });
    }

    let results = pool;

    // Filter by search query if any
    if (trimmedQuery) {
      const q = trimmedQuery.toLowerCase();
      results = results.filter((m) =>
        (m.skillOffered || '').toLowerCase().includes(q) ||
        (m.category || '').toLowerCase().includes(q) ||
        (m.name || '').toLowerCase().includes(q)
      );
    } else if (activeLearningRequest) {
      const reqName = (activeLearningRequest.name || '').toLowerCase();
      const reqCat = (activeLearningRequest.category || '').toLowerCase();
      results = results.filter((m) =>
        (m.skillOffered || '').toLowerCase().includes(reqName) ||
        reqName.includes((m.skillOffered || '').toLowerCase()) ||
        (m.category || '').toLowerCase() === reqCat
      );
    }

    // Filter by Category
    if (selectedCategory !== 'All') {
      const normCat = normalizeText(selectedCategory);
      results = results.filter(
        (m) =>
          normalizeText(m.category || '') === normCat ||
          normalizeText(m.skillOffered || '').includes(normCat)
      );
    }

    // Filter by Timing
    if (selectedTiming !== 'All') {
      results = results.filter((m) => {
        const avail = String(m.availability || '').toLowerCase();
        if (selectedTiming === 'Weekdays') return avail.includes('weekday');
        if (selectedTiming === 'Weekends') return avail.includes('weekend');
        if (selectedTiming === 'Evenings') return avail.includes('evening');
        return true;
      });
    }

    return results.sort((a, b) => (b.score || 0) - (a.score || 0));
  }, [
    backendMatches,
    searchQuery,
    activeLearningRequest,
    selectedCategory,
    selectedTiming,
    user?.studentId
  ]);

  // Trigger match popup once when arriving from a specific match query
  useEffect(() => {
    if (skillParam && !hasAutoMatchedRef.current && matchedTeachersList.length > 0) {
      hasAutoMatchedRef.current = true;
      const topMatch = matchedTeachersList[0];
      setMatchPopupData({
        teacherName: topMatch.name,
        learnerName: (user?.name || 'You').split(' ')[0],
        teacherSkill: topMatch.skillOffered,
        learnerSkill: topMatch.wantsToLearn || topMatch.skillOffered,
        score: topMatch.score || 96
      });
    }
  }, [skillParam, matchedTeachersList, user]);

  const handleTriggerMatchPopup = (match) => {
    setMatchPopupData({
      teacherName: match.name,
      learnerName: (user?.name || 'You').split(' ')[0],
      teacherSkill: match.skillOffered,
      learnerSkill: match.wantsToLearn || match.skillOffered,
      score: match.score || 92
    });
  };

  // Handle open message modal
  const handleOpenMessage = (match) => {
    setMessageModalPeer(match);
    setMessageText('');
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!messageModalPeer || !messageText.trim()) return;

    const peerId = messageModalPeer.teacherId || messageModalPeer.studentId;
    sendMessageToPeer(messageModalPeer.name, messageText.trim(), messageModalPeer.avatar, peerId);
    const peerName = messageModalPeer.name;
    setMessageModalPeer(null);
    showToast(`Message sent to ${peerName}! You can continue chatting in Messages.`);
  };

  // Handle open session modal
  const handleOpenSession = (match) => {
    setSessionModalPeer(match);
    setSessionForm({
      topic: `${match.skillOffered} — Peer Mentoring Session`,
      dateTime: 'Tomorrow · 4:00 PM – 5:00 PM',
      mode: 'Google Meet',
      notes: `Focusing on ${match.courseName || match.skillOffered} practical concepts.`
    });
  };

  const handleScheduleSubmit = async (e) => {
    e.preventDefault();
    if (!sessionModalPeer) return;

    const bookedMatch = sessionModalPeer;
    const studentId = user?.id || user?.StudentID || user?.studentId;

    // 1. Create exchange on backend: POST /api/exchanges (Status: Pending)
    if (studentId && bookedMatch) {
      try {
        const teacherId = bookedMatch.teacherId || normalizeStudentId(bookedMatch.teacherStudentId);
        const learnerId = normalizeStudentId(studentId);
        if (!teacherId || Number(teacherId) === Number(learnerId)) {
          showToast('Could not schedule: Teacher ID is missing or invalid.');
          return;
        }
        const skillId = bookedMatch.skillId;
        if (skillId) {
          const noteParts = [
            sessionForm.topic ? `Topic: ${sessionForm.topic}` : '',
            sessionForm.dateTime ? `Preferred Time: ${sessionForm.dateTime}` : '',
            sessionForm.mode ? `Mode: ${sessionForm.mode}` : '',
            sessionForm.notes ? `Notes: ${sessionForm.notes}` : ''
          ].filter(Boolean).join(' | ');

          await api.exchanges.create({
            teacherId,
            learnerId,
            skillId,
            note: noteParts || null
          });
          window.dispatchEvent(new Event('4s_request_change'));
          window.dispatchEvent(new Event('4s_exchange_change'));
        }
      } catch (err) {
        // 409 means an open exchange already exists between this pair and skill
        console.warn('Exchange notice:', err?.message || err);
      }
    }

    setSessionModalPeer(null);
    showToast(`Request sent. Awaiting ${bookedMatch.name}'s reply.`);

    // Trigger Match Handshake Popup with real learner, teacher, skill and score
    setMatchPopupData({
      teacherName: bookedMatch.name,
      learnerName: (user?.name || 'You').split(' ')[0],
      teacherSkill: bookedMatch.skillOffered,
      learnerSkill: bookedMatch.wantsToLearn || bookedMatch.skillOffered,
      score: bookedMatch.Match_Score || bookedMatch.score || 94,
      isRequestPending: true
    });
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedCategory('All');
    setSelectedTiming('All');
    setSelectedLearningId('ALL');
    setSearchParams({});
  };

  const userInitials = (user?.name || 'ME')
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'ME';

  return (
    <div className="matches-page">
      <div className="container">
        {/* Floating Toast Notification */}
        {toastMessage && (
          <div className="app-toast-alert">
            <CheckCircle2 size={18} className="text-emerald-400" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* Header */}
        <div className="matches-header">
          <span className="matches-kicker">Multi-Factor Matching Engine</span>
          <h1 className="matches-title">Peer Learning Matches</h1>
          <p className="matches-subtitle">
            Match with campus teachers using Course IDs, skill progression levels, timetable compatibility, teaching experience, and verified peer ratings.
          </p>
        </div>

        {/* ==================================================================
            SECTION 1: SKILLS YOU WANT TO LEARN (Requirement 11)
            ================================================================== */}
        {userRequests.length > 0 && (
          <div className="learning-goals-section">
            <div className="learning-goals-header">
              <div className="learning-goals-title-group">
                <h2>
                  <GraduationCap size={20} className="text-primary" />
                  <span>Skills You Want to Learn</span>
                </h2>
                <p>
                  Select a learning goal to view recommended student mentors teaching that exact Course ID.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedLearningId('ALL')}
                  className={`btn btn-sm ${
                    selectedLearningId === 'ALL' ? 'btn-primary' : 'btn-outline'
                  }`}
                >
                  <span>All Learning Goals</span>
                </button>
                <Link to="/requests" className="btn btn-sm btn-outline">
                  <BookmarkPlus size={14} />
                  <span>+ Add Goal</span>
                </Link>
              </div>
            </div>

            <div className="learning-goals-grid">
              {userRequests.map((req) => {
                const reqId = req.learningId || req.id;
                const cId = req.courseId || resolveOrAddCourse(req.name, req.category);
                const isSelected = selectedLearningId === reqId;

                return (
                  <div
                    key={reqId}
                    className={`learning-goal-card ${isSelected ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedLearningId(reqId);
                      setSearchQuery('');
                      setSelectedCategory('All');
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="goal-card-top">
                      <div className="goal-ids-row">
                        <span className="badge-id badge-learning-id">
                          Learning ID: {req.learningId || reqId}
                        </span>
                        <span className="badge-id badge-course-id">
                          Course ID: {cId}
                        </span>
                      </div>
                      {isSelected && (
                        <CheckCircle2 size={16} className="text-primary flex-shrink-0" />
                      )}
                    </div>

                    <h4 className="goal-card-name">{req.name}</h4>

                    <div className="goal-levels-row">
                      <span>Current: <strong className="level-tag">{req.currentLevel || 'Beginner'}</strong></span>
                      <ArrowRight size={12} className="text-muted" />
                      <span>Target: <strong className="level-tag text-primary">{req.desiredLevel || req.preferredLevel || 'Advanced'}</strong></span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ==================================================================
            SEARCH & CONTROLS BAR
            ================================================================== */}
        <div className="matches-controls-card">
          <div className="matches-search-row">
            <div className="matches-search-box">
              <Search size={18} className="search-icon-left" />
              <input
                type="text"
                className="matches-search-input"
                placeholder="Search by skill or course (e.g. Python, Web Development, C, UI/UX Design, Data Science, Graphic Design)..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (selectedCategory !== 'All') setSelectedCategory('All');
                  if (selectedLearningId !== 'ALL') setSelectedLearningId('ALL');
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => {
                    setSearchQuery('');
                    setSearchParams({});
                  }}
                  title="Clear search"
                >
                  <X size={16} />
                </button>
              )}
            </div>

            {/* Quick Timing Filter */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-600">Availability:</span>
              <select
                className="filter-select"
                value={selectedTiming}
                onChange={(e) => setSelectedTiming(e.target.value)}
              >
                <option value="All">Any Timetable</option>
                <option value="Weekdays">Weekdays</option>
                <option value="Weekends">Weekends</option>
                <option value="Evenings">Evenings</option>
              </select>
            </div>

            {(searchQuery || selectedCategory !== 'All' || selectedTiming !== 'All' || selectedLearningId !== 'ALL') && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="btn btn-sm btn-ghost text-primary font-semibold"
              >
                <X size={14} />
                <span>Reset</span>
              </button>
            )}
          </div>

          {/* Category Filter Row */}
          <div className="matches-pills-row">
            {ALL_CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`category-pill-btn ${selectedCategory === cat ? 'active' : ''}`}
                onClick={() => {
                  setSelectedCategory(cat);
                  setSearchQuery(cat === 'All' ? '' : cat);
                }}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* ==================================================================
            SECTION 2: RECOMMENDED TEACHERS (Requirement 11)
            ================================================================== */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Users size={20} className="text-primary" />
              <span>Recommended Teachers</span>
              {activeLearningRequest && (
                <span className="text-sm font-semibold text-primary">
                  for “{activeLearningRequest.name}”{activeLearningRequest.courseId ? ` (${activeLearningRequest.courseId})` : ''}
                </span>
              )}
            </h2>
            <p className="text-xs text-muted mt-0.5">
              Multi-factor matching score evaluated on Course ID (40%), Skill Level (20%), Target Goal (5%), Schedule (15%), Experience (10%), and Rating (10%).
            </p>
          </div>

          <span className="text-xs font-bold text-slate-500">
            {matchedTeachersList.length} {matchedTeachersList.length === 1 ? 'Match' : 'Matches'} Found
          </span>
        </div>

        {matchedTeachersList.length > 0 ? (
          <div className="matches-grid">
            {matchedTeachersList.map((match, index) => {
              const compScore = match.score || 90;

              return (
                <MangaCard
                  key={match.matchId || `${match.teacherStudentId}_${match.courseId}_${index}`}
                  index={index}
                  accentColor={getCategoryAccentColor(match.category, index)}
                  cornerLabel={match.category}
                  className="match-card"
                >
                  <div>
                    {/* Single Learning ID (names both person and course) */}
                    {(() => {
                      const peerStuId = match.Student_ID || match.studentId || match.peerStudentId || 'STU004';
                      const teacherTcr = getOrAssignTeacherCourse(peerStuId, match.teachSkill || match.name);
                      const matchLearningId = buildLearningId(user?.studentId || 'STU001', teacherTcr);

                      return (
                        <div className="match-id-meta-bar flex items-center gap-2 flex-wrap my-1.5 text-xs">
                          <span className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wide">Target Enrollment:</span>
                          <AnimeIdChip
                            id={matchLearningId}
                            type="LRN"
                            size="md"
                            record={match}
                            context={{
                              userName: user?.name,
                              learnerName: user?.name,
                              isLearnerCurrentUser: true,
                              teacherName: match.name,
                              skillName: match.teachSkill
                            }}
                          />
                        </div>
                      );
                    })()}

                    {/* Top: Student Header, Team-Up Line & Compatibility Comic Burst */}
                    <div className="match-card-header">
                      <div className="match-student-info">
                        <div
                          className="match-teamup-duo"
                          aria-label={`Team-Up connection between You and ${match.name}`}
                        >
                          <div className="match-avatar match-avatar-you" title={`You (${user?.name || 'Student'})`}>
                            {userInitials}
                            <span className="teamup-tag">YOU</span>
                          </div>
                          <TeamUpLine delay={index * 0.1 + 0.2} width={75} />
                          <div className={`match-avatar ${match.avatarBg}`} title={match.name}>
                            {match.avatar}
                            <span className="teamup-tag">PEER</span>
                          </div>
                        </div>

                        <div className="match-student-text">
                          <h3>{match.name}</h3>
                          <p>{match.dept}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="flex items-center text-amber-500 font-bold text-xs">
                              <Star size={12} fill="#f59e0b" />
                              <span className="ml-1 text-slate-800">{match.rating}</span>
                            </span>
                            <span className="text-xs text-muted">
                              · {match.sessionsDelivered} sessions delivered
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Compatibility Score inside Comic Burst Badge */}
                      <div className="compatibility-box">
                        <ComicBurstBadge
                          score={compScore}
                          suffix="% Match"
                          delay={index * 0.1}
                        />
                        <span className="compatibility-subtext">Compatibility Score</span>
                      </div>
                    </div>

                    {/* Skills Exchange Matching Block */}
                    <div className="match-skills-block">
                      {/* Can Teach You */}
                      <div className="match-skill-row">
                        <span className="match-skill-label">Can Teach You:</span>
                        <strong className="match-skill-name text-primary">
                          {match.skillOffered}
                        </strong>
                        <PowerLevelMeter level={match.proficiencyLevel} />
                      </div>

                      {/* Reciprocal Learning */}
                      {match.wantsToLearn && (
                        <div className="match-reciprocal-tag">
                          <Share2 size={13} />
                          <span>
                            Wants to Learn from You: <strong>{match.wantsToLearn}</strong>
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Why this is a match (Requirement 11) */}
                    {match.matchReasons && match.matchReasons.length > 0 && (
                      <div className="match-reasons-block">
                        <span className="match-reasons-heading">Why This Is A Match:</span>
                        <ul className="match-reasons-list">
                          {match.matchReasons.map((reason, rIdx) => (
                            <li key={rIdx} className="match-reason-item">
                              <CheckCircle2 size={13} />
                              <span>{reason}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Short Bio */}
                    <p className="match-student-bio">{match.bio}</p>

                    {/* Availability */}
                    <div className="match-timing-info">
                      <Clock size={15} className="text-primary flex-shrink-0" />
                      <span>
                        Free Schedule: <strong>{match.availability}</strong>
                      </span>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="match-actions-grid">
                    <button
                      type="button"
                      onClick={() => setProfileModalPeer(match)}
                      className="btn btn-sm btn-outline"
                    >
                      <span>View Profile</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenMessage(match)}
                      className="btn btn-sm btn-outline-primary"
                    >
                      <MessageSquare size={13} />
                      <span>Message</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenSession(match)}
                      className="btn btn-sm btn-primary"
                    >
                      <Calendar size={13} />
                      <span>Request Session</span>
                    </button>
                  </div>
                </MangaCard>
              );
            })}
          </div>
        ) : (
          /* Empty State strictly following Step 8 */
          <div className="matches-empty-card">
            <div className="empty-matches-icon">
              <Users size={32} />
            </div>
            <h3 className="font-bold text-xl text-slate-900 mb-2">
              {searchQuery.trim()
                ? `No matches found for “${searchQuery.trim()}”`
                : activeLearningRequest
                ? `No teachers currently match ${activeLearningRequest.name}${activeLearningRequest.courseId ? ` (${activeLearningRequest.courseId})` : ''}`
                : 'No matches found'}
            </h3>
            <p className="text-sm text-muted max-w-md mx-auto mb-6">
              Try another skill or explore all available skills.
            </p>
            <div className="flex justify-center gap-3">
              <Link to="/explore" className="btn btn-primary">
                <Search size={16} />
                <span>Explore Skills</span>
              </Link>
              <button onClick={handleResetFilters} className="btn btn-outline">
                <span>Reset Filters</span>
              </button>
            </div>
          </div>
        )}

        {/* ==================================================================
            SECTION 3: REQUESTS PANEL (Incoming & My Requests)
            ================================================================== */}
        <RequestsPanel showToast={showToast} onRefreshMatches={fetchMatchesData} />
      </div>

      {/* ------------------------------------------------------------------
          Modal 1: View Peer Profile
          ------------------------------------------------------------------ */}
      {profileModalPeer && (
        <div className="modal-overlay" onClick={() => setProfileModalPeer(null)}>
          <div className="modal-card" style={{ maxWidth: '540px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Student Peer Profile</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setProfileModalPeer(null)}
              >
                <X size={20} />
              </button>
            </div>

            <div className="modal-body">
              {/* Header with TeamUp Duo */}
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="match-teamup-duo">
                    <div className="match-avatar match-avatar-you" style={{ width: '3.25rem', height: '3.25rem' }}>
                      {userInitials}
                      <span className="teamup-tag">YOU</span>
                    </div>
                    <TeamUpLine delay={0.2} width={70} />
                    <div className={`match-avatar ${profileModalPeer.avatarBg}`} style={{ width: '3.25rem', height: '3.25rem', fontSize: '1.25rem' }}>
                      {profileModalPeer.avatar}
                      <span className="teamup-tag">PEER</span>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-lg font-bold text-slate-900">{profileModalPeer.name}</h4>
                    <p className="text-sm text-muted">{profileModalPeer.dept}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="flex items-center text-amber-500 font-bold text-xs">
                        <Star size={13} fill="#f59e0b" />
                        <span className="ml-1 text-slate-800">{profileModalPeer.rating} Peer Rating</span>
                      </span>
                      <span className="text-xs text-muted">· {profileModalPeer.sessionsDelivered} sessions taught</span>
                    </div>
                  </div>
                </div>

                <ComicBurstBadge score={profileModalPeer.score || 90} suffix="% Match" delay={0.2} />
              </div>

              {/* ID Badges */}
              <div className="flex items-center gap-2">
                <span className="badge-id badge-teaching-id">Teaching ID: {profileModalPeer.teachingId}</span>
                <span className="badge-id badge-course-id">Course ID: {profileModalPeer.courseId}</span>
              </div>

              {/* Bio */}
              <div style={{ backgroundColor: '#f8fafc', padding: '1rem', borderRadius: '0.5rem', border: '1px solid var(--border-color)' }}>
                <h5 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">About Student Mentor:</h5>
                <p className="text-sm text-slate-700">{profileModalPeer.bio}</p>
              </div>

              {/* Teaching & Learning Synergy */}
              <div className="grid grid-cols-2 gap-3">
                <div style={{ backgroundColor: 'var(--primary-light)', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid var(--primary-border)' }}>
                  <span className="text-xs font-bold text-primary uppercase block mb-1">Can Teach You:</span>
                  <strong className="text-sm text-slate-900">{profileModalPeer.skillOffered}</strong>
                  <div style={{ marginTop: '0.35rem' }}>
                    <PowerLevelMeter level={profileModalPeer.proficiencyLevel} />
                  </div>
                </div>

                <div style={{ backgroundColor: 'var(--secondary-light)', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid var(--secondary-border)' }}>
                  <span className="text-xs font-bold text-secondary uppercase block mb-1">Wants to Learn:</span>
                  <strong className="text-sm text-slate-900">{profileModalPeer.wantsToLearn || 'Web Dev'}</strong>
                  <span className="text-xs text-muted block mt-0.5">(Mutual Skill Swap)</span>
                </div>
              </div>

              {/* Compatibility Breakdown */}
              {profileModalPeer.matchReasons && (
                <div>
                  <h5 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2 flex items-center gap-1.5">
                    <Sparkles size={14} className="text-emerald-600" />
                    <span>Why this is a Match ({profileModalPeer.score}%):</span>
                  </h5>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    {profileModalPeer.matchReasons.map((reason, idx) => (
                      <li key={idx} className="flex items-center gap-2 text-xs text-slate-700">
                        <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0" />
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Schedule */}
              <div className="flex items-center gap-2 text-xs text-slate-600 pt-2 border-t border-slate-100">
                <Clock size={14} className="text-primary" />
                <span>Available Schedule: <strong>{profileModalPeer.availability}</strong></span>
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setProfileModalPeer(null)}
              >
                Close
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const p = profileModalPeer;
                  setProfileModalPeer(null);
                  handleOpenSession(p);
                }}
              >
                <Calendar size={14} />
                <span>Request Session</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------
          Modal 2: Send Message to Peer
          ------------------------------------------------------------------ */}
      {messageModalPeer && (
        <div className="modal-overlay" onClick={() => setMessageModalPeer(null)}>
          <div className="modal-card" style={{ maxWidth: '520px' }} onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleSendMessage}>
              <div className="modal-header">
                <h3>Message {messageModalPeer.name}</h3>
                <button
                  type="button"
                  className="modal-close-btn"
                  onClick={() => setMessageModalPeer(null)}
                >
                  <X size={20} />
                </button>
              </div>

              <div className="modal-body">
                <div style={{ backgroundColor: '#f8fafc', padding: '0.875rem 1rem', borderRadius: '0.5rem', border: '1px solid var(--border-color)' }}>
                  <p className="text-xs text-muted">Direct Campus Message to:</p>
                  <h4 className="text-sm font-bold text-slate-900 mt-0.5">{messageModalPeer.name} ({messageModalPeer.dept})</h4>
                  <p className="text-xs text-primary font-semibold mt-0.5">Topic: {messageModalPeer.skillOffered} (Course ID: {messageModalPeer.courseId})</p>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="msg-content">
                    Your Message
                  </label>
                  <textarea
                    id="msg-content"
                    rows={5}
                    className="form-input"
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    required
                    placeholder="Introduce yourself, discuss what you want to learn, or suggest a time to meet on campus..."
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => {
                    const peerName = messageModalPeer.name;
                    const peerId = messageModalPeer.teacherId || messageModalPeer.studentId;
                    setMessageModalPeer(null);
                    navigate(`/messages?user=${encodeURIComponent(peerName)}${peerId ? `&peerId=${encodeURIComponent(peerId)}` : ''}`);
                  }}
                >
                  <MessageSquare size={14} />
                  <span>Open Full Chat</span>
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setMessageModalPeer(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  <Send size={15} />
                  <span>Send Direct Message</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------
          Modal 3: Request a Session
          ------------------------------------------------------------------ */}
      {sessionModalPeer &&
        createPortal(
          <div className="modal-overlay" onClick={() => setSessionModalPeer(null)}>
            <div
              className="modal-card"
              style={{
                maxWidth: '540px',
                width: '100%',
                maxHeight: 'calc(100vh - 2rem)',
                maxHeight: 'calc(100dvh - 2rem)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <form onSubmit={handleScheduleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                <div className="modal-header" style={{ flexShrink: 0 }}>
                  <h3>Request Skill Exchange with {sessionModalPeer.name}</h3>
                  <button
                    type="button"
                    className="modal-close-btn"
                    onClick={() => setSessionModalPeer(null)}
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="modal-body" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                  {/* Session Mentor Summary */}
                  <div style={{ backgroundColor: '#f8fafc', padding: '0.875rem 1rem', borderRadius: '0.5rem', border: '1px solid var(--border-color)' }}>
                    <span className="text-xs text-muted">Peer Mentor:</span>
                    <h4 className="text-base font-bold text-slate-900">{sessionModalPeer.name}</h4>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="badge-id badge-teaching-id">Teaching ID: {sessionModalPeer.teachingId}</span>
                      <span className="badge-id badge-course-id">Course ID: {sessionModalPeer.courseId}</span>
                    </div>
                    <p className="text-xs text-primary font-semibold mt-1">
                      Teaching: {sessionModalPeer.skillOffered} · Available: {sessionModalPeer.availability}
                    </p>
                  </div>

                  {/* Session Topic */}
                  <div className="form-group">
                    <label className="form-label" htmlFor="sess-topic">
                      Session Topic / Focus Area
                    </label>
                    <input
                      id="sess-topic"
                      type="text"
                      className="form-input"
                      value={sessionForm.topic}
                      onChange={(e) => setSessionForm({ ...sessionForm, topic: e.target.value })}
                      required
                    />
                  </div>

                  {/* Date & Time */}
                  <div className="form-group">
                    <label className="form-label" htmlFor="sess-time">
                      Proposed Date & Time Slot
                    </label>
                    <select
                      id="sess-time"
                      className="form-input"
                      value={sessionForm.dateTime}
                      onChange={(e) => setSessionForm({ ...sessionForm, dateTime: e.target.value })}
                    >
                      <option value="Tomorrow · 4:00 PM – 5:00 PM">Tomorrow · 4:00 PM – 5:00 PM</option>
                      <option value="Thursday · 5:30 PM – 6:30 PM">Thursday · 5:30 PM – 6:30 PM</option>
                      <option value="Friday · 5:00 PM – 6:00 PM">Friday · 5:00 PM – 6:00 PM</option>
                      <option value="Saturday Morning · 10:30 AM – 11:30 AM">Saturday Morning · 10:30 AM – 11:30 AM</option>
                      <option value="Sunday Afternoon · 3:00 PM – 4:00 PM">Sunday Afternoon · 3:00 PM – 4:00 PM</option>
                    </select>
                  </div>

                  {/* Session Mode */}
                  <div className="form-group">
                    <label className="form-label" htmlFor="sess-mode">
                      Meeting Mode
                    </label>
                    <select
                      id="sess-mode"
                      className="form-input"
                      value={sessionForm.mode}
                      onChange={(e) => setSessionForm({ ...sessionForm, mode: e.target.value })}
                    >
                      <option value="Google Meet">Google Meet (Online Video & Screen Share)</option>
                      <option value="Campus Central Library">Campus Central Library (Study Room Table 2)</option>
                      <option value="CS Department Lab">CS Department Lab (Workstation 14)</option>
                      <option value="Hostel Common Room">Hostel Common Study Lounge</option>
                    </select>
                  </div>

                  {/* Notes */}
                  <div className="form-group">
                    <label className="form-label" htmlFor="sess-notes">
                      Agenda or Specific Questions
                    </label>
                    <textarea
                      id="sess-notes"
                      rows={3}
                      className="form-input"
                      value={sessionForm.notes}
                      onChange={(e) => setSessionForm({ ...sessionForm, notes: e.target.value })}
                      placeholder="List specific assignment problems or topics you'd like to cover..."
                    />
                  </div>
                </div>

                <div className="modal-footer" style={{ flexShrink: 0 }}>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => setSessionModalPeer(null)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    <Calendar size={15} />
                    <span>Send Request</span>
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* Real Match Found Handshake Popup */}
      {matchPopupData && (
        <MatchFoundAnimation
          mode="modal"
          isOpen={!!matchPopupData}
          onClose={() => setMatchPopupData(null)}
          teacherName={matchPopupData.teacherName}
          learnerName={matchPopupData.learnerName}
          teacherSkill={matchPopupData.teacherSkill}
          learnerSkill={matchPopupData.learnerSkill}
          score={matchPopupData.score}
          isRequestPending={matchPopupData.isRequestPending}
        />
      )}
    </div>
  );
};

export default Matches;
