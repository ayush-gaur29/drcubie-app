import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { createNotification } from '../../services/notificationsService';
import { triggerPushNotification } from '../../services/pushNotificationService';
import './AdminNotificationModal.css';

/**
 * Admin Notification Console Modal.
 *
 * Allows Admins to:
 * 1. Target a specific user, multiple users, or broadcast to all users
 * 2. Craft custom or template-based notifications
 * 3. Save authoritative record to Supabase 'notifications' table FIRST
 * 4. Dispatch FCM push notification via Supabase Edge Function 'send-push-notification'
 * 5. Review live delivery reports (total devices, success count, stale token cleanups)
 */
export const AdminNotificationModal = ({
  isOpen,
  onClose,
  currentUserId,
  onNotificationCreated
}) => {
  const [targetMode, setTargetMode] = useState('self'); // 'self' | 'user' | 'broadcast'
  const [usersList, setUsersList] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState(currentUserId || '');
  const [loadingUsers, setLoadingUsers] = useState(false);

  const [title, setTitle] = useState("Today's Spark is Ready");
  const [message, setMessage] = useState("Begin your morning pause with 'Focused Believing'.");
  const [type, setType] = useState('spark');
  const [route, setRoute] = useState('today');
  const [relatedContentId, setRelatedContentId] = useState('');

  const [isSending, setIsSending] = useState(false);
  const [deliveryResult, setDeliveryResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  // Load existing users from profiles when modal opens
  useEffect(() => {
    if (!isOpen || !supabase) return;

    setDeliveryResult(null);
    setErrorMsg(null);

    const loadProfiles = async () => {
      setLoadingUsers(true);
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, full_name, email, role')
          .order('created_at', { ascending: false })
          .limit(30);

        if (!error && data) {
          setUsersList(data);
          if (!selectedUserId && data.length > 0) {
            setSelectedUserId(data[0].id);
          }
        }
      } catch (err) {
        console.warn('[AdminNotif] Error loading profiles:', err);
      } finally {
        setLoadingUsers(false);
      }
    };

    loadProfiles();
  }, [isOpen, selectedUserId]);

  if (!isOpen) return null;

  // Quick Preset Templates
  const handleApplyTemplate = (tpl) => {
    if (tpl === 'spark') {
      setTitle("Today's Spark is Ready");
      setMessage("Begin your morning pause with 'Focused Believing'.");
      setType('spark');
      setRoute('today');
    } else if (tpl === 'vip') {
      setTitle("Exclusive VIP Sanctuary Release");
      setMessage("Explore the new masterclass video contemplation now.");
      setType('vip');
      setRoute('vip-pass');
    } else if (tpl === 'streak') {
      setTitle("7-Day Stillness Streak!");
      setMessage("You've returned to your pause practice 7 days in a row.");
      setType('streak');
      setRoute('profile');
    } else if (tpl === 'audio') {
      setTitle("New Evening Soundscape Available");
      setMessage("Deepen your evening wind-down with guided breath.");
      setType('audio');
      setRoute('audios');
    }
  };

  const handleSendNotification = async (isDryRun = false) => {
    if (!title.trim() || !message.trim()) {
      setErrorMsg('Please enter both title and message.');
      return;
    }

    setIsSending(true);
    setErrorMsg(null);
    setDeliveryResult(null);

    try {
      const targetUser = targetMode === 'self' ? currentUserId : targetMode === 'user' ? selectedUserId : null;
      const isBroadcast = targetMode === 'broadcast';

      if (!isBroadcast && !targetUser) {
        throw new Error('Please select a target user.');
      }

      // Step 1: Save Authoritative Notification Record to Supabase
      let createdNotifRecord = null;
      if (targetUser) {
        const notifRes = await createNotification({
          userId: targetUser,
          title: title.trim(),
          message: message.trim(),
          type,
          relatedContentId: relatedContentId.trim() || null,
          route,
          dispatchPush: false // We trigger push explicitly below for detailed feedback
        });

        if (!notifRes.success) {
          throw new Error(`Failed to create database record: ${notifRes.error}`);
        }
        createdNotifRecord = notifRes.data;
      }

      // Step 2: Trigger Server-Side Push Delivery via Edge Function
      const pushRes = await triggerPushNotification({
        notificationId: createdNotifRecord?.id,
        userId: targetUser,
        broadcast: isBroadcast,
        title: title.trim(),
        message: message.trim(),
        type,
        relatedContentId: relatedContentId.trim() || null,
        route,
        dryRun: isDryRun
      });

      if (!pushRes.success) {
        setDeliveryResult({
          databaseSaved: Boolean(createdNotifRecord),
          recordId: createdNotifRecord?.id,
          pushSuccess: false,
          error: pushRes.error,
          details: pushRes.data
        });
      } else {
        setDeliveryResult({
          databaseSaved: Boolean(createdNotifRecord),
          recordId: createdNotifRecord?.id,
          pushSuccess: true,
          details: pushRes.data
        });
      }

      if (onNotificationCreated && createdNotifRecord) {
        onNotificationCreated(createdNotifRecord);
      }
    } catch (err) {
      console.error('[AdminNotif] Send error:', err);
      setErrorMsg(err.message || 'An error occurred while sending notification.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="admin-notif-backdrop" role="dialog" aria-modal="true" aria-labelledby="admin-notif-modal-title">
      <div className="admin-notif-card animate-popup-in">
        {/* Modal Header */}
        <div className="admin-notif-header">
          <div className="admin-notif-header-title-wrap">
            <span className="material-symbols-outlined admin-shield-icon">
              admin_panel_settings
            </span>
            <div>
              <h2 className="admin-notif-title" id="admin-notif-modal-title">Admin Notification Console</h2>
              <p className="admin-notif-subtitle font-body-sm">
                Supabase Database + Firebase Cloud Messaging Push Delivery
              </p>
            </div>
          </div>
          <button
            type="button"
            className="admin-notif-close-btn"
            onClick={onClose}
            aria-label="Close admin notification modal"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="admin-notif-body">
          {/* Quick Presets */}
          <div className="admin-preset-row">
            <span className="font-label-sm admin-preset-label">Templates:</span>
            <button type="button" className="admin-preset-pill" onClick={() => handleApplyTemplate('spark')}>
              Daily Spark
            </button>
            <button type="button" className="admin-preset-pill" onClick={() => handleApplyTemplate('vip')}>
              VIP Keynote
            </button>
            <button type="button" className="admin-preset-pill" onClick={() => handleApplyTemplate('streak')}>
              Streak
            </button>
            <button type="button" className="admin-preset-pill" onClick={() => handleApplyTemplate('audio')}>
              Audio
            </button>
          </div>

          {/* Target Audience */}
          <div className="admin-form-group">
            <label className="admin-form-label font-label-md">Target Audience</label>
            <div className="admin-radio-tabs">
              <button
                type="button"
                className={`admin-radio-tab ${targetMode === 'self' ? 'active' : ''}`}
                onClick={() => setTargetMode('self')}
              >
                My Account (Self Test)
              </button>
              <button
                type="button"
                className={`admin-radio-tab ${targetMode === 'user' ? 'active' : ''}`}
                onClick={() => setTargetMode('user')}
              >
                Specific User
              </button>
              <button
                type="button"
                className={`admin-radio-tab ${targetMode === 'broadcast' ? 'active' : ''}`}
                onClick={() => setTargetMode('broadcast')}
              >
                Broadcast (All Users)
              </button>
            </div>

            {targetMode === 'user' && (
              <div className="admin-user-select-wrap">
                {loadingUsers ? (
                  <span className="font-body-sm text-dim">Loading users from Supabase profiles...</span>
                ) : (
                  <select
                    className="admin-form-select"
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                  >
                    {usersList.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.full_name || u.email || u.id} ({u.role || 'user'})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>

          {/* Title & Message */}
          <div className="admin-form-group">
            <label className="admin-form-label font-label-md">Notification Title</label>
            <input
              type="text"
              className="admin-form-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Today's Spark is Ready"
            />
          </div>

          <div className="admin-form-group">
            <label className="admin-form-label font-label-md">Notification Message / Body</label>
            <textarea
              className="admin-form-textarea"
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="e.g. Take a gentle pause for today's reflection."
            />
          </div>

          {/* Type & Route Grid */}
          <div className="admin-form-grid">
            <div className="admin-form-group">
              <label className="admin-form-label font-label-md">Notification Type</label>
              <select
                className="admin-form-select"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                <option value="spark">Spark (Daily Wisdom)</option>
                <option value="video">Video</option>
                <option value="audio">Audio</option>
                <option value="vip">VIP Sanctuary</option>
                <option value="streak">Streak Celebration</option>
                <option value="general">General</option>
                <option value="system">System</option>
              </select>
            </div>

            <div className="admin-form-group">
              <label className="admin-form-label font-label-md">Destination Route</label>
              <input
                type="text"
                className="admin-form-input"
                value={route}
                onChange={(e) => setRoute(e.target.value)}
                placeholder="e.g. today, vip-pass, profile"
              />
            </div>
          </div>

          {/* Delivery Feedback Banner */}
          {deliveryResult && (
            <div className={`admin-result-card ${deliveryResult.pushSuccess ? 'success' : 'warning'}`}>
              <div className="admin-result-header">
                <span className="material-symbols-outlined">
                  {deliveryResult.pushSuccess ? 'check_circle' : 'info'}
                </span>
                <span className="font-label-md">
                  {deliveryResult.pushSuccess ? 'Notification Dispatched Successfully!' : 'Database Record Created'}
                </span>
              </div>
              <div className="admin-result-body font-body-sm">
                {deliveryResult.recordId && (
                  <div>• Supabase Notification ID: <code>{deliveryResult.recordId}</code></div>
                )}
                {deliveryResult.details?.totalTokens !== undefined && (
                  <div>• Active Device Tokens Found: <strong>{deliveryResult.details.totalTokens}</strong></div>
                )}
                {deliveryResult.details?.sentCount !== undefined && (
                  <div>• Delivered FCM Messages: <strong>{deliveryResult.details.sentCount}</strong></div>
                )}
                {deliveryResult.details?.message && (
                  <div className="admin-result-note">• Note: {deliveryResult.details.message}</div>
                )}
                {deliveryResult.details?.instructions && (
                  <div className="admin-result-cmd">
                    <code>{deliveryResult.details.instructions}</code>
                  </div>
                )}
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="admin-result-card error">
              <span className="material-symbols-outlined">error</span>
              <span className="font-body-sm">{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Modal Footer Actions */}
        <div className="admin-notif-footer">
          <button
            type="button"
            className="admin-btn-secondary btn-pressable"
            onClick={() => handleSendNotification(true)}
            disabled={isSending}
            title="Validates tokens and edge function execution without pushing to FCM"
          >
            Verify (Dry Run)
          </button>

          <button
            type="button"
            className="admin-btn-primary btn-pressable"
            onClick={() => handleSendNotification(false)}
            disabled={isSending}
          >
            {isSending ? (
              <>
                <span className="admin-spinner" />
                <span>Sending Push...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                  send
                </span>
                <span>Send Push Notification</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
