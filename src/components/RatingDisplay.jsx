import React from 'react';
import { Star } from 'lucide-react';
import './RatingDisplay.css';

export function formatRating(rating, reviewCount) {
  const count = Number(reviewCount ?? 0);
  if (!count || rating == null || Number(rating) === 0) {
    return 'New';
  }
  return `${Number(rating).toFixed(2)} / 5 (${count})`;
}

export default function RatingDisplay({
  rating,
  reviewCount,
  reviewsCount,
  showStar = true,
  starSize = 13,
  className = ''
}) {
  const count = Number(reviewCount ?? reviewsCount ?? 0);
  const isNew = !count || rating == null || Number(rating) === 0;

  if (isNew) {
    return (
      <span className={`leaderboard-chip chip-new ${className}`.trim()} title="New student on campus">
        New
      </span>
    );
  }

  const numRating = Number(rating).toFixed(2);

  return (
    <span className={`rating-display-wrap ${className}`.trim()}>
      {showStar && (
        <Star
          size={starSize}
          fill="#f59e0b"
          color="#1A1A2E"
          strokeWidth={1.5}
          className="shrink-0"
        />
      )}
      <span className="rating-text-val">{numRating} / 5</span>
      <span className="rating-count-val">({count})</span>
    </span>
  );
}
