import React, { useEffect, useState, useRef } from 'react';
import { getNotificationIcon, formatNotificationTime } from '../../services/notificationsService';
import './NotificationBanner.css';

/**
 * Refined Dr. Cubie In-App Notification Banner.
 * Appears dynamically when an active push notification or realtime event arrives
 * while the app is in the FOREGROUND.
 */
export const NotificationBanner = ({
  notification,
  onClose,
  onClick
}) => {
  const [isExiting, setIsExiting] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!notification) return;

    setIsExiting(false);

    // Auto-dismiss after 5.5 seconds
    timerRef.current = setTimeout(() => {
      handleClose();
    }, 5500);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [notification]);

  if (!notification) return null;

  const handleClose = (e) => {
    if (e) e.stopPropagation();
    setIsExiting(true);
    setTimeout(() => {
      onClose();
    }, 280);
  };

  const handleClick = () => {
    if (onClick) {
      onClick(notification);
    }
    handleClose();
  };

  const icon = getNotificationIcon(notification.type);
  const timeDisplay = notification.created_at
    ? formatNotificationTime(notification.created_at)
    : (notification.time || 'Just now');

  return (
    <div
      className={`in-app-banner-overlay ${isExiting ? 'banner-exiting' : 'banner-entering'}`}
      role="alert"
      aria-live="assertive"
    >
      <div
        className="in-app-banner-card"
        onClick={handleClick}
        tabIndex={0}
        role="button"
        aria-label={`Notification: ${notification.title}. ${notification.message}. Click to view.`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
      >
        <div className={`in-app-banner-icon ${notification.type || 'general'}`} aria-hidden="true">
          <span className="material-symbols-outlined">
            {icon}
          </span>
        </div>

        <div className="in-app-banner-content">
          <div className="in-app-banner-header">
            <span className="in-app-banner-brand">Dr. Cubie</span>
            <span className="in-app-banner-dot" aria-hidden="true">•</span>
            <span className="in-app-banner-now">{timeDisplay}</span>
          </div>
          <h4 className="in-app-banner-title">{notification.title}</h4>
          <p className="in-app-banner-message">{notification.message}</p>
        </div>

        <div className="in-app-banner-actions">
          <button
            type="button"
            className="in-app-banner-close-btn"
            onClick={handleClose}
            aria-label="Dismiss notification"
          >
            <span className="material-symbols-outlined">
              close
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};

