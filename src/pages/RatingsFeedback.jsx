import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Star,
  MessageSquare,
  Plus,
  CheckCircle2,
  Calendar,
  BookOpen,
  GraduationCap,
  Users,
  Filter,
  X,
  AlertCircle,
  Clock,
  Sparkles,
  ArrowRight
} from 'lucide-react';
import { useAuth } from '../utils/auth.js';
import useLiveRefresh from '../utils/useLiveRefresh.js';
import api, { normalizeStudentId } from '../utils/api.js';
import AnimeIdChip from '../components/AnimeIdChip.jsx';
import RatingDisplay from '../components/RatingDisplay.jsx';
import ReviewModal from '../components/ReviewModal.jsx';
import { getOrAssignTeacherCourse } from '../utils/idEngine.js';
import './RatingsFeedback.css';

const RatingsFeedback = () => {
  const { user } = useAuth();
  const shouldReduceMotion = useReducedMotion();
  const [searchParams] = useSearchParams();
  const paramExchangeId = searchParams.get('exchangeId');
  const paramRole = searchParams.get('role');

  const [backendReviews, setBackendReviews] = useState([]);
  const [completedExchanges, setCompletedExchanges] = useState([]);
  const [selectedExchangeId, setSelectedExchangeId] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const [filterRole, setFilterRole] = useState('All'); // 'All', 'Learner', 'Teacher'
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  useEffect(() => {
    if (paramExchangeId || searchParams.get('openReview') === 'true') {
      setIsSubmitModalOpen(true);
    }
  }, [paramExchangeId, searchParams]);

  // Review Form State
  const [formAuthorRole, setFormAuthorRole] = useState('Learner');
  const [formRating, setFormRating] = useState(0); // Stars start unselected
  const [formHoverRating, setFormHoverRating] = useState(0);
  const [formSkill, setFormSkill] = useState('');
  const [formComment, setFormComment] = useState('');
  const [formError, setFormError] = useState('');

  // Rating interaction feedback: chosen star sparkle burst & screen pulse
  const [sparkleRatingTrigger, setSparkleRatingTrigger] = useState(null);
  const [isScreenPulsing, setIsScreenPulsing] = useState(false);

  const currentStudentId = normalizeStudentId(user?.StudentID || user?.studentId || user?.id);

  // Lock body scroll and handle Escape key for feedback modal
  useEffect(() => {
    if (!isSubmitModalOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsSubmitModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSubmitModalOpen]);

  const fetchFeedbackData = useCallback(async () => {
    if (!currentStudentId) {
      setBackendReviews([]);
      setCompletedExchanges([]);
      return;
    }
    try {
      const [revs, exchs] = await Promise.all([
        api.feedback.getByStudent(currentStudentId).catch(() => []),
        api.exchanges.getByStudent(currentStudentId).catch(() => [])
      ]);
      setBackendReviews(Array.isArray(revs) ? revs : []);
      const completed = (Array.isArray(exchs) ? exchs : []).filter(
        (ex) => ex.Status === 'Completed'
      );
      setCompletedExchanges(completed);
    } catch (err) {
      console.error('Failed to load feedback data:', err);
    }
  }, [currentStudentId]);

  useEffect(() => {
    fetchFeedbackData();
  }, [fetchFeedbackData]);

  useLiveRefresh(fetchFeedbackData, 8000);

  const reviews = backendReviews;

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  // Filtered Reviews
  const filteredReviews = useMemo(() => {
    return reviews.filter((r) => {
      if (filterRole === 'All') return true;
      return r.authorRole === filterRole;
    });
  }, [reviews, filterRole]);

  // Overall Statistics Calculation
  const totalReviewsCount = reviews.length;
  const averageRating =
    totalReviewsCount > 0
      ? (
          reviews.reduce((acc, r) => acc + (Number(r.rating) || 0), 0) /
          totalReviewsCount
        ).toFixed(2)
      : null;

  // Star Distribution
  const starCounts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  reviews.forEach((r) => {
    const star = Math.round(Number(r.rating) || 0);
    if (starCounts[star] !== undefined) {
      starCounts[star] += 1;
    }
  });

  // Filter completed exchanges based on selected feedback type
  const eligibleExchanges = useMemo(() => {
    if (!currentStudentId) return [];
    if (formAuthorRole === 'Learner') {
      return completedExchanges.filter(
        (ex) => Number(ex.LearnerID) === Number(currentStudentId)
      );
    }
    return completedExchanges.filter(
      (ex) => Number(ex.TeacherID) === Number(currentStudentId)
    );
  }, [completedExchanges, formAuthorRole, currentStudentId]);

  const handleRoleChange = (role) => {
    setFormAuthorRole(role);
    setFormError('');
    const matches = completedExchanges.filter((ex) =>
      role === 'Learner'
        ? Number(ex.LearnerID) === Number(currentStudentId)
        : Number(ex.TeacherID) === Number(currentStudentId)
    );
    if (matches.length > 0) {
      setSelectedExchangeId(String(matches[0].ExchangeID));
      setFormSkill(matches[0].SkillName || matches[0].skillName || '');
    } else {
      setSelectedExchangeId('');
      setFormSkill('');
    }
  };

  const handleOpenModal = () => {
    setFormAuthorRole('Learner');
    setFormRating(0); // Stars start unselected
    setFormHoverRating(0);
    setFormComment('');
    setFormError('');
    setSparkleRatingTrigger(null);

    const initialEligible = completedExchanges.filter(
      (ex) => Number(ex.LearnerID) === Number(currentStudentId)
    );
    if (initialEligible.length > 0) {
      setSelectedExchangeId(String(initialEligible[0].ExchangeID));
      setFormSkill(initialEligible[0].SkillName || initialEligible[0].skillName || '');
    } else {
      setSelectedExchangeId('');
      setFormSkill('');
    }

    setIsSubmitModalOpen(true);
  };

  // Handle star click with pop, sparkles burst, and screen pulse
  const handleSelectStar = (starVal) => {
    setFormRating(starVal);
    setSparkleRatingTrigger(starVal);

    if (!shouldReduceMotion) {
      setIsScreenPulsing(true);
      setTimeout(() => {
        setIsScreenPulsing(false);
      }, 350);
    }
  };

  const handleSubmitReview = async (e) => {
    e.preventDefault();
    setFormError('');

    if (eligibleExchanges.length === 0 || !selectedExchangeId) {
      const msg = 'Complete a session to leave a review.';
      setFormError(msg);
      showToast(msg);
      return;
    }

    const targetEx = eligibleExchanges.find(
      (ex) => String(ex.ExchangeID) === String(selectedExchangeId)
    );

    if (!targetEx) {
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
      await api.feedback.submit(targetEx.ExchangeID, {
        givenBy: currentStudentId,
        rating: formRating,
        comments: formComment.trim(),
        clarityRating: formRating,
        patienceRating: formRating,
        punctualityRating: formRating,
        wouldRecommend: 1
      });

      await fetchFeedbackData();
      window.dispatchEvent(new Event('4s_reviews_change'));
      window.dispatchEvent(new Event('4s_badges_change'));

      setIsSubmitModalOpen(false);
      showToast('Feedback submitted successfully! Your peer rating has been updated.');
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

  return (
    <div className={`ratings-page ${isScreenPulsing ? 'screen-pulse-active' : ''}`}>
      <div className="container">
        {/* Floating Toast Notification */}
        {toastMessage && (
          <div className="app-toast-alert">
            <CheckCircle2 size={18} className="text-emerald-400" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* Page Header */}
        <div className="ratings-header">
          <span className="ratings-kicker">
            <Star size={14} fill="#d97706" />
            <span>Trust &amp; Peer Quality</span>
          </span>
          <h1 className="ratings-title">Ratings &amp; Student Feedback</h1>
          <p className="ratings-subtitle">
            Transparent evaluations received from fellow students after 1-on-1 teaching and learning sessions on 4S. Quality ratings help maintain high teaching standards across campus.
          </p>
        </div>

        {/* 1. Overall Rating Summary Card */}
        <div className="rating-summary-card">
          <div className="rating-score-block">
            {totalReviewsCount === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.65rem' }}>
                <RatingDisplay rating={null} reviewCount={0} />
                <div className="rating-total-text" style={{ marginTop: '0.25rem' }}>
                  Based on 0 student reviews
                </div>
              </div>
            ) : (
              <>
                <div className="rating-score-num">{Number(averageRating || 0).toFixed(2)} out of 5</div>
                <div className="rating-stars-row">
                  {[...Array(5)].map((_, i) => (
                    <Star
                      key={i}
                      size={20}
                      fill={i < Math.round(Number(averageRating)) ? '#f59e0b' : 'none'}
                      color="#1A1A2E"
                      strokeWidth={2}
                      className="summary-star-icon"
                    />
                  ))}
                </div>
                <div className="rating-total-text">
                  Based on {totalReviewsCount} student review{totalReviewsCount !== 1 ? 's' : ''}
                </div>
              </>
            )}
          </div>

          {/* Star Distribution Bars */}
          <div className="rating-bars-list">
            {[5, 4, 3, 2, 1].map((stars) => {
              const count = starCounts[stars] || 0;
              const pct = totalReviewsCount > 0 ? (count / totalReviewsCount) * 100 : 0;

              return (
                <div key={stars} className="rating-bar-row">
                  <span className="bar-star-label">{stars} stars</span>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${pct}%` }}></div>
                  </div>
                  <span className="bar-pct">{count}</span>
                </div>
              );
            })}
          </div>

          {/* Submit Action */}
          <div>
            <button onClick={handleOpenModal} className="btn btn-primary" style={{ flexShrink: 0 }}>
              <Plus size={16} />
              <span>Submit Session Rating</span>
            </button>
          </div>
        </div>

        {/* 2. Controls & Filter Bar */}
        <div className="reviews-controls-bar">
          <div className="review-filter-tabs">
            <button
              className={`review-tab-btn ${filterRole === 'All' ? 'active' : ''}`}
              onClick={() => setFilterRole('All')}
            >
              All Reviews ({reviews.length})
            </button>
            <button
              className={`review-tab-btn ${filterRole === 'Learner' ? 'active' : ''}`}
              onClick={() => setFilterRole('Learner')}
            >
              From Mentees (Teaching Sessions)
            </button>
            <button
              className={`review-tab-btn ${filterRole === 'Teacher' ? 'active' : ''}`}
              onClick={() => setFilterRole('Teacher')}
            >
              From Mentors (Learning Sessions)
            </button>
          </div>

          <div className="text-xs text-muted font-bold">
            Showing {filteredReviews.length} verified review{filteredReviews.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* 3. Reviews Grid */}
        <div className="reviews-grid">
          {filteredReviews.map((rev) => (
            <div key={rev.id} className="review-card">
              <div>
                <div className="review-card-header">
                  <div className="reviewer-profile">
                    <div className="reviewer-avatar">
                      {rev.author
                        .split(' ')
                        .map((n) => n[0])
                        .join('')
                        .slice(0, 2)}
                    </div>
                    <div>
                      <h4 className="reviewer-name">
                        {rev.author} {rev.GivenBy ? `(STU${String(rev.GivenBy).padStart(3, '0')})` : ''}
                      </h4>
                      <span
                        className={`reviewer-role-badge ${
                          rev.authorRole === 'Teacher' ? 'badge-teacher' : 'badge-learner'
                        }`}
                      >
                        {rev.authorRole === 'Teacher' ? 'Student Mentor' : 'Peer Learner'}
                      </span>
                    </div>
                  </div>

                  <div className="review-stars">
                    {[...Array(5)].map((_, i) => (
                      <Star
                        key={i}
                        size={16}
                        fill={i < rev.rating ? '#f59e0b' : 'none'}
                        color="#1A1A2E"
                        strokeWidth={2}
                      />
                    ))}
                  </div>
                </div>

                <div className="review-skill-chip flex items-center gap-2 flex-wrap">
                  <span>📚 Skill / Topic: <strong>{rev.skill}</strong></span>
                  {(() => {
                    const teacherStuId = rev.TeacherID ? `STU${String(rev.TeacherID).padStart(3, '0')}` : (user?.studentId || currentStudentId || '');
                    const tcrId = rev.teachingId && /^TCR\d{3,4}CRS\d{3,4}$/.test(rev.teachingId)
                      ? rev.teachingId
                      : getOrAssignTeacherCourse(teacherStuId, rev.skill);

                    return (
                      <AnimeIdChip
                        type="TCR"
                        id={tcrId}
                        record={{ name: rev.skill, teacher: rev.authorRole === 'Teacher' ? rev.author : user?.name }}
                        context={{
                          userName: user?.name,
                          teacherName: rev.authorRole === 'Teacher' ? rev.author : user?.name,
                          name: rev.skill
                        }}
                      />
                    );
                  })()}
                </div>

                <p className="review-comment-text">"{rev.comment}"</p>
              </div>

              <div className="review-footer-row">
                <span className="flex items-center gap-1 font-bold">
                  <Clock size={12} />
                  <span>{rev.date}</span>
                </span>
                <span className="review-verified-tag">✓ Verified 4S Session</span>
              </div>
            </div>
          ))}
        </div>

        {/* Modal: Submit Feedback Form */}
        <ReviewModal
          isOpen={isSubmitModalOpen}
          onClose={() => setIsSubmitModalOpen(false)}
          preselectedExchangeId={paramExchangeId}
          preselectedRole={paramRole}
          onReviewSubmitted={fetchFeedbackData}
        />
      </div>
    </div>
  );
};

export default RatingsFeedback;
