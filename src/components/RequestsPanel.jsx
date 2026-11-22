import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ArrowRightLeft,
  Inbox,
  Send,
  CheckCircle2,
  XCircle,
  Clock,
  Ban,
  Check,
  X,
  FileText
} from 'lucide-react';
import { useAuth } from '../utils/auth.js';
import api from '../utils/api.js';
import './RequestsPanel.css';

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T'));
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch {
    return dateStr;
  }
}

function getAvatarInitials(name, fallback = 'ST') {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function StatusBadge({ status }) {
  const s = String(status || 'Pending').toLowerCase();

  if (s === 'accepted') {
    return (
      <span className="req-status-badge req-status-accepted">
        <CheckCircle2 size={13} />
        <span>Accepted</span>
      </span>
    );
  }
  if (s === 'rejected') {
    return (
      <span className="req-status-badge req-status-rejected">
        <XCircle size={13} />
        <span>Rejected</span>
      </span>
    );
  }
  if (s === 'cancelled') {
    return (
      <span className="req-status-badge req-status-cancelled">
        <Ban size={13} />
        <span>Cancelled</span>
      </span>
    );
  }
  if (s === 'completed') {
    return (
      <span className="req-status-badge req-status-completed">
        <CheckCircle2 size={13} />
        <span>Completed</span>
      </span>
    );
  }
  return (
    <span className="req-status-badge req-status-pending">
      <Clock size={13} />
      <span>Pending</span>
    </span>
  );
}

const RequestsPanel = ({ showToast, onRefreshMatches }) => {
  const { user } = useAuth();
  const [exchanges, setExchanges] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'incoming' | 'my'
  const [actionLoadingId, setActionLoadingId] = useState(null);

  const studentId = user?.id || user?.StudentID || user?.studentId;

  const fetchExchanges = useCallback(async () => {
    if (!studentId) return;
    try {
      const data = await api.exchanges.getByStudent(studentId);
      if (Array.isArray(data)) {
        setExchanges(data);
      }
    } catch (err) {
      console.warn('Failed to fetch exchanges:', err);
    }
  }, [studentId]);

  useEffect(() => {
    if (!studentId) return;
    setLoading(true);
    fetchExchanges().finally(() => setLoading(false));

    // Refresh every 10 seconds
    const interval = setInterval(fetchExchanges, 10000);

    const handleFocus = () => {
      fetchExchanges();
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [studentId, fetchExchanges]);

  const { incomingRequests, myRequests } = useMemo(() => {
    const incoming = [];
    const my = [];
    const sorted = [...(exchanges || [])].sort((a, b) => {
      const dateA = new Date(a.RequestDate || a.requestDate || 0).getTime();
      const dateB = new Date(b.RequestDate || b.requestDate || 0).getTime();
      if (dateB !== dateA) return dateB - dateA;
      return Number(b.ExchangeID || b.id || 0) - Number(a.ExchangeID || a.id || 0);
    });
    sorted.forEach((ex) => {
      const tId = Number(ex.teacherId ?? ex.TeacherID);
      const lId = Number(ex.learnerId ?? ex.LearnerID);
      const curId = Number(studentId);

      if (tId === curId) {
        incoming.push(ex);
      } else if (lId === curId) {
        my.push(ex);
      }
    });
    return { incomingRequests: incoming, myRequests: my };
  }, [exchanges, studentId]);

  const handleStatusChange = async (exchangeId, newStatus) => {
    if (!studentId || actionLoadingId) return;
    setActionLoadingId(exchangeId);
    try {
      await api.exchanges.updateStatus(exchangeId, newStatus, { studentId });

      // Re-fetch to update state without page reload
      await fetchExchanges();
      if (onRefreshMatches) {
        onRefreshMatches();
      }
      window.dispatchEvent(new Event('4s_request_change'));
      window.dispatchEvent(new Event('4s_exchange_change'));

      const statusLabels = {
        Accepted: 'Exchange request accepted! Track it on Sessions and Dashboard.',
        Rejected: 'Exchange request declined.',
        Cancelled: 'Exchange request cancelled.'
      };
      if (showToast) {
        showToast(statusLabels[newStatus] || `Request updated to ${newStatus}`);
      }
    } catch (err) {
      console.error('Failed to update exchange status:', err);
      if (showToast) {
        showToast(err?.message || 'Failed to update request status', true);
      }
    } finally {
      setActionLoadingId(null);
    }
  };

  const renderCard = (ex, role) => {
    const exId = ex.ExchangeID || ex.id;
    const isTeacher = role === 'incoming';
    const partnerName = isTeacher
      ? (ex.LearnerName || ex.learnerName || 'Student Learner')
      : (ex.TeacherName || ex.teacherName || 'Student Mentor');
    const partnerAvatar = isTeacher
      ? (ex.LearnerAvatar || ex.learnerAvatar || getAvatarInitials(partnerName))
      : (ex.TeacherAvatar || ex.teacherAvatar || getAvatarInitials(partnerName));
    const skillName = ex.SkillName || ex.skillName || 'Skill Exchange';
    const note = ex.Note || ex.note;
    const dateFormatted = formatDate(ex.RequestDate || ex.requestDate);
    const status = ex.Status || ex.status || 'Pending';
    const isPending = status === 'Pending';
    const isAccepted = status === 'Accepted';
    const isActionLoading = actionLoadingId === exId;

    return (
      <div key={exId} className="req-card">
        <div className="req-card-header">
          <div className="req-partner-info">
            <div className={`req-avatar ${isTeacher ? 'req-avatar-learner' : 'req-avatar-teacher'}`}>
              {partnerAvatar}
            </div>
            <div className="req-partner-meta">
              <span className="req-partner-role-tag">
                {isTeacher ? 'Learner (Requested You)' : 'Teacher (Your Mentor)'}
              </span>
              <h4 className="req-partner-name">{partnerName}</h4>
            </div>
          </div>
          <StatusBadge status={status} />
        </div>

        <div className="req-card-body">
          <div className="req-skill-row">
            <span className="req-skill-label">Skill:</span>
            <span className="req-skill-pill">{skillName}</span>
          </div>

          {note && (
            <div className="req-note-box">
              <FileText size={14} className="req-note-icon" />
              <p className="req-note-text">“{note}”</p>
            </div>
          )}

          <div className="req-date-row">
            <Clock size={12} className="text-muted" />
            <span>Requested on {dateFormatted}</span>
          </div>
        </div>

        <div className="req-card-footer">
          {/* Incoming + Pending: Accept and Reject buttons */}
          {isTeacher && isPending && (
            <div className="req-actions-group">
              <button
                type="button"
                className="btn btn-sm btn-primary req-btn-accept"
                disabled={isActionLoading}
                onClick={() => handleStatusChange(exId, 'Accepted')}
              >
                <Check size={14} />
                <span>{isActionLoading ? 'Saving...' : 'Accept'}</span>
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline req-btn-reject"
                disabled={isActionLoading}
                onClick={() => handleStatusChange(exId, 'Rejected')}
              >
                <X size={14} />
                <span>Reject</span>
              </button>
            </div>
          )}

          {/* My requests + Pending: Cancel button */}
          {!isTeacher && isPending && (
            <div className="req-actions-group">
              <button
                type="button"
                className="btn btn-sm btn-outline req-btn-cancel"
                disabled={isActionLoading}
                onClick={() => handleStatusChange(exId, 'Cancelled')}
              >
                <Ban size={14} />
                <span>{isActionLoading ? 'Cancelling...' : 'Cancel Request'}</span>
              </button>
            </div>
          )}

          {/* Accepted state display */}
          {isAccepted && (
            <div className="req-accepted-notice">
              <span className="req-accepted-label">Accepted</span>
              <span className="req-accepted-subtext">Session scheduling will unlock in Sessions tab</span>
            </div>
          )}

          {/* Other terminal statuses */}
          {!isPending && !isAccepted && (
            <div className="req-terminal-status">
              <span className="req-terminal-text">Status: {status}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  const totalCount = (incomingRequests.length + myRequests.length);

  return (
    <section id="requests" className="requests-section" aria-label="Skill Exchange Requests">
      <div className="requests-section-header">
        <div className="requests-title-group">
          <div className="requests-icon-badge">
            <ArrowRightLeft size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="requests-main-title">Skill Exchange Requests</h2>
              {totalCount > 0 && (
                <span className="requests-total-pill">{totalCount} total</span>
              )}
            </div>
            <p className="requests-subtitle">
              Manage incoming teaching proposals from peers and monitor requests you submitted.
            </p>
          </div>
        </div>

        {/* Tab Filter Controls */}
        <div className="requests-tabs-bar">
          <button
            type="button"
            className={`requests-tab-btn ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            <span>All</span>
            <span className="requests-tab-count">{totalCount}</span>
          </button>
          <button
            type="button"
            className={`requests-tab-btn ${activeTab === 'incoming' ? 'active' : ''}`}
            onClick={() => setActiveTab('incoming')}
          >
            <Inbox size={14} />
            <span>Incoming</span>
            <span className="requests-tab-count">{incomingRequests.length}</span>
          </button>
          <button
            type="button"
            className={`requests-tab-btn ${activeTab === 'my' ? 'active' : ''}`}
            onClick={() => setActiveTab('my')}
          >
            <Send size={14} />
            <span>My Requests</span>
            <span className="requests-tab-count">{myRequests.length}</span>
          </button>
        </div>
      </div>

      {loading && exchanges.length === 0 ? (
        <div className="requests-empty-card">
          <div className="requests-loading-spinner" />
          <p className="text-sm text-muted">Loading exchange requests...</p>
        </div>
      ) : totalCount === 0 ? (
        <div className="requests-empty-card">
          <div className="requests-empty-icon-wrap">
            <ArrowRightLeft size={28} />
          </div>
          <h3 className="requests-empty-title">No Skill Exchange Requests Yet</h3>
          <p className="requests-empty-desc">
            When peers request to learn skills from you or when you request to learn from student mentors, they will show up here.
          </p>
        </div>
      ) : (
        <div className="requests-groups-container">
          {/* GROUP 1: INCOMING REQUESTS (I am the teacher) */}
          {(activeTab === 'all' || activeTab === 'incoming') && (
            <div className="requests-group">
              <div className="requests-group-header">
                <div className="requests-group-title-row">
                  <Inbox size={18} className="text-primary" />
                  <h3 className="requests-group-title">Incoming Requests</h3>
                  <span className="requests-subgroup-pill">
                    {incomingRequests.length} {incomingRequests.length === 1 ? 'request' : 'requests'}
                  </span>
                </div>
                <span className="requests-group-caption">You are the teacher for these exchanges</span>
              </div>

              {incomingRequests.length === 0 ? (
                <div className="requests-subgroup-empty">
                  <span>No incoming requests right now.</span>
                </div>
              ) : (
                <div className="requests-cards-grid">
                  {incomingRequests.map((ex) => renderCard(ex, 'incoming'))}
                </div>
              )}
            </div>
          )}

          {/* GROUP 2: MY REQUESTS (I am the learner) */}
          {(activeTab === 'all' || activeTab === 'my') && (
            <div className="requests-group">
              <div className="requests-group-header">
                <div className="requests-group-title-row">
                  <Send size={18} className="text-secondary" />
                  <h3 className="requests-group-title">My Requests</h3>
                  <span className="requests-subgroup-pill">
                    {myRequests.length} {myRequests.length === 1 ? 'request' : 'requests'}
                  </span>
                </div>
                <span className="requests-group-caption">You are the learner for these exchanges</span>
              </div>

              {myRequests.length === 0 ? (
                <div className="requests-subgroup-empty">
                  <span>You have not sent any exchange requests yet.</span>
                </div>
              ) : (
                <div className="requests-cards-grid">
                  {myRequests.map((ex) => renderCard(ex, 'my'))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default RequestsPanel;
