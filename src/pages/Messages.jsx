import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
  MessageSquare,
  Search,
  Send,
  Calendar,
  Check,
  CheckCheck,
  User,
  Sparkles,
  ArrowLeft,
  Clock,
  ExternalLink,
  ChevronRight,
  BookOpen,
  GraduationCap,
  Plus,
  X
} from 'lucide-react';
import { useAuth } from '../utils/auth.js';
import api, { normalizeStudentId } from '../utils/api.js';
import { resetScrollToTop } from '../utils/useScrollToTop.js';
import AnimeIdChip from '../components/AnimeIdChip.jsx';
import { getConversationCourseIds } from '../utils/idEngine.js';
import './Messages.css';
import './NewMessageModal.css';

const Messages = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, conversations, refreshConversations } = useAuth();
  const shouldReduceMotion = useReducedMotion();

  const studentId = user?.StudentID || user?.studentId || user?.id;

  // Active Selected Conversation State
  const [activePeerId, setActivePeerId] = useState(null);
  const [selectedPeerName, setSelectedPeerName] = useState(null);
  const [currentThread, setCurrentThread] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [messageInput, setMessageInput] = useState('');
  const [isMobileChatActive, setIsMobileChatActive] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  // New Message Modal State
  const [isNewMessageOpen, setIsNewMessageOpen] = useState(false);
  const [newMsgSearch, setNewMsgSearch] = useState('');
  const [studentsList, setStudentsList] = useState([]);
  const [loadingStudents, setLoadingStudents] = useState(false);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 2500);
  };

  const chatStreamRef = useRef(null);
  const prevMsgCountRef = useRef(0);

  // Scroll ONLY the inner chat stream container to bottom, never the page
  const scrollToBottom = () => {
    if (chatStreamRef.current) {
      chatStreamRef.current.scrollTop = chatStreamRef.current.scrollHeight;
    }
  };

  // Fetch thread for a specific peer
  const fetchThread = useCallback(async (peerId, shouldScroll = false) => {
    if (!studentId || !peerId) return;
    try {
      const thread = await api.messages.getConversation(studentId, peerId);
      if (thread) {
        setCurrentThread(thread);
        if (shouldScroll) {
          setTimeout(scrollToBottom, 50);
        }
      }
    } catch (err) {
      console.warn('Failed to fetch thread:', err);
    }
  }, [studentId]);

  // Sync with search parameter if provided (?peer=<id>, ?peerId=<id>, ?user=<id>)
  useEffect(() => {
    const rawTarget = searchParams.get('peer') || searchParams.get('peerId') || searchParams.get('user');
    if (rawTarget) {
      const normalizedTarget = normalizeStudentId(rawTarget);
      const isIdTarget = typeof normalizedTarget === 'number' || (typeof normalizedTarget === 'string' && /^\d+$/.test(normalizedTarget));
      const targetPeerId = isIdTarget ? Number(normalizedTarget) : null;

      if (targetPeerId && targetPeerId !== Number(studentId)) {
        const match = (conversations || []).find(
          (c) => Number(c.peerId) === targetPeerId
        );
        if (match) {
          setActivePeerId(match.peerId);
          setSelectedPeerName(match.peerName);
          fetchThread(match.peerId, true);
          if (studentId) {
            api.messages.markAsRead(studentId, match.peerId)
              .then(() => {
                if (refreshConversations) refreshConversations();
              })
              .catch(() => {});
          }
        } else {
          // Peer not in existing conversation list yet - look up peer by ID from backend
          api.students.getById(targetPeerId).then((peer) => {
            if (peer) {
              const pid = Number(peer.id || peer.StudentID);
              const pname = peer.name || peer.Name;
              setActivePeerId(pid);
              setSelectedPeerName(pname);
              fetchThread(pid, true);
            }
          }).catch((err) => {
            console.warn('Could not load peer:', err);
          });
        }
        setIsMobileChatActive(true);
      }
    } else if ((conversations || []).length > 0 && !activePeerId) {
      const first = conversations[0];
      setActivePeerId(first.peerId);
      setSelectedPeerName(first.peerName);
      fetchThread(first.peerId, true);
    }
  }, [searchParams, conversations, activePeerId, studentId, fetchThread, refreshConversations]);

  // Polling: refresh the open thread every 3.5 seconds
  useEffect(() => {
    if (!studentId || !activePeerId) return;
    const interval = setInterval(() => {
      fetchThread(activePeerId, false);
    }, 3500);
    return () => clearInterval(interval);
  }, [studentId, activePeerId, fetchThread]);

  // Refresh thread & conversations on window focus
  useEffect(() => {
    const handleFocus = () => {
      if (activePeerId) {
        fetchThread(activePeerId, false);
      }
      if (refreshConversations) {
        refreshConversations();
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [activePeerId, fetchThread, refreshConversations]);

  // Auto-scroll when new messages arrive
  useEffect(() => {
    const msgCount = currentThread?.messages?.length || 0;
    if (msgCount > prevMsgCountRef.current) {
      scrollToBottom();
    }
    prevMsgCountRef.current = msgCount;
  }, [currentThread?.messages?.length]);

  useEffect(() => {
    // Ensure outer page stays firmly at top
    resetScrollToTop();
  }, [selectedPeerName]);

  // Filter conversations for the sidebar
  const filteredConversations = (conversations || []).filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (c.peerName || '').toLowerCase().includes(q) ||
      (c.skillContext || '').toLowerCase().includes(q) ||
      (c.peerDept || '').toLowerCase().includes(q)
    );
  });

  // Current active conversation object
  const activeConversation = (currentThread && Number(currentThread.peerId) === Number(activePeerId))
    ? currentThread
    : (conversations || []).find((c) => Number(c.peerId) === Number(activePeerId))
    || (selectedPeerName ? {
        id: `conv-${activePeerId}`,
        peerId: Number(activePeerId),
        peerName: selectedPeerName,
        messages: [],
        unreadCount: 0,
        onlineStatus: 'offline'
      } : null);

  // Handle selecting a conversation from the sidebar
  const handleSelectConversation = (peerId, peerName) => {
    setActivePeerId(peerId);
    setSelectedPeerName(peerName);
    navigate(`/messages?peer=${peerId}`);
    fetchThread(peerId, true);
    if (studentId && peerId) {
      api.messages.markAsRead(studentId, peerId)
        .then(() => {
          if (refreshConversations) refreshConversations();
        })
        .catch(() => {});
    }
    setIsMobileChatActive(true);
  };

  // Handle open New Message modal
  const handleOpenNewMessageModal = async () => {
    setIsNewMessageOpen(true);
    setNewMsgSearch('');
    setLoadingStudents(true);
    try {
      const data = await api.students.getAll();
      if (Array.isArray(data)) {
        setStudentsList(data);
      }
    } catch (err) {
      console.warn('Failed to load students for new message:', err);
    } finally {
      setLoadingStudents(false);
    }
  };

  // Handle student selected from New Message modal
  const handlePickStudent = (st) => {
    const pId = Number(st.id || st.StudentID);
    const pName = st.name || st.Name;
    setIsNewMessageOpen(false);
    setActivePeerId(pId);
    setSelectedPeerName(pName);
    navigate(`/messages?peer=${pId}`);
    fetchThread(pId, true);
    setIsMobileChatActive(true);
  };

  // Filter students for New Message modal (exclude current user, search by name, department, or skill)
  const filteredStudents = studentsList.filter((s) => {
    const sId = Number(s.id || s.StudentID);
    if (sId === Number(studentId)) return false;
    if (!newMsgSearch.trim()) return true;
    const q = newMsgSearch.toLowerCase();
    const name = (s.name || s.Name || '').toLowerCase();
    const dept = (s.department || s.Department || '').toLowerCase();
    const skills = typeof s.skills === 'string'
      ? s.skills.toLowerCase()
      : Array.isArray(s.skillsOffered)
        ? s.skillsOffered.map((sk) => typeof sk === 'string' ? sk : sk.name || sk.SkillName || '').join(' ').toLowerCase()
        : '';
    return name.includes(q) || dept.includes(q) || skills.includes(q);
  });

  // Handle sending a message
  const handleSendMessage = async (e) => {
    e?.preventDefault();
    if (!messageInput.trim() || !activePeerId || !studentId) return;

    const text = messageInput.trim();
    setMessageInput('');

    try {
      await api.messages.sendMessage({
        senderId: studentId,
        receiverId: activePeerId,
        body: text,
      });
      await fetchThread(activePeerId, true);
      if (refreshConversations) refreshConversations();
      showToast('Message sent.');
    } catch (err) {
      console.error('Failed to send message:', err);
      showToast('Failed to send message.');
    }
  };

  return (
    <div className="messages-page">
      <div className="container">
        {/* Floating Toast Notification */}
        {toastMessage && (
          <div className="app-toast-alert">
            <Check size={18} className="text-emerald-400" />
            <span>{toastMessage}</span>
          </div>
        )}

        <div className="messages-container-card">
          {/* ================================================================
              Left Pane: Conversations List
              ================================================================ */}
          <div
            className={`conversations-sidebar ${
              isMobileChatActive ? 'hidden-mobile' : ''
            }`}
          >
            <div className="conversations-sidebar-header">
              <div className="conversations-header-title">
                <div className="flex items-center gap-2">
                  <MessageSquare size={20} className="text-primary" />
                  <h2>Messages</h2>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn btn-primary new-message-btn"
                    onClick={handleOpenNewMessageModal}
                    title="Start a new message"
                  >
                    <Plus size={15} />
                    <span>New message</span>
                  </button>
                  <span className="conversations-count-badge">
                    {(conversations || []).length} Active
                  </span>
                </div>
              </div>

              <div className="conversations-search">
                <Search size={16} className="conv-search-icon" />
                <input
                  type="text"
                  placeholder="Search students, topics..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="conv-search-input"
                />
              </div>
            </div>

            <div className="conversations-list">
              {filteredConversations.length === 0 ? (
                <div className="conv-empty">
                  <MessageSquare size={28} className="text-muted mb-2" />
                  <p className="font-semibold text-sm">No conversations found</p>
                  <p className="text-xs text-muted">
                    {searchQuery
                      ? 'Try another search term'
                      : 'Use the "New message" button above to start a conversation with any student!'}
                  </p>
                </div>
              ) : (
                filteredConversations.map((conv) => {
                  const isSelected =
                    Number(conv.peerId) === Number(activePeerId) ||
                    conv.peerName?.toLowerCase() === (selectedPeerName || '').toLowerCase();
                  const lastMessage =
                    conv.messages && conv.messages.length > 0
                      ? conv.messages[conv.messages.length - 1]
                      : null;

                  return (
                    <div
                      key={conv.id || conv.peerId}
                      className={`conv-item ${isSelected ? 'active' : ''} ${
                        conv.unreadCount > 0 ? 'unread' : ''
                      }`}
                      onClick={() => handleSelectConversation(conv.peerId, conv.peerName)}
                    >
                      <div className="conv-avatar-wrapper">
                        <div
                          className={`conv-avatar ${
                            conv.avatarBg || 'avatar-indigo'
                          }`}
                        >
                          {conv.peerAvatar ||
                            (conv.peerName || 'ST')
                              .split(' ')
                              .map((n) => n[0])
                              .join('')
                              .slice(0, 2)}
                        </div>
                        <div
                          className={`conv-online-indicator ${
                            conv.onlineStatus === 'online'
                              ? 'online-green'
                              : 'online-offline'
                          }`}
                        ></div>
                      </div>

                      <div className="conv-content">
                        <div className="conv-top-line">
                          <span className="conv-peer-name">{conv.peerName}</span>
                          <span className="conv-time">
                            {lastMessage ? lastMessage.timestamp : conv.lastActive}
                          </span>
                        </div>

                        {conv.skillContext && (
                          <div className="conv-skill-tag" title={conv.skillContext}>
                            {conv.skillContext}
                          </div>
                        )}

                        <div className="flex items-center justify-between">
                          <p className="conv-snippet">
                            {lastMessage
                              ? `${lastMessage.isMine ? 'You: ' : ''}${lastMessage.text}`
                              : 'Start the conversation...'}
                          </p>
                          {conv.unreadCount > 0 && (
                            <span className="conv-unread-dot"></span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ================================================================
              Right Pane: Active Chat Room
              ================================================================ */}
          {activeConversation ? (
            <div
              className={`chat-room-container ${
                isMobileChatActive ? 'active-mobile' : ''
              }`}
            >
              {/* Chat Room Header */}
              <div className="chat-room-header">
                <div className="chat-peer-info">
                  <button
                    onClick={() => setIsMobileChatActive(false)}
                    className="chat-back-btn"
                    aria-label="Back to conversations"
                  >
                    <ArrowLeft size={18} />
                  </button>

                  <div
                    className={`conv-avatar ${
                      activeConversation.avatarBg || 'avatar-purple'
                    }`}
                    style={{ width: '40px', height: '40px' }}
                  >
                    {activeConversation.peerAvatar ||
                      (activeConversation.peerName || 'ST')
                        .split(' ')
                        .map((n) => n[0])
                        .join('')
                        .slice(0, 2)}
                  </div>

                  <div className="chat-peer-meta">
                    {(() => {
                      const courseInfo = getConversationCourseIds(
                        activeConversation.peerName || '',
                        activeConversation.skillContext || ''
                      );
                      return (
                        <>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3>{activeConversation.peerName}</h3>
                            <AnimeIdChip id={courseInfo.learningId} type="LRN" size="sm" />
                          </div>
                          <div className="chat-peer-sub">
                            <span>{activeConversation.peerDept || 'Campus Student'}</span>
                            <span>·</span>
                            {activeConversation.onlineStatus === 'online' ? (
                              <span className="text-emerald-600 font-semibold flex items-center gap-1">
                                <span
                                  style={{
                                    width: '6px',
                                    height: '6px',
                                    borderRadius: '50%',
                                    backgroundColor: '#16a34a'
                                  }}
                                ></span>
                                Online
                              </span>
                            ) : (
                              <span className="text-muted font-normal flex items-center gap-1">
                                <span
                                  style={{
                                    width: '6px',
                                    height: '6px',
                                    borderRadius: '50%',
                                    backgroundColor: '#9ca3af'
                                  }}
                                ></span>
                                Offline
                              </span>
                            )}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>

                <div className="chat-header-actions">
                  <Link
                    to={`/sessions`}
                    className="btn btn-primary"
                    style={{ padding: '0.45rem 0.85rem' }}
                  >
                    <Calendar size={15} />
                    <span>Schedule Session</span>
                  </Link>

                  <Link
                    to={`/matches?skill=${encodeURIComponent(
                      activeConversation.peerName || ''
                    )}`}
                    className="btn btn-outline"
                    style={{ padding: '0.45rem 0.75rem' }}
                    title="View Peer Matches & Details"
                  >
                    <span>View Match</span>
                  </Link>
                </div>
              </div>

              {/* Messages Stream */}
              <div className="chat-messages-stream" ref={chatStreamRef}>
                <div className="chat-date-separator">
                  <span>Knowledge Exchange Chat</span>
                </div>

                {activeConversation.skillContext && (
                  <div className="chat-study-context-banner flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <Sparkles size={16} className="text-indigo-600 flex-shrink-0" />
                      <span>
                        <strong>Study Context:</strong> {activeConversation.skillContext}
                      </span>
                    </div>
                    {(() => {
                      const courseInfo = getConversationCourseIds(
                        activeConversation.peerName || '',
                        activeConversation.skillContext || ''
                      );
                      return (
                        <AnimeIdChip id={courseInfo.teachingId} type="TCR" size="sm" />
                      );
                    })()}
                  </div>
                )}

                {/* Message Speech Bubbles or Empty State */}
                {(!activeConversation.messages || activeConversation.messages.length === 0) ? (
                  <div className="new-chat-empty-thread">
                    <div className="new-chat-empty-icon">
                      <MessageSquare size={36} />
                    </div>
                    <p className="new-chat-empty-title">Say hello to {activeConversation.peerName || 'student'}</p>
                    <p className="new-chat-empty-desc">Send a message to start sharing skills and collaborating.</p>
                  </div>
                ) : (
                  activeConversation.messages.map((msg) => (
                    <motion.div
                      key={msg.id || msg.messageId}
                      className={`message-row ${
                        msg.isMine ? 'outgoing' : 'incoming'
                      }`}
                      initial={shouldReduceMotion ? { opacity: 0 } : { scale: 0.88, opacity: 0, y: 10 }}
                      animate={shouldReduceMotion ? { opacity: 1 } : { scale: 1, opacity: 1, y: 0 }}
                      transition={
                        shouldReduceMotion
                          ? { duration: 0.1 }
                          : { type: 'spring', stiffness: 480, damping: 24 }
                      }
                    >
                      {!msg.isMine && (
                        <div className="message-avatar-small">
                          {activeConversation.peerAvatar || 'P'}
                        </div>
                      )}

                      <div>
                        <div className="message-bubble">{msg.text}</div>
                        <div className="message-meta">
                          <span>{msg.timestamp}</span>
                          {msg.isMine && (
                            <CheckCheck size={13} className="text-indigo-200" />
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))
                )}

                <div style={{ height: '1px' }} />
              </div>

              {/* Bottom Input Form - Always visible when chat is open */}
              <form onSubmit={handleSendMessage} className="chat-input-bar">
                <input
                  type="text"
                  placeholder={`Type a message to ${activeConversation.peerName || 'peer'}... (Press Enter to send)`}
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  className="chat-input-field"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={!messageInput.trim()}
                  className="chat-send-btn"
                  aria-label="Send message"
                >
                  <Send size={18} />
                </button>
              </form>
            </div>
          ) : (
            <div className="chat-empty-state">
              <div className="chat-empty-icon">
                <MessageSquare size={32} />
              </div>
              <h3>Select a Conversation</h3>
              <p>
                Choose a student from the sidebar or click "New message" to start exchanging knowledge.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* New Message Student Selector Modal */}
      {isNewMessageOpen && (
        <div className="new-message-modal-overlay" onClick={() => setIsNewMessageOpen(false)}>
          <div className="new-message-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="new-message-modal-header">
              <h3>New message</h3>
              <button
                type="button"
                className="new-message-close-btn"
                onClick={() => setIsNewMessageOpen(false)}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            <div className="new-message-search-box">
              <Search size={16} className="text-muted" />
              <input
                type="text"
                placeholder="Search student by name, department, or skill..."
                value={newMsgSearch}
                onChange={(e) => setNewMsgSearch(e.target.value)}
                className="new-message-search-input"
                autoFocus
              />
            </div>

            <div className="new-message-student-list">
              {loadingStudents ? (
                <div className="new-message-empty-state">Loading students...</div>
              ) : filteredStudents.length === 0 ? (
                <div className="new-message-empty-state">
                  No students found {newMsgSearch ? `matching "${newMsgSearch}"` : ''}
                </div>
              ) : (
                filteredStudents.map((st) => {
                  const stId = Number(st.id || st.StudentID);
                  const stName = st.name || st.Name;
                  const stDept = [st.department || st.Department, st.year || st.YearOfStudy].filter(Boolean).join(' • ');
                  const stAvatar = st.avatar || st.Avatar || (stName || 'ST').split(' ').map((n) => n[0]).join('').slice(0, 2);
                  const stBg = st.avatarBg || 'avatar-indigo';
                  const stSkills = st.skills || (Array.isArray(st.skillsOffered) ? st.skillsOffered.join(', ') : '');

                  return (
                    <div
                      key={stId}
                      className="new-message-student-item"
                      onClick={() => handlePickStudent(st)}
                    >
                      <div className="new-message-student-left">
                        <div className={`conv-avatar ${stBg}`} style={{ width: '38px', height: '38px', fontSize: '0.85rem' }}>
                          {stAvatar}
                        </div>
                        <div className="new-message-student-info">
                          <div className="new-message-student-name">
                            <span>{stName}</span>
                            {st.isOnline && (
                              <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#16a34a', display: 'inline-block' }} />
                            )}
                          </div>
                          <div className="new-message-student-dept">{stDept || 'Campus Student'}</div>
                          {stSkills && (
                            <div className="new-message-student-skills" title={stSkills}>
                              Offers: {stSkills}
                            </div>
                          )}
                        </div>
                      </div>
                      <ChevronRight size={18} className="text-muted" />
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Messages;
