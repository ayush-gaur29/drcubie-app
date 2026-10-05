import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  formatNotificationTime,
  getNotificationIcon,
  groupNotificationsByTime,
  getNotificationRoute
} from '../../services/notificationsService';
import {
  checkPushPermission,
  requestPushPermission,
  registerPushTokenInSupabase,
  isNativePlatform
} from '../../services/pushNotificationService';
import { PushNotifications } from '@capacitor/push-notifications';
import './Notifications.css';

export const Notifications = ({
  notifications = [],
  loading = false,
  error = null,
  onNotificationClick,
  onMarkAllAsRead,
  onBack,
  onNavigate,
  onRefresh
}) => {
  const { user, isAuthenticated, openAuth } = useAuth();
  const [filter, setFilter] = useState('all'); // 'all' | 'unread'
  const [pushStatus, setPushStatus] = useState('granted');
  const [dismissedPushBanner, setDismissedPushBanner] = useState(false);

  useEffect(() => {
    checkPushPermission().then(setPushStatus);
  }, []);

  const handleEnablePush = async () => {
    const res = await requestPushPermission();
    setPushStatus(res);
    if (res === 'granted') {
      if (isNativePlatform()) {
        await PushNotifications.register();
      } else if (user?.id) {
        await registerPushTokenInSupabase(user.id, `web_push_${user.id.slice(0, 8)}_${Date.now()}`);
      }
    }
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const filteredList = notifications.filter((item) => {
    if (filter === 'unread') return !item.is_read;
    return true;
  });

  const timeGroups = groupNotificationsByTime(filteredList);

  const handleItemClick = (item) => {
    if (onNotificationClick) {
      onNotificationClick(item);
    }
  };

  return (
    <div className="notifications-page animate-fade-in" id="notifications-full-page">
      {/* Page Header */}
      <section className="notif-page-header">
        <div className="notif-page-title-row">
          <div className="notif-page-title-group">
            {onBack && (
              <button
                type="button"
                className="notif-back-btn btn-pressable"
                onClick={onBack}
                aria-label="Go back"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>
                  arrow_back
                </span>
              </button>
            )}
            <div>
              <h1 className="notif-page-title font-headline-md">Notifications</h1>
              <p className="notif-page-subtitle font-body-sm">
                Updates, insights, and reminders for your pause practice
              </p>
            </div>
          </div>

          {unreadCount > 0 && isAuthenticated && (
            <button
              type="button"
              className="notif-mark-all-read-btn btn-pressable"
              onClick={onMarkAllAsRead}
              id="btn-mark-all-read"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                done_all
              </span>
              <span>Mark all read</span>
            </button>
          )}
        </div>

        {/* Subtle Push Permission Banner */}
        {isAuthenticated && pushStatus === 'prompt' && !dismissedPushBanner && (
          <div className="notif-permission-banner">
            <div className="notif-perm-banner-left">
              <span className="material-symbols-outlined" style={{ color: '#ffc67d', fontSize: '20px' }}>
                notifications_active
              </span>
              <span className="font-body-sm notif-perm-banner-text">
                Enable push notifications to receive your Daily Spark right on time.
              </span>
            </div>
            <div className="notif-perm-banner-actions">
              <button
                type="button"
                className="notif-perm-enable-btn btn-pressable font-label-sm"
                onClick={handleEnablePush}
              >
                Enable
              </button>
              <button
                type="button"
                className="notif-perm-dismiss-btn"
                onClick={() => setDismissedPushBanner(true)}
                aria-label="Dismiss banner"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>close</span>
              </button>
            </div>
          </div>
        )}

        {/* Filter Tabs */}
        {isAuthenticated && notifications.length > 0 && (
          <div className="notif-filter-tabs">
            <button
              type="button"
              className={`notif-filter-tab ${filter === 'all' ? 'active' : ''} btn-pressable`}
              onClick={() => setFilter('all')}
            >
              <span>All</span>
              <span className="notif-filter-badge">{notifications.length}</span>
            </button>
            <button
              type="button"
              className={`notif-filter-tab ${filter === 'unread' ? 'active' : ''} btn-pressable`}
              onClick={() => setFilter('unread')}
            >
              <span>Unread</span>
              {unreadCount > 0 && (
                <span className="notif-filter-badge unread">{unreadCount}</span>
              )}
            </button>
          </div>
        )}
      </section>

      {/* Main Content Area */}
      <section className="notif-page-content">
        {!isAuthenticated ? (
          <div className="notif-state-card notif-unauth-state">
            <div className="notif-state-icon-circle">
              <span className="material-symbols-outlined" style={{ fontSize: '28px' }}>
                lock
              </span>
            </div>
            <h2 className="notif-state-title">Sign in to view notifications</h2>
            <p className="notif-state-desc">
              Your notifications, streaks, and personal reminders are tied to your Dr. Cubie account.
            </p>
            <button
              type="button"
              className="notif-primary-btn btn-pressable"
              onClick={() => openAuth('signin')}
            >
              Sign In / Sign Up
            </button>
          </div>
        ) : loading ? (
          <div className="notif-page-skeletons">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="notif-card-skeleton">
                <div className="skeleton-icon-box skeleton-shimmer" />
                <div className="skeleton-card-body">
                  <div className="skeleton-line-title skeleton-shimmer" />
                  <div className="skeleton-line-desc skeleton-shimmer" />
                  <div className="skeleton-line-time skeleton-shimmer" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="notif-state-card notif-error-state">
            <div className="notif-state-icon-circle error">
              <span className="material-symbols-outlined" style={{ fontSize: '28px' }}>
                cloud_off
              </span>
            </div>
            <h2 className="notif-state-title">Couldn't load notifications</h2>
            <p className="notif-state-desc">
              We encountered a temporary connection issue. Please check your connection and try again.
            </p>
            {onRefresh && (
              <button
                type="button"
                className="notif-primary-btn btn-pressable"
                onClick={onRefresh}
              >
                Try Again
              </button>
            )}
          </div>
        ) : filteredList.length === 0 ? (
          <div className="notif-state-card notif-empty-state">
            <div className="notif-state-icon-circle">
              <span className="material-symbols-outlined" style={{ fontSize: '32px' }}>
                {filter === 'unread' ? 'mark_chat_read' : 'notifications_none'}
              </span>
            </div>
            <h2 className="notif-state-title">
              {filter === 'unread' ? 'All caught up' : 'No notifications yet'}
            </h2>
            <p className="notif-state-desc">
              {filter === 'unread'
                ? "You have read all of your notifications. You're completely up to date!"
                : "You don't have any notifications right now. As new sparks, reflections, and practices become available, they'll appear here."}
            </p>
            {filter === 'unread' ? (
              <button
                type="button"
                className="notif-secondary-btn btn-pressable"
                onClick={() => setFilter('all')}
              >
                View all notifications
              </button>
            ) : (
              <button
                type="button"
                className="notif-primary-btn btn-pressable"
                onClick={() => (onNavigate ? onNavigate('today') : null)}
              >
                Explore Today's Spark
              </button>
            )}
          </div>
        ) : (
          <div className="notif-groups-container">
            {/* Today Group */}
            {timeGroups.today.length > 0 && (
              <div className="notif-group-section">
                <h3 className="notif-group-header font-label-md">Today</h3>
                <div className="notif-group-cards">
                  {timeGroups.today.map((item) => (
                    <NotificationItemCard
                      key={item.id}
                      item={item}
                      onClick={() => handleItemClick(item)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Yesterday Group */}
            {timeGroups.yesterday.length > 0 && (
              <div className="notif-group-section">
                <h3 className="notif-group-header font-label-md">Yesterday</h3>
                <div className="notif-group-cards">
                  {timeGroups.yesterday.map((item) => (
                    <NotificationItemCard
                      key={item.id}
                      item={item}
                      onClick={() => handleItemClick(item)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Earlier Group */}
            {timeGroups.earlier.length > 0 && (
              <div className="notif-group-section">
                <h3 className="notif-group-header font-label-md">Earlier</h3>
                <div className="notif-group-cards">
                  {timeGroups.earlier.map((item) => (
                    <NotificationItemCard
                      key={item.id}
                      item={item}
                      onClick={() => handleItemClick(item)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};

/**
 * Individual Notification Card item
 */
const NotificationItemCard = ({ item, onClick }) => {
  const isUnread = !item.is_read;
  const icon = getNotificationIcon(item.type);
  const time = formatNotificationTime(item.created_at);

  return (
    <article
      className={`notif-card ${isUnread ? 'unread' : 'read'} btn-pressable`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label={`${item.title} - ${item.message} - ${time}${isUnread ? ' (Unread)' : ''}`}
    >
      <div className={`notif-card-icon ${item.type || 'general'}`}>
        <span
          className="material-symbols-outlined"
          style={{
            fontSize: '20px',
            fontVariationSettings: isUnread ? "'FILL' 1" : "'FILL' 0"
          }}
        >
          {icon}
        </span>
      </div>

      <div className="notif-card-body">
        <div className="notif-card-title-row">
          <h4 className="notif-card-title">{item.title}</h4>
          <span className="notif-card-time">{time}</span>
        </div>
        <p className="notif-card-message">{item.message}</p>
      </div>

      {isUnread && (
        <div className="notif-card-badge-wrap">
          <span className="notif-card-unread-dot" title="Unread" />
        </div>
      )}
    </article>
  );
};
