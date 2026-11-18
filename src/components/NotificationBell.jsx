import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  MessageSquare,
  Calendar,
  Users,
  Star,
  Sparkles,
  CheckCheck,
  CheckCircle2
} from 'lucide-react';
import { useAuth, isUserLoggedIn } from '../utils/auth.js';
import api from '../utils/api.js';
import './NotificationBell.css';

function formatTimeAgo(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T'));
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);
  if (isNaN(diffSec) || diffSec < 0) return 'Just now';
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function getNotificationIcon(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'message') {
    return <MessageSquare size={16} className="notif-type-icon notif-icon-blue" />;
  }
  if (t === 'session') {
    return <Calendar size={16} className="notif-type-icon notif-icon-amber" />;
  }
  if (t === 'badge') {
    return <Sparkles size={16} className="notif-type-icon notif-icon-pink" />;
  }
  if (t === 'review' || t === 'feedback') {
    return <Star size={16} className="notif-type-icon notif-icon-gold" />;
  }
  return <Users size={16} className="notif-type-icon notif-icon-purple" />;
}

const NotificationBell = () => {
  const { user, loggedIn } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const bellContainerRef = useRef(null);

  const studentId = user?.id || user?.StudentID || user?.studentId;

  const fetchUnreadCount = useCallback(async () => {
    if (!loggedIn || !studentId) return;
    try {
      const res = await api.notifications.getUnreadCount(studentId);
      if (res && typeof res.count === 'number') {
        setUnreadCount(res.count);
      } else if (res && typeof res.unreadCount === 'number') {
        setUnreadCount(res.unreadCount);
      }
    } catch {
      // Fallback silently if offline or request fails
    }
  }, [loggedIn, studentId]);

  const fetchNotificationsList = useCallback(async () => {
    if (!loggedIn || !studentId) return;
    try {
      setLoading(true);
      const [listRes, countRes] = await Promise.all([
        api.notifications.getByStudent(studentId),
        api.notifications.getUnreadCount(studentId).catch(() => ({ count: 0 })),
      ]);
      if (Array.isArray(listRes)) {
        setNotifications(listRes);
      }
      if (countRes && typeof countRes.count === 'number') {
        setUnreadCount(countRes.count);
      }
    } catch (err) {
      console.warn('Failed to load notifications list:', err);
    } finally {
      setLoading(false);
    }
  }, [loggedIn, studentId]);

  // Initial load and polling every 10 seconds + window focus
  useEffect(() => {
    if (!loggedIn || !studentId) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }

    fetchUnreadCount();

    const intervalId = setInterval(() => {
      if (!isUserLoggedIn()) return;
      fetchUnreadCount();
      if (isOpen) {
        fetchNotificationsList();
      }
    }, 10000);

    const handleFocus = () => {
      if (!isUserLoggedIn()) return;
      fetchUnreadCount();
      if (isOpen) {
        fetchNotificationsList();
      }
    };

    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
    };
  }, [loggedIn, studentId, fetchUnreadCount, fetchNotificationsList, isOpen]);

  // Handle click outside and Escape key to close
  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (e) => {
      if (bellContainerRef.current && !bellContainerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleToggle = () => {
    const nextState = !isOpen;
    setIsOpen(nextState);
    if (nextState) {
      fetchNotificationsList();
    }
  };

  const handleNotificationClick = async (notif) => {
    const notifId = notif.NotificationID || notif.id;
    const isUnread = !(notif.IsRead || notif.isRead);

    if (isUnread && notifId) {
      try {
        await api.notifications.markAsRead(notifId);
        setNotifications((prev) =>
          prev.map((n) =>
            (n.NotificationID || n.id) === notifId ? { ...n, IsRead: 1, isRead: 1 } : n
          )
        );
        setUnreadCount((c) => Math.max(0, c - 1));
      } catch (err) {
        console.warn('Failed to mark notification read:', err);
      }
    }

    setIsOpen(false);

    // Determine target link:
    // /matches for requests (with #requests hash)
    // /messages for messages
    // /sessions for sessions
    // /profile for reviews and badges
    let targetLink = notif.Link || notif.link || '/';
    const type = String(notif.Type || notif.type || '').toLowerCase();

    if (targetLink.startsWith('/matches') || type === 'match' || type === 'exchange') {
      targetLink = '/matches#requests';
    } else if (targetLink.startsWith('/feedback') || targetLink.startsWith('/achievements') || type === 'review' || type === 'badge') {
      targetLink = '/profile';
    } else if (targetLink.startsWith('/messages') || type === 'message') {
      targetLink = '/messages';
    } else if (targetLink.startsWith('/sessions') || type === 'session') {
      targetLink = '/sessions';
    }

    navigate(targetLink);
  };

  const handleMarkAllRead = async (e) => {
    e.stopPropagation();
    if (!studentId || unreadCount === 0) return;
    try {
      await api.notifications.markAllAsRead(studentId);
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, IsRead: 1, isRead: 1 }))
      );
      setUnreadCount(0);
    } catch (err) {
      console.warn('Failed to mark all notifications as read:', err);
    }
  };

  if (!loggedIn) return null;

  return (
    <div className="notif-bell-container" ref={bellContainerRef}>
      <button
        type="button"
        className={`navbar-icon-btn notif-bell-btn ${isOpen ? 'active' : ''}`}
        onClick={handleToggle}
        aria-label={`Notifications (${unreadCount} unread)`}
        aria-expanded={isOpen}
        title="Notifications"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="notif-unread-badge" aria-label={`${unreadCount} unread`}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="notif-dropdown-panel" role="region" aria-label="Notifications Dropdown">
          {/* Header */}
          <div className="notif-dropdown-header">
            <div className="notif-header-title-row">
              <span className="notif-header-title">Notifications</span>
              {unreadCount > 0 && (
                <span className="notif-unread-pill">{unreadCount} new</span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                className="notif-mark-all-btn"
                onClick={handleMarkAllRead}
                title="Mark all notifications as read"
              >
                <CheckCheck size={14} />
                <span>Mark all read</span>
              </button>
            )}
          </div>

          {/* List or Empty State */}
          <div className="notif-dropdown-list">
            {notifications.length === 0 ? (
              <div className="notif-empty-state">
                <div className="notif-empty-icon-wrap">
                  <CheckCircle2 size={28} className="notif-empty-icon" />
                </div>
                <p className="notif-empty-text">No notifications yet</p>
                <span className="notif-empty-subtext">You are all caught up!</span>
              </div>
            ) : (
              notifications.map((notif) => {
                const notifId = notif.NotificationID || notif.id;
                const isUnread = !(notif.IsRead || notif.isRead);
                const timeAgo = formatTimeAgo(notif.CreatedAt || notif.createdAt);

                return (
                  <div
                    key={notifId}
                    className={`notif-item ${isUnread ? 'unread' : 'read'}`}
                    onClick={() => handleNotificationClick(notif)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleNotificationClick(notif);
                      }
                    }}
                  >
                    <div className="notif-item-icon-box">
                      {getNotificationIcon(notif.Type || notif.type)}
                    </div>
                    <div className="notif-item-body">
                      <div className="notif-item-top">
                        <span className="notif-item-title">{notif.Title || notif.title}</span>
                        {isUnread && <span className="notif-unread-dot" aria-hidden="true" />}
                      </div>
                      <p className="notif-item-message">{notif.Message || notif.message}</p>
                      <span className="notif-item-time">{timeAgo}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
