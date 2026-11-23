import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Star,
  X,
  AlertCircle,
  CheckCircle2,
  GraduationCap,
  BookOpen
} from 'lucide-react';
import { useAuth } from '../utils/auth.js';
import api, { normalizeStudentId } from '../utils/api.js';
import './ReviewModal.css';
import '../pages/RatingsFeedback.css';

export default function ReviewModal({
  isOpen,
  onClose,
  preselectedExchangeId = null,
  preselectedSessionId = null,
  preselectedRole = null,
  onReviewSubmitted = null
}) {
  const { user } = useAuth();
  const shouldReduceMotion = useReducedMotion();

  const [formAuthorRole, setFormAuthorRole] = useState(preselectedRole || 'Learner');
  const [reviewableList, setReviewableList] = useState([]);
  const [selectedExchangeId, setSelectedExchangeId] = useState('');
  const [formRating, setFormRating] = useState(0); // Stars start unselected
  const [formHoverRating, setFormHoverRating] = useState(0);
  const [formComment, setFormComment] = useState('');
  const [formError, setFormError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);
  const [sparkleRatingTrigger, setSparkleRatingTrigger] = useState(null);

  const currentStudentId = normalizeStudentId(user?.StudentID || user?.studentId || user?.id);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  // Lock body scroll and handle Escape key
  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Fetch reviewable completed items
  const fetchReviewable = useCallback(async () => {
    if (!currentStudentId) return;
    try {
      const data = await api.feedback.getReviewable(currentStudentId).catch(() => []);
      if (Array.isArray(data)) {
        setReviewableList(data);
      }
    } catch (err) {
      console.warn('Failed to fetch reviewable items:', err);
    }
  }, [currentStudentId]);

  useEffect(() => {
    if (isOpen) {
      setFormRating(0);
      setFormHoverRating(0);
      setFormComment('');
      setFormError('');
      setSparkleRatingTrigger(null);
      fetchReviewable();
    }
  }, [isOpen, fetchReviewable]);

  // Set initial role & selection based on props or available items
  useEffect(() => {
    if (!isOpen) return;
    if (preselectedRole) {
      setFormAuthorRole(preselectedRole);
    }
  }, [isOpen, preselectedRole]);

  // Eligible items for the selected role
  const eligibleItems = useMemo(() => {
    return reviewableList.filter((item) => item.role === formAuthorRole);
  }, [reviewableList, formAuthorRole]);

  useEffect(() => {
    if (!isOpen) return;
    if (preselectedExchangeId) {
      const targetStr = String(preselectedExchangeId);
      const match = reviewableList.find((it) => String(it.exchangeId) === targetStr);
      if (match) {
        setFormAuthorRole(match.role);
        setSelectedExchangeId(targetStr);
        return;
      }
      setSelectedExchangeId(targetStr);
      return;
    }
    if (eligibleItems.length > 0) {
      setSelectedExchangeId(String(eligibleItems[0].exchangeId));
    } else {
      setSelectedExchangeId('');
    }
  }, [isOpen, eligibleItems, preselectedExchangeId, reviewableList]);

  const handleRoleChange = (role) => {
    setFormAuthorRole(role);
    setFormError('');
    const matches = reviewableList.filter((it) => it.role === role);
    if (matches.length > 0) {
      setSelectedExchangeId(String(matches[0].exchangeId));
    } else {
      setSelectedExchangeId('');
    }
  };

  const selectedItem = useMemo(() => {
    if (!selectedExchangeId) return null;
    return reviewableList.find((it) => String(it.exchangeId) === String(selectedExchangeId)) || null;
  }, [reviewableList, selectedExchangeId]);

  const handleSelectStar = (starVal) => {
    setFormRating(starVal);
    setSparkleRatingTrigger(starVal);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!selectedExchangeId || eligibleItems.length === 0) {
      const msg = 'Complete a session to leave a review.';
      setFormError(msg);
      showToast(msg);
      return;
    }

    if (!formRating || formRating < 1 || formRating > 5) {
      const msg = 'Please select a star rating between 1 and 5.';
      setFormError(msg);
      return;
    }

    if (!formComment.trim() || formComment.trim().length < 10) {
      const msg = 'Feedback comment must be at least 10 characters long.';
      setFormError(msg);
      return;
    }

    try {
      setIsLoading(true);
      await api.feedback.submit(selectedExchangeId, {
        givenBy: currentStudentId,
        rating: formRating,
        comments: formComment.trim(),
        clarityRating: formRating,
        patienceRating: formRating,
        punctualityRating: formRating,
        wouldRecommend: 1
      });

      showToast('Feedback submitted successfully! Your peer rating has been updated.');
      window.dispatchEvent(new Event('4s_reviews_change'));
      window.dispatchEvent(new Event('4s_badges_change'));
      window.dispatchEvent(new Event('4s_sessions_change'));

      if (onReviewSubmitted) onReviewSubmitted();
      setTimeout(() => {
        onClose();
      }, 400);
    } catch (err) {
      const msg = err?.data?.error || err?.message || 'Failed to submit feedback';
      const displayMsg = (err?.status === 409 || /unique|already/i.test(msg))
        ? 'You have already submitted a review for this exchange.'
        : msg;
      setFormError(displayMsg);
      showToast(displayMsg);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="review-modal-overlay" onClick={onClose}>
      {toastMessage && (
        <div className="app-toast-alert" style={{ zIndex: 10001 }}>
          <CheckCircle2 size={18} className="text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      <motion.div
        className="review-modal-card"
        onClick={(e) => e.stopPropagation()}
        initial={shouldReduceMotion ? { opacity: 0 } : { scale: 0.94, opacity: 0 }}
        animate={shouldReduceMotion ? { opacity: 1 } : { scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 450, damping: 24 }}
      >
        <div className="review-modal-header">
          <div>
            <h3 className="font-bold text-lg text-slate-900">
              Submit Session Feedback
            </h3>
            <p className="text-xs text-muted">
              Leave a peer rating and review after a completed knowledge exchange.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="modal-close-btn"
            aria-label="Close modal"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="review-modal-form">
          <div className="review-modal-body">
            {formError && (
              <div className="modal-error-box">
                <AlertCircle size={15} />
                <span>{formError}</span>
              </div>
            )}

            {/* Feedback Type (Learner vs Mentor) */}
            <div className="form-group">
              <label className="form-label font-bold">Feedback Type</label>
              <div className="grid grid-cols-2 gap-3 mt-1">
                <button
                  type="button"
                  onClick={() => handleRoleChange('Learner')}
                  className={`p-3 rounded-lg border-2 text-left flex items-start gap-2.5 transition-all ${
                    formAuthorRole === 'Learner'
                      ? 'border-indigo-600 bg-indigo-50/70 text-indigo-900 ring-2 ring-indigo-500/20 shadow-sm'
                      : 'border-slate-200 bg-slate-50 text-slate-700'
                  }`}
                >
                  <GraduationCap size={16} className="text-indigo-600 mt-0.5" />
                  <div>
                    <span className="font-bold text-xs block">Learner Review</span>
                    <span className="text-xs text-muted">Rate your mentor</span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleRoleChange('Teacher')}
                  className={`p-3 rounded-lg border-2 text-left flex items-start gap-2.5 transition-all ${
                    formAuthorRole === 'Teacher'
                      ? 'border-purple-600 bg-purple-50/70 text-purple-900 ring-2 ring-purple-500/20 shadow-sm'
                      : 'border-slate-200 bg-slate-50 text-slate-700'
                  }`}
                >
                  <BookOpen size={16} className="text-purple-600 mt-0.5" />
                  <div>
                    <span className="font-bold text-xs block">Mentor Review</span>
                    <span className="text-xs text-muted">Rate your learner</span>
                  </div>
                </button>
              </div>
            </div>

            {/* Reviewer Student (Read-Only) */}
            <div className="form-group">
              <label className="form-label font-bold">
                Reviewer Student (Logged In)
              </label>
              <input
                type="text"
                className="form-control"
                value={user?.name ? `${user.name} (${user?.studentId || currentStudentId || ''})` : (user?.studentId || currentStudentId || '')}
                readOnly
                disabled
                style={{ backgroundColor: '#f1f5f9', cursor: 'not-allowed' }}
              />
              <span className="text-xs text-muted">
                Reviewer Student ID: {user?.studentId || currentStudentId || ''}
              </span>
            </div>

            {/* "Review for" List of Completed Sessions / Exchanges */}
            <div className="form-group">
              <label className="form-label font-bold">
                Review for <span className="text-red-500">*</span>
              </label>
              <select
                className="form-control"
                value={selectedExchangeId}
                onChange={(e) => setSelectedExchangeId(e.target.value)}
                required
                disabled={eligibleItems.length === 0}
              >
                {eligibleItems.length === 0 ? (
                  <option value="">Complete a session to leave a review.</option>
                ) : (
                  eligibleItems.map((item) => (
                    <option key={item.exchangeId} value={item.exchangeId}>
                      {item.partnerName} ({item.partnerStudentId}, {item.partnerDept || 'Department'}) • {item.skill} • {item.date} ({item.topic})
                    </option>
                  ))
                )}
              </select>
              {eligibleItems.length === 0 && (
                <span className="text-xs text-amber-600 font-semibold mt-1 block">
                  Complete a session to leave a review.
                </span>
              )}
            </div>

            {/* Read-Only Summary of Selected Session */}
            {selectedItem && (
              <div className="review-summary-card">
                <div className="review-summary-header">Session &amp; Partner Details</div>
                <div className="review-summary-grid">
                  <div className="review-summary-item">
                    <span className="summary-label">Reviewing:</span>
                    <span className="summary-value font-bold text-slate-900">
                      {selectedItem.partnerName} ({selectedItem.partnerStudentId}, {selectedItem.partnerDept || 'Campus Student'})
                    </span>
                  </div>
                  <div className="review-summary-item">
                    <span className="summary-label">Skill:</span>
                    <span className="summary-value text-slate-800 font-semibold">{selectedItem.skill}</span>
                  </div>
                  <div className="review-summary-item">
                    <span className="summary-label">Session Date:</span>
                    <span className="summary-value text-slate-800">{selectedItem.date}</span>
                  </div>
                  <div className="review-summary-item">
                    <span className="summary-label">Topic:</span>
                    <span className="summary-value text-slate-800">{selectedItem.topic}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Star Rating Picker (starts empty) */}
            <div className="form-group">
              <label className="form-label font-bold flex items-center justify-between">
                <span>Star Rating: <span className="text-red-500">*</span></span>
                <span className="star-rating-pill">
                  {formRating > 0 ? `${formRating} of 5 Stars` : 'Unselected'}
                </span>
              </label>

              <div className="interactive-stars-picker mt-1" role="radiogroup" aria-label="Select star rating">
                {[1, 2, 3, 4, 5].map((starVal) => {
                  const filled =
                    formHoverRating >= starVal ||
                    (!formHoverRating && formRating >= starVal);
                  const isChosen = formRating === starVal;

                  return (
                    <div key={starVal} className="star-btn-wrapper">
                      <motion.button
                        type="button"
                        className={`star-btn ${filled ? 'star-filled' : 'star-empty'}`}
                        onMouseEnter={() => setFormHoverRating(starVal)}
                        onMouseLeave={() => setFormHoverRating(0)}
                        onClick={() => handleSelectStar(starVal)}
                        aria-label={`Rate ${starVal} stars`}
                        animate={
                          shouldReduceMotion
                            ? { scale: 1 }
                            : filled
                            ? { scale: [1, 1.32, 1] }
                            : { scale: 1 }
                        }
                        transition={{
                          duration: 0.28,
                          ease: 'easeOut',
                          delay: (starVal - 1) * 0.04
                        }}
                      >
                        <Star
                          size={32}
                          fill={filled ? '#FFD23F' : '#ffffff'}
                          stroke="#1A1A2E"
                          strokeWidth={2.2}
                          className="star-svg-glyph"
                        />
                      </motion.button>

                      {!shouldReduceMotion && isChosen && sparkleRatingTrigger === starVal && (
                        <motion.div
                          className="chosen-star-sparkle-burst"
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: [0, 1.4, 0], opacity: [0, 1, 0] }}
                          transition={{ duration: 0.55, ease: 'easeOut' }}
                          aria-hidden="true"
                        >
                          <span className="sparkle-particle p1">✨</span>
                          <span className="sparkle-particle p2">✦</span>
                          <span className="sparkle-particle p3">★</span>
                          <span className="sparkle-particle p4">✦</span>
                        </motion.div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Comment */}
            <div className="form-group">
              <label className="form-label font-bold">
                Feedback Comment <span className="text-red-500">*</span>
              </label>
              <textarea
                className="form-control"
                rows={3}
                value={formComment}
                onChange={(e) => setFormComment(e.target.value)}
                placeholder="Share your experience: How clearly were concepts explained? Were practical examples used? Did the session start on time?"
                required
              />
              <span className="text-xs text-muted">
                Minimum 10 characters ({formComment.length}/10)
              </span>
            </div>
          </div>

          <div className="review-modal-footer">
            <button
              type="button"
              className="btn btn-outline"
              onClick={onClose}
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!formRating || formRating < 1 || !formComment.trim() || formComment.trim().length < 10 || !selectedExchangeId || isLoading}
              style={{
                opacity: (!formRating || formRating < 1 || !formComment.trim() || formComment.trim().length < 10 || !selectedExchangeId || isLoading) ? 0.6 : 1,
                cursor: (!formRating || formRating < 1 || !formComment.trim() || formComment.trim().length < 10 || !selectedExchangeId || isLoading) ? 'not-allowed' : 'pointer'
              }}
            >
              <CheckCircle2 size={16} />
              <span>{isLoading ? 'Submitting...' : 'Submit Feedback'}</span>
            </button>
          </div>
        </form>
      </motion.div>
    </div>,
    document.body
  );
}
