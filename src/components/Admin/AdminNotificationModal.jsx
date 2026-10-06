import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { createNotification } from '../../services/notificationsService';
import { triggerPushNotification } from '../../services/pushNotificationService';
import { fetchSparks } from '../../services/sparksService';
import { fetchVideos } from '../../services/videosService';
import { fetchAudios } from '../../services/audiosService';
import { VIDEOS } from '../../data/videos';
import { ALL_AUDIOS } from '../../data/audios';
import './AdminNotificationModal.css';

/**
 * Admin Notification Console Modal.
 *
 * Allows Admins to:
 * 1. Target a specific user, multiple users, or broadcast to all users
 * 2. Select Tap Action / Destination (Inbox, Today, Specific Spark, Specific Video, Specific Audio, VIP Pass)
 * 3. Automatically map destination to push payload (type, route, relatedContentId, relatedContentType)
 * 4. Save authoritative record to Supabase 'notifications' table FIRST
 * 5. Dispatch FCM push notification via Supabase Edge Function 'send-push-notification'
 * 6. Review live delivery reports (total devices, success count, stale token cleanups)
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

  // Tap Action / Destination selection state:
  // Options: 'inbox' | 'today' | 'spark' | 'video' | 'audio' | 'vip'
  const [tapAction, setTapAction] = useState('today');

  // Dynamic Content Collections
  const [sparksList, setSparksList] = useState([]);
  const [videosList, setVideosList] = useState([]);
  const [audiosList, setAudiosList] = useState([]);

  // Selected Content IDs (dynamic)
  const [selectedSparkId, setSelectedSparkId] = useState('');
  const [selectedVideoId, setSelectedVideoId] = useState('');
  const [selectedAudioId, setSelectedAudioId] = useState('');

  const [isSending, setIsSending] = useState(false);
  const [deliveryResult, setDeliveryResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  // Computes authoritative payload mapping from selected Tap Action and dynamic content IDs
  const getMappedPayload = (
    action = tapAction,
    sparkId = selectedSparkId,
    videoId = selectedVideoId,
    audioId = selectedAudioId
  ) => {
    switch (action) {
      case 'inbox':
        return {
          type: 'general',
          route: 'notifications',
          relatedContentId: null,
          relatedContentType: null
        };
      case 'today':
        return {
          type: 'general',
          route: 'today',
          relatedContentId: null,
          relatedContentType: null
        };
      case 'spark': {
        const activeSparkId =
          sparkId || (sparksList[0]?.id || sparksList[0]?.slug) || 'focused-believing';
        return {
          type: 'spark',
          route: `spark/${activeSparkId}`,
          relatedContentId: activeSparkId,
          relatedContentType: 'spark'
        };
      }
      case 'video': {
        const activeVideoId =
          videoId || (videosList[0]?.id) || 'daily-motivation';
        return {
          type: 'video',
          route: `videos/videos/${activeVideoId}`,
          relatedContentId: activeVideoId,
          relatedContentType: 'video'
        };
      }
      case 'audio': {
        const activeAudioId =
          audioId || (audiosList[0]?.id) || 'morning-calm';
        return {
          type: 'audio',
          route: `audios/audios/${activeAudioId}`,
          relatedContentId: activeAudioId,
          relatedContentType: 'audio'
        };
      }
      case 'vip':
        return {
          type: 'vip',
          route: 'vip-pass',
          relatedContentId: null,
          relatedContentType: null
        };
      default:
        return {
          type: 'general',
          route: 'today',
          relatedContentId: null,
          relatedContentType: null
        };
    }
  };

  // Load profiles and content catalogs when modal opens
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

    const loadContentData = async () => {
      try {
        const [sparksRes, vidsRes, audsRes] = await Promise.allSettled([
          fetchSparks(),
          fetchVideos(),
          fetchAudios()
        ]);

        if (sparksRes.status === 'fulfilled' && Array.isArray(sparksRes.value) && sparksRes.value.length > 0) {
          setSparksList(sparksRes.value);
          setSelectedSparkId((prev) => prev || sparksRes.value[0].id || sparksRes.value[0].slug);
        }

        const resolvedVideos =
          vidsRes.status === 'fulfilled' && Array.isArray(vidsRes.value) && vidsRes.value.length > 0
            ? vidsRes.value
            : Object.values(VIDEOS);
        setVideosList(resolvedVideos);
        setSelectedVideoId((prev) => prev || resolvedVideos[0]?.id || '');

        const resolvedAudios =
          audsRes.status === 'fulfilled' && Array.isArray(audsRes.value) && audsRes.value.length > 0
            ? audsRes.value
            : ALL_AUDIOS;
        setAudiosList(resolvedAudios);
        setSelectedAudioId((prev) => prev || resolvedAudios[0]?.id || '');
      } catch (err) {
        console.warn('[AdminNotif] Error loading content lists:', err);
      }
    };

    loadProfiles();
    loadContentData();
  }, [isOpen, selectedUserId]);

  if (!isOpen) return null;

  // Quick Preset Templates
  const handleApplyTemplate = (tpl) => {
    if (tpl === 'spark') {
      setTitle("Today's Spark is Ready");
      setMessage("Begin your morning pause with 'Focused Believing'.");
      setTapAction('today');
    } else if (tpl === 'vip') {
      setTitle("Exclusive VIP Sanctuary Release");
      setMessage("Explore the new masterclass video contemplation now.");
      setTapAction('vip');
    } else if (tpl === 'streak') {
      setTitle("7-Day Stillness Streak!");
      setMessage("You've returned to your pause practice 7 days in a row.");
      setTapAction('inbox');
    } else if (tpl === 'audio') {
      setTitle("New Evening Soundscape Available");
      setMessage("Deepen your evening wind-down with guided breath.");
      setTapAction('audio');
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

      // Compute mapped payload automatically
      const mapped = getMappedPayload();

      // Step 1: Save Authoritative Notification Record to Supabase
      let createdNotifRecord = null;
      if (targetUser) {
        const notifRes = await createNotification({
          userId: targetUser,
          title: title.trim(),
          message: message.trim(),
          type: mapped.type,
          relatedContentId: mapped.relatedContentId,
          relatedContentType: mapped.relatedContentType,
          route: mapped.route,
          dispatchPush: false // Triggered explicitly below for telemetry
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
        type: mapped.type,
        relatedContentId: mapped.relatedContentId,
        relatedContentType: mapped.relatedContentType,
        route: mapped.route,
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

  const currentMapped = getMappedPayload();

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

          {/* Tap Action / Destination Selector */}
          <div className="admin-form-group">
            <label className="admin-form-label font-label-md" htmlFor="admin-tap-action-select">
              Tap Action / Destination
            </label>
            <select
              id="admin-tap-action-select"
              className="admin-form-select"
              value={tapAction}
              onChange={(e) => setTapAction(e.target.value)}
            >
              <option value="inbox">General App / Inbox</option>
              <option value="today">Today Screen</option>
              <option value="spark">Specific Spark</option>
              <option value="video">Specific Video</option>
              <option value="audio">Specific Audio</option>
              <option value="vip">VIP Pass Page</option>
            </select>
          </div>

          {/* Dynamic Target Item Selector */}
          {tapAction === 'spark' && (
            <div className="admin-form-group animate-fade-in">
              <label className="admin-form-label font-label-md" htmlFor="admin-select-spark">
                Target Spark
              </label>
              <select
                id="admin-select-spark"
                className="admin-form-select"
                value={selectedSparkId}
                onChange={(e) => setSelectedSparkId(e.target.value)}
              >
                {sparksList.length > 0 ? (
                  sparksList.map((s) => (
                    <option key={s.id || s.slug} value={s.id || s.slug}>
                      {s.title} ({s.id || s.slug})
                    </option>
                  ))
                ) : (
                  <option value="focused-believing">Focused Believing (focused-believing)</option>
                )}
              </select>
            </div>
          )}

          {tapAction === 'video' && (
            <div className="admin-form-group animate-fade-in">
              <label className="admin-form-label font-label-md" htmlFor="admin-select-video">
                Target Video
              </label>
              <select
                id="admin-select-video"
                className="admin-form-select"
                value={selectedVideoId}
                onChange={(e) => setSelectedVideoId(e.target.value)}
              >
                {videosList.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.title} ({v.id})
                  </option>
                ))}
              </select>
            </div>
          )}

          {tapAction === 'audio' && (
            <div className="admin-form-group animate-fade-in">
              <label className="admin-form-label font-label-md" htmlFor="admin-select-audio">
                Target Audio
              </label>
              <select
                id="admin-select-audio"
                className="admin-form-select"
                value={selectedAudioId}
                onChange={(e) => setSelectedAudioId(e.target.value)}
              >
                {audiosList.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title} ({a.id})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Auto-Generated Payload Mapping Card */}
          <div className="admin-payload-preview">
            <div className="admin-payload-preview-header">
              <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#ffc67d' }}>
                tune
              </span>
              <span className="font-label-sm" style={{ color: '#ffc67d', fontWeight: 600 }}>
                Auto-Mapped Push Payload
              </span>
            </div>
            <div className="admin-payload-grid font-body-sm">
              <div className="admin-payload-item">
                <span className="admin-payload-key">type:</span>
                <code className="admin-payload-val">{currentMapped.type}</code>
              </div>
              <div className="admin-payload-item">
                <span className="admin-payload-key">route:</span>
                <code className="admin-payload-val">{currentMapped.route}</code>
              </div>
              <div className="admin-payload-item">
                <span className="admin-payload-key">relatedContentType:</span>
                <code className="admin-payload-val">{currentMapped.relatedContentType || 'null'}</code>
              </div>
              <div className="admin-payload-item">
                <span className="admin-payload-key">relatedContentId:</span>
                <code className="admin-payload-val">{currentMapped.relatedContentId || 'null'}</code>
              </div>
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
