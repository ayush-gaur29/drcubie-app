import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useSparks } from '../../context/SparksContext';
import { useAuth } from '../../context/AuthContext';
import { useAudio } from '../../context/AudioContext';
import { AuthForm } from '../../components/Auth/AuthForm';
import { ImageWithFallback } from '../../components/Common/ImageWithFallback';
import { uploadUserAvatar, removeUserAvatar, validateAvatarFile } from '../../services/avatarService';
import { fetchUserActivityStats } from '../../services/activityService';
import {
  getUserPreferences,
  saveUserPreferences,
  getDeliveryTimeLabel,
  getSpeedLabel,
  fetchAvailableTopics
} from '../../services/userPreferencesService';
import {
  getTotalOfflineStorage,
  getTotalOfflineStorageAsync,
  getOfflineMediaBlob,
  removeOfflineDownload,
  clearAllOfflineDownloads
} from '../../services/offlineStorageService';
import {
  fetchActiveUserMembership,
  subscribeToUserMemberships,
  formatMembershipDate
} from '../../services/membershipsService';
import { VideoPlayer } from '../../components/VideoPlayer/VideoPlayer';
import { BrandedLoader } from '../../components/Common/AppLoader';
import {
  checkPushPermission,
  requestPushPermission,
  registerPushTokenInSupabase,
  deactivatePushTokenInSupabase,
  isNativePlatform
} from '../../services/pushNotificationService';
import { PushNotifications } from '@capacitor/push-notifications';
import './Profile.css';

export const Profile = () => {
  const { showToast } = useSparks();
  const {
    user,
    profile,
    isAuthenticated,
    loading,
    signOut,
    updateProfileAvatar,
    updateProfileName
  } = useAuth();

  const { playbackSpeed, cycleSpeed, changeSpeed, playTrack } = useAudio();

  // Hidden native file input ref
  const fileInputRef = useRef(null);

  // Avatar upload & preview states
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  // Name editing states
  const [editNameInput, setEditNameInput] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const [editNameError, setEditNameError] = useState(null);

  // Derive dynamic user details from Supabase Auth & Profile
  const displayName = profile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Friend';
  const displayEmail = profile?.email || user?.email || '';
  const displayAvatar = profile?.avatar_url || null;
  const isVip = Boolean(profile?.is_vip);

  // Dynamic active membership from Supabase
  const [userMembership, setUserMembership] = useState(null);

  useEffect(() => {
    let mounted = true;
    if (user?.id) {
      fetchActiveUserMembership(user.id)
        .then((res) => {
          if (mounted) setUserMembership(res);
        })
        .catch(() => {});

      const sub = subscribeToUserMemberships(user.id, () => {
        if (mounted) {
          fetchActiveUserMembership(user.id)
            .then((res) => {
              if (mounted) setUserMembership(res);
            })
            .catch(() => {});
        }
      });

      return () => {
        mounted = false;
        sub?.unsubscribe();
      };
    } else {
      setUserMembership(null);
    }
  }, [user?.id, profile?.is_vip]);

  const membershipText = isVip
    ? `VIP Sanctuary Pass • ${userMembership?.plan?.name || 'Active'}`
    : 'Standard Member • Free Tier';

  // Dynamic user content / activity stats from Supabase
  const [userStats, setUserStats] = useState({
    streakDays: 0,
    sparksDone: 0,
    mindfulAudioHours: '0.0h',
    loading: true
  });

  // Dynamic user preferences (Delivery time, topics, etc.)
  const [userPrefs, setUserPrefs] = useState(() => getUserPreferences(user?.id, user?.user_metadata));

  // Dynamic available topics from Supabase
  const [availableTopics, setAvailableTopics] = useState([]);
  const [selectedTopics, setSelectedTopics] = useState([]);
  const [isSavingTopics, setIsSavingTopics] = useState(false);

  // Dynamic offline downloads storage stats
  const [offlineStats, setOfflineStats] = useState(() => getTotalOfflineStorage(user?.id));
  const [activeOfflineVideo, setActiveOfflineVideo] = useState(null);
  const [loadingOfflineMediaId, setLoadingOfflineMediaId] = useState(null);

  // Active dialog state
  const [activeDialog, setActiveDialog] = useState(null);
  // 'avatar-view' | 'avatar-preview' | 'edit-name' | 'delivery' | 'speed' | 'topics' | 'offline' | 'vip' | 'about' | 'privacy' | 'signout' | null

  // Touch and wheel tracking to allow the background page to scroll while modal card remains fixed in viewport
  const touchStartYRef = useRef(null);
  const isDraggingRef = useRef(false);

  const handleBackdropTouchStart = (e) => {
    if (e.target === e.currentTarget) {
      touchStartYRef.current = e.touches[0].clientY;
      isDraggingRef.current = false;
    }
  };

  const handleBackdropTouchMove = (e) => {
    if (e.target === e.currentTarget && touchStartYRef.current !== null) {
      const currentY = e.touches[0].clientY;
      const deltaY = touchStartYRef.current - currentY;
      if (Math.abs(deltaY) > 2) {
        isDraggingRef.current = true;
        window.scrollBy({ top: deltaY, behavior: 'auto' });
        touchStartYRef.current = currentY;
      }
    }
  };

  const handleBackdropTouchEnd = () => {
    touchStartYRef.current = null;
  };

  const handleBackdropWheel = (e) => {
    if (e.target === e.currentTarget) {
      window.scrollBy({ top: e.deltaY, behavior: 'auto' });
    }
  };

  const handleBackdropClick = () => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      return;
    }
    if (isUploading || isSavingName || isSavingTopics) return;
    if (activeDialog === 'avatar-preview') {
      handleCancelPreview();
    } else {
      setActiveDialog(null);
    }
  };

  // Close modal on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && activeDialog) {
        if (isUploading || isSavingName || isSavingTopics) return;
        if (activeDialog === 'avatar-preview') {
          handleCancelPreview();
        } else {
          setActiveDialog(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeDialog, isUploading, isSavingName, isSavingTopics]);

  // 1. Fetch real user activity statistics from Supabase content_activity
  useEffect(() => {
    let mounted = true;
    if (user?.id) {
      fetchUserActivityStats(user.id)
        .then((stats) => {
          if (mounted) {
            setUserStats({
              streakDays: stats.streakDays,
              sparksDone: stats.sparksDone,
              mindfulAudioHours: stats.mindfulAudioHours,
              loading: false
            });
          }
        })
        .catch((err) => {
          console.warn('[Profile] Error loading user stats:', err);
          if (mounted) {
            setUserStats((prev) => ({ ...prev, loading: false }));
          }
        });
    }
    return () => {
      mounted = false;
    };
  }, [user?.id]);

  // 2. Load and synchronize user preferences
  useEffect(() => {
    if (user?.id) {
      setUserPrefs(getUserPreferences(user.id, user.user_metadata));
    }
  }, [user?.id, user?.user_metadata]);

  useEffect(() => {
    const handlePrefChange = (e) => {
      if (e.detail?.preferences) {
        setUserPrefs(e.detail.preferences);
      }
    };
    window.addEventListener('drcubie_preferences_updated', handlePrefChange);
    return () => window.removeEventListener('drcubie_preferences_updated', handlePrefChange);
  }, []);

  // 3. Load available topics dynamically from Supabase
  useEffect(() => {
    let mounted = true;
    fetchAvailableTopics().then((topics) => {
      if (mounted) {
        setAvailableTopics(topics);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  // 4. Track offline downloads for VIP user (Authoritative from IndexedDB)
  useEffect(() => {
    let mounted = true;
    if (user?.id) {
      getTotalOfflineStorageAsync(user.id).then((stats) => {
        if (mounted) setOfflineStats(stats);
      });
    } else {
      setOfflineStats({ items: [], count: 0, playableCount: 0, totalBytes: 0, formattedSize: '0 B' });
    }
    return () => {
      mounted = false;
    };
  }, [user?.id]);

  useEffect(() => {
    let mounted = true;
    const handleOfflineChange = () => {
      if (user?.id) {
        getTotalOfflineStorageAsync(user.id).then((stats) => {
          if (mounted) setOfflineStats(stats);
        });
      }
    };
    window.addEventListener('drcubie_offline_updated', handleOfflineChange);
    return () => {
      mounted = false;
      window.removeEventListener('drcubie_offline_updated', handleOfflineChange);
    };
  }, [user?.id]);

  // Clean up active offline video Blob URL on player close or unmount
  useEffect(() => {
    return () => {
      if (activeOfflineVideo?.blobUrl) {
        try {
          URL.revokeObjectURL(activeOfflineVideo.blobUrl);
        } catch {}
      }
    };
  }, [activeOfflineVideo]);

  const deliveryTime = userPrefs.dailyDeliveryTime || '07:00 AM';
  const deliveryTimeLabel = userPrefs.deliveryTimeLabel || getDeliveryTimeLabel(deliveryTime);
  const preferredTopicsList = Array.isArray(userPrefs.preferredTopics) ? userPrefs.preferredTopics : [];
  const preferredTopicsDisplay = preferredTopicsList.length > 0 ? preferredTopicsList.join(', ') : 'None selected';

  // Push Notification permission state
  const [pushStatus, setPushStatus] = useState('prompt'); // 'granted' | 'denied' | 'prompt'
  const [isTogglingPush, setIsTogglingPush] = useState(false);

  useEffect(() => {
    checkPushPermission().then((status) => {
      setPushStatus(status);
    });
  }, []);

  const handleTogglePush = async () => {
    if (isTogglingPush) return;
    setIsTogglingPush(true);

    try {
      if (pushStatus === 'granted') {
        await deactivatePushTokenInSupabase(user?.id);
        setPushStatus('prompt');
        if (showToast) showToast('Push notifications paused.');
      } else {
        const perm = await requestPushPermission();
        setPushStatus(perm);
        if (perm === 'granted') {
          if (isNativePlatform()) {
            await PushNotifications.register();
          } else if (user?.id) {
            await registerPushTokenInSupabase(user.id, `web_push_${user.id.slice(0, 8)}_${Date.now()}`);
          }
          if (showToast) showToast('Push notifications enabled!');
        } else if (perm === 'denied') {
          setActiveDialog('push-permission');
        }
      }
    } catch (err) {
      console.warn('[Profile] Error toggling push notifications:', err);
    } finally {
      setIsTogglingPush(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      showToast('Signed out securely. Session closed.');
      setActiveDialog(null);
    } catch (err) {
      showToast('Failed to sign out. Please try again.');
    }
  };

  /**
   * Triggers native file selection dialog
   */
  const handleTriggerFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  /**
   * Validates and loads selected image for preview
   */
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validation = validateAvatarFile(file);
    if (!validation.valid) {
      showToast(validation.error);
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    const objectUrl = URL.createObjectURL(file);
    setSelectedFile(file);
    setPreviewUrl(objectUrl);
    setUploadError(null);
    setActiveDialog('avatar-preview');
  };

  /**
   * Cancels avatar preview and resets state
   */
  const handleCancelPreview = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(null);
    setPreviewUrl(null);
    setUploadError(null);
    setActiveDialog(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  /**
   * Confirms upload to Supabase Storage and updates profiles.avatar_url
   */
  const handleConfirmUpload = async () => {
    if (!selectedFile || !user?.id) {
      showToast('Please select a valid image file first.');
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    try {
      const { publicUrl } = await uploadUserAvatar({
        userId: user.id,
        file: selectedFile
      });

      updateProfileAvatar(publicUrl);
      showToast('Profile photo updated successfully.');

      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      setSelectedFile(null);
      setPreviewUrl(null);
      setActiveDialog(null);
    } catch (err) {
      console.error('Avatar update failed:', err);
      const msg = err.message || 'Failed to update profile photo. Please try again.';
      setUploadError(msg);
      showToast(msg);
    } finally {
      setIsUploading(false);
    }
  };

  /**
   * Removes custom profile picture and restores neutral default
   */
  const handleRemovePhoto = async () => {
    if (!user?.id) return;
    setIsUploading(true);
    try {
      await removeUserAvatar(user.id);
      updateProfileAvatar(null);
      showToast('Profile photo removed. Default avatar restored.');
      handleCancelPreview();
    } catch (err) {
      console.error('Avatar removal failed:', err);
      showToast(err.message || 'Failed to remove profile photo.');
    } finally {
      setIsUploading(false);
    }
  };

  /**
   * Persists updated profile name to Supabase
   */
  const handleSaveName = async (e) => {
    if (e) e.preventDefault();
    const trimmed = (editNameInput || '').trim();
    if (!trimmed) {
      setEditNameError('Please enter your name.');
      return;
    }

    setIsSavingName(true);
    setEditNameError(null);

    try {
      await updateProfileName(trimmed);
      showToast('Profile name updated successfully.');
      setActiveDialog(null);
    } catch (err) {
      console.error('[Profile] Name update error:', err);
      const msg = err.message || 'Failed to update profile name.';
      setEditNameError(msg);
      showToast(msg);
    } finally {
      setIsSavingName(false);
    }
  };

  /**
   * Updates delivery time preference
   */
  const handleSelectDeliveryTime = async (time) => {
    try {
      await saveUserPreferences(user?.id, { dailyDeliveryTime: time });
      showToast(`Daily Spark delivery time set to ${time}`);
      setActiveDialog(null);
    } catch (err) {
      console.warn('[Profile] Error saving delivery time:', err);
    }
  };

  /**
   * Opens topics dialog and dynamically refreshes available topics from Supabase
   */
  const handleOpenTopicsDialog = async () => {
    try {
      const dynamicTopics = await fetchAvailableTopics();
      setAvailableTopics(dynamicTopics);
    } catch (err) {
      console.warn('[Profile] Error refreshing dynamic topics:', err);
    }
    setSelectedTopics([...preferredTopicsList]);
    setActiveDialog('topics');
  };

  /**
   * Toggles a topic in the selection modal
   */
  const handleToggleTopic = (topic) => {
    setSelectedTopics((prev) =>
      prev.includes(topic) ? prev.filter((t) => t !== topic) : [...prev, topic]
    );
  };

  /**
   * Saves updated preferred topics to Supabase
   */
  const handleSaveTopics = async () => {
    setIsSavingTopics(true);
    try {
      await saveUserPreferences(user?.id, { preferredTopics: selectedTopics });
      showToast('Preferred topics updated.');
      setActiveDialog(null);
    } catch (err) {
      console.warn('[Profile] Error saving topics:', err);
      showToast('Failed to save preferred topics.');
    } finally {
      setIsSavingTopics(false);
    }
  };

  /**
   * Plays a downloaded offline media item directly from browser IndexedDB
   */
  const handlePlayOfflineItem = async (item) => {
    if (!item) return;

    if (item.isPlayableOffline === false) {
      showToast('This item has incomplete offline data. Please re-download while online.');
      return;
    }

    setLoadingOfflineMediaId(item.id);

    try {
      const blob = await getOfflineMediaBlob(user?.id, item.id);
      if (!blob) {
        showToast('Media file not found in local offline storage. Please re-download while online.');
        return;
      }

      const blobUrl = URL.createObjectURL(blob);

      if (item.type === 'video') {
        if (activeOfflineVideo?.blobUrl) {
          try { URL.revokeObjectURL(activeOfflineVideo.blobUrl); } catch {}
        }
        setActiveOfflineVideo({
          ...item,
          blobUrl
        });
        showToast(`Playing offline video: ${item.title}`);
      } else {
        // Audio
        await playTrack({
          id: item.id,
          db_id: item.id,
          title: item.title,
          category: item.category || 'Mindfulness',
          thumbnailUrl: item.thumbnailUrl,
          audioUrl: blobUrl,
          isOffline: true
        });
        showToast(`Playing offline audio: ${item.title}`);
      }
    } catch (err) {
      console.error('[Profile] Error playing offline media:', err);
      showToast('Could not play offline media.');
    } finally {
      setLoadingOfflineMediaId(null);
    }
  };

  /**
   * Closes active offline video player and cleans up Object URL
   */
  const handleCloseOfflineVideo = () => {
    if (activeOfflineVideo?.blobUrl) {
      try {
        URL.revokeObjectURL(activeOfflineVideo.blobUrl);
      } catch (err) {
        console.warn('[Profile] Error revoking video blob URL:', err);
      }
    }
    setActiveOfflineVideo(null);
  };

  /**
   * Removes an offline download item from local storage & IndexedDB
   */
  const handleRemoveOfflineItem = async (id) => {
    if (!user?.id) return;
    try {
      if (activeOfflineVideo?.id === id) {
        handleCloseOfflineVideo();
      }
      await removeOfflineDownload(user.id, id);
      const updated = await getTotalOfflineStorageAsync(user.id);
      setOfflineStats(updated);
      showToast('Downloaded item removed from local storage.');
    } catch (err) {
      console.warn('[Profile] Error removing offline item:', err);
      showToast('Failed to remove download.');
    }
  };

  /**
   * Clears all offline downloads for the current user
   */
  const handleClearAllOffline = async () => {
    if (!user?.id) return;
    try {
      handleCloseOfflineVideo();
      await clearAllOfflineDownloads(user.id);
      const updated = await getTotalOfflineStorageAsync(user.id);
      setOfflineStats(updated);
      showToast('All offline downloads removed from this device.');
    } catch (err) {
      console.warn('[Profile] Error clearing offline downloads:', err);
      showToast('Failed to clear downloads.');
    }
  };

  // While checking initial session, display calm branded loading state
  if (loading) {
    return (
      <div className="profile-screen animate-fade-in" style={{ padding: '40px 16px', textAlign: 'center' }}>
        <BrandedLoader
          variant="contained"
          message="Accessing your contemplative sanctuary..."
        />
      </div>
    );
  }

  // If unauthenticated, render the clean Auth Form directly on the page background
  if (!isAuthenticated) {
    return (
      <div className="profile-screen profile-auth-screen animate-fade-in">
        <AuthForm initialMode="signin" />
      </div>
    );
  }

  return (
    <div className="profile-screen animate-fade-in">
      {/* 1. Profile Identity Header Card */}
      <section className="profile-hero-card" aria-label="User Profile">
        {/* Hidden native file input for profile image selection */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={handleFileSelect}
          aria-hidden="true"
        />

        <div className="profile-avatar-wrap">
          <div
            className="profile-avatar-circle profile-avatar-interactive btn-pressable"
            onClick={() => setActiveDialog('avatar-view')}
            title="Click to view profile picture"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setActiveDialog('avatar-view');
              }
            }}
            aria-label="View profile photo"
          >
            <ImageWithFallback
              src={displayAvatar}
              fallbackSrc={null}
              type="avatar"
              alt={displayName}
              className="profile-avatar-img-lg"
            />
          </div>
          <button
            className="profile-camera-btn btn-pressable"
            onClick={handleTriggerFileInput}
            aria-label="Change profile photo"
            type="button"
            title="Change profile photo"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
              photo_camera
            </span>
          </button>
        </div>

        {/* Dynamic Display Name with Edit Option */}
        <div className="profile-name-row">
          <h1 className="profile-name font-headline-md">
            {displayName}
          </h1>
          <button
            type="button"
            className="profile-edit-name-btn btn-pressable"
            onClick={() => {
              setEditNameInput(displayName);
              setEditNameError(null);
              setActiveDialog('edit-name');
            }}
            title="Edit name"
            aria-label="Edit name"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
              edit
            </span>
          </button>
        </div>

        <p className="profile-email font-body-md">
          {displayEmail}
        </p>

        <div className="profile-vip-pill font-label-sm">
          <span className="material-symbols-outlined" style={{ fontSize: '16px', fontVariationSettings: "'FILL' 1" }}>
            {isVip ? 'verified' : 'account_circle'}
          </span>
          <span>{membershipText}</span>
        </div>
      </section>

      {/* 2. Practice & Streak Stats (Dynamic from Supabase content_activity) */}
      <section className="profile-stats-grid" aria-label="Practice Statistics">
        {/* Streak */}
        <div className="profile-stat-box">
          <div className="profile-stat-top">
            <span className="material-symbols-outlined" style={{ fontSize: '18px', fontVariationSettings: "'FILL' 1" }}>
              local_fire_department
            </span>
            <span className="profile-stat-number font-title-md">
              {userStats.streakDays}
            </span>
          </div>
          <span className="profile-stat-label font-label-sm">
            Days Streak
          </span>
        </div>

        {/* Sparks Done */}
        <div className="profile-stat-box">
          <div className="profile-stat-top">
            <span className="material-symbols-outlined" style={{ fontSize: '18px', fontVariationSettings: "'FILL' 1" }}>
              auto_awesome
            </span>
            <span className="profile-stat-number font-title-md">
              {userStats.sparksDone}
            </span>
          </div>
          <span className="profile-stat-label font-label-sm">
            Sparks Done
          </span>
        </div>

        {/* Mindful Audio */}
        <div className="profile-stat-box">
          <div className="profile-stat-top">
            <span className="material-symbols-outlined" style={{ fontSize: '18px', fontVariationSettings: "'FILL' 1" }}>
              headphones
            </span>
            <span className="profile-stat-number font-title-md">
              {userStats.mindfulAudioHours}
            </span>
          </div>
          <span className="profile-stat-label font-label-sm">
            Mindful Audio
          </span>
        </div>
      </section>

      {/* 3. Group 1: Inspiration Preferences */}
      <section className="profile-group-section" aria-label="Inspiration Preferences">
        <h2 className="profile-group-heading font-label-md">
          Inspiration Preferences
        </h2>

        <div className="profile-list-container">
          {/* Row 1: Delivery Time */}
          <button
            className="profile-row-item btn-pressable"
            onClick={() => setActiveDialog('delivery')}
            type="button"
          >
            <div className="profile-row-left">
              <div className="profile-row-icon-circle">
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                  alarm
                </span>
              </div>
              <div className="profile-row-text">
                <span className="profile-row-title font-body-md">Daily Spark Delivery Time</span>
                <span className="profile-row-sub font-label-sm">{deliveryTimeLabel}</span>
              </div>
            </div>

            <div className="profile-row-right">
              <span className="profile-row-val font-label-md">{deliveryTime}</span>
              <span className="material-symbols-outlined profile-row-chevron">chevron_right</span>
            </div>
          </button>

          <div className="profile-divider" />

          {/* Row 2: Audio Speed (Synchronized with Audio Player) */}
          <button
            className="profile-row-item btn-pressable"
            onClick={cycleSpeed}
            type="button"
          >
            <div className="profile-row-left">
              <div className="profile-row-icon-circle">
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                  speed
                </span>
              </div>
              <div className="profile-row-text">
                <span className="profile-row-title font-body-md">Audio Playback Speed</span>
                <span className="profile-row-sub font-label-sm">{getSpeedLabel(playbackSpeed)}</span>
              </div>
            </div>

            <div className="profile-row-right">
              <span className="profile-row-val font-label-md">{playbackSpeed.toFixed(1)}x</span>
              <span className="material-symbols-outlined profile-row-chevron">chevron_right</span>
            </div>
          </button>

          <div className="profile-divider" />

          {/* Row 3: Preferred Topics (Loaded dynamically from Supabase) */}
          <button
            className="profile-row-item btn-pressable"
            onClick={handleOpenTopicsDialog}
            type="button"
          >
            <div className="profile-row-left">
              <div className="profile-row-icon-circle">
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                  interests
                </span>
              </div>
              <div className="profile-row-text">
                <span className="profile-row-title font-body-md">Preferred Topics</span>
                <span className="profile-row-sub font-label-sm">{preferredTopicsDisplay}</span>
              </div>
            </div>

            <div className="profile-row-right">
              {preferredTopicsList.length > 0 && (
                <div className="profile-topics-pill-row">
                  {preferredTopicsList.slice(0, 2).map((t) => (
                    <span key={t} className="profile-topic-pill-preview">
                      {t}
                    </span>
                  ))}
                  {preferredTopicsList.length > 2 && (
                    <span className="profile-topic-pill-preview count">
                      +{preferredTopicsList.length - 2}
                    </span>
                  )}
                </div>
              )}
              <span className="material-symbols-outlined profile-row-chevron">chevron_right</span>
            </div>
          </button>

          <div className="profile-divider" />

          {/* Row 4: Push Notifications */}
          <div className="profile-row-item">
            <div className="profile-row-left">
              <div className="profile-row-icon-circle">
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                  notifications_active
                </span>
              </div>
              <div className="profile-row-text">
                <span className="profile-row-title font-body-md">Push Notifications</span>
                <span className="profile-row-sub font-label-sm">
                  {pushStatus === 'granted'
                    ? 'Active • Daily inspirations & reflections'
                    : pushStatus === 'denied'
                    ? 'Disabled in device settings'
                    : 'Receive daily inspirations & streaks'}
                </span>
              </div>
            </div>

            <div className="profile-row-right">
              {pushStatus === 'denied' ? (
                <button
                  type="button"
                  className="profile-fix-perm-btn btn-pressable font-label-sm"
                  onClick={() => setActiveDialog('push-permission')}
                >
                  Enable in Settings
                </button>
              ) : (
                <button
                  type="button"
                  className={`profile-toggle-switch ${pushStatus === 'granted' ? 'active' : ''}`}
                  onClick={handleTogglePush}
                  aria-label="Toggle push notifications"
                  disabled={isTogglingPush}
                >
                  <div className="profile-toggle-thumb" />
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 4. Group 2: Account & Membership */}
      <section className="profile-group-section" aria-label="Account & Membership">
        <h2 className="profile-group-heading font-label-md">
          Account &amp; Membership
        </h2>

        <div className="profile-list-container">
          {/* Row 1: Manage VIP */}
          <button
            className="profile-row-item btn-pressable"
            onClick={() => setActiveDialog('vip')}
            type="button"
          >
            <div className="profile-row-left">
              <div className="profile-row-icon-circle">
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                  credit_card
                </span>
              </div>
              <div className="profile-row-text">
                <span className="profile-row-title font-body-md">Manage VIP Subscription</span>
                <span className="profile-row-sub font-label-sm">
                  {isVip ? 'VIP Sanctuary Pass • Active' : 'Standard Tier • Upgrade anytime'}
                </span>
              </div>
            </div>

            <div className="profile-row-right">
              <span className="profile-status-pill font-label-sm">
                {isVip ? 'Active' : 'Standard'}
              </span>
              <span className="material-symbols-outlined profile-row-chevron">chevron_right</span>
            </div>
          </button>

          <div className="profile-divider" />

          {/* Row 2: Offline Downloads (Dynamic for VIP; Unavailable for Non-VIP) */}
          <button
            className="profile-row-item btn-pressable"
            onClick={() => setActiveDialog('offline')}
            type="button"
          >
            <div className="profile-row-left">
              <div className="profile-row-icon-circle">
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                  cloud_download
                </span>
              </div>
              <div className="profile-row-text">
                <span className="profile-row-title font-body-md">Offline Downloads</span>
                <span className="profile-row-sub font-label-sm">
                  {isVip
                    ? `${offlineStats.count} item${offlineStats.count === 1 ? '' : 's'} • ${offlineStats.formattedSize} stored offline`
                    : 'VIP Sanctuary Pass required • Unavailable'}
                </span>
              </div>
            </div>

            <div className="profile-row-right">
              {!isVip && (
                <span className="profile-status-pill font-label-sm" style={{ opacity: 0.85 }}>
                  VIP Only
                </span>
              )}
              {isVip && (
                <span className="profile-row-val font-label-md">
                  {offlineStats.formattedSize}
                </span>
              )}
              <span className="material-symbols-outlined profile-row-chevron">chevron_right</span>
            </div>
          </button>

          {/* Row 3 (Admin Only): Admin Push Notification Console */}
          {profile?.role === 'admin' && (
            <>
              <div className="profile-divider" />
              <button
                className="profile-row-item btn-pressable"
                onClick={() => window.dispatchEvent(new CustomEvent('drcubie_open_admin_notifications'))}
                type="button"
                id="btn-open-admin-notif-console"
              >
                <div className="profile-row-left">
                  <div className="profile-row-icon-circle" style={{ background: 'rgba(229, 169, 90, 0.2)', color: '#ffc67d' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                      campaign
                    </span>
                  </div>
                  <div className="profile-row-text">
                    <span className="profile-row-title font-body-md">Admin Push Notification Console</span>
                    <span className="profile-row-sub font-label-sm">
                      Send &amp; broadcast notifications to users
                    </span>
                  </div>
                </div>

                <div className="profile-row-right">
                  <span className="profile-status-pill font-label-sm" style={{ background: 'rgba(229, 169, 90, 0.2)', color: '#ffc67d' }}>
                    Admin
                  </span>
                  <span className="material-symbols-outlined profile-row-chevron">chevron_right</span>
                </div>
              </button>
            </>
          )}
        </div>
      </section>

      {/* 5. Group 3: Support & Legal */}
      <section className="profile-group-section" aria-label="Support & Legal">
        <h2 className="profile-group-heading font-label-md">
          Support &amp; Legal
        </h2>

        <div className="profile-list-container">
          {/* Row 1: About */}
          <button
            className="profile-row-item btn-pressable"
            onClick={() => setActiveDialog('about')}
            type="button"
          >
            <div className="profile-row-left">
              <div className="profile-row-icon-circle">
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                  school
                </span>
              </div>
              <div className="profile-row-text">
                <span className="profile-row-title font-body-md">About Dr. Cubie &amp; Team</span>
                <span className="profile-row-sub font-label-sm">Philosophy, vision &amp; research</span>
              </div>
            </div>

            <div className="profile-row-right">
              <span className="material-symbols-outlined profile-row-chevron">chevron_right</span>
            </div>
          </button>

          <div className="profile-divider" />

          {/* Row 2: Privacy */}
          <button
            className="profile-row-item btn-pressable"
            onClick={() => setActiveDialog('privacy')}
            type="button"
          >
            <div className="profile-row-left">
              <div className="profile-row-icon-circle">
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                  policy
                </span>
              </div>
              <div className="profile-row-text">
                <span className="profile-row-title font-body-md">Privacy Policy &amp; Terms</span>
                <span className="profile-row-sub font-label-sm">Data transparency</span>
              </div>
            </div>

            <div className="profile-row-right">
              <span className="material-symbols-outlined profile-row-chevron">chevron_right</span>
            </div>
          </button>

          <div className="profile-divider" />

          {/* Row 3: Sign Out */}
          <button
            className="profile-row-item btn-pressable"
            onClick={() => setActiveDialog('signout')}
            type="button"
          >
            <div className="profile-row-left">
              <div className="profile-row-icon-circle signout">
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                  logout
                </span>
              </div>
              <div className="profile-row-text">
                <span className="profile-row-title font-body-md" style={{ color: 'var(--color-error)' }}>
                  Sign Out
                </span>
                <span className="profile-row-sub font-label-sm">Session saved to cloud</span>
              </div>
            </div>

            <div className="profile-row-right">
              <span className="material-symbols-outlined profile-row-chevron" style={{ color: 'var(--color-error)' }}>
                chevron_right
              </span>
            </div>
          </button>
        </div>
      </section>

      {/* 6. Footer Brand Note */}
      <footer className="profile-footer">
        <div className="profile-footer-icon-circle">
          <ImageWithFallback
            src="/assets/images/brand-logo.png"
            fallbackSrc="https://lh3.googleusercontent.com/aida/AEtjO1VXwfwPa1C6ik_7a14YQlU2VskSqeDobMKZ98zKHrQ2Q1nEyy0ZlXoYmOr2UmBHixyl0w5f9SmG8G7-iZrJUgs_J3WT1aCepQnKDtO71D1XXOYK6BGmWZQWaTH5KmOnim2PkyQbq9zQZS_gw4eepoNxrrnB6kUICMc2CrAzVHTZOn6otp6OGuKYsy9BOMqWhGCoh-E1grwTUD6iorwn6KnH0Yj87FMExfE-MkohdtbeLDetlmQOlzNTYiZp"
            type="logo"
            alt="Dr. Cubie Logo"
            className="profile-footer-logo-img"
          />
        </div>
        <span className="profile-footer-version font-label-sm">
          Dr. Cubie Inspiration • Version 3.4.2
        </span>
        <span className="profile-footer-company font-label-sm">
          Mindful Living Systems Inc.
        </span>
      </footer>

      {/* Interactive Modal Sheet Dialogs — Portaled to document.body so the card stays fixed in the viewport while the background page scrolls */}
      {activeDialog && typeof document !== 'undefined' && createPortal(
        <div
          className={`profile-modal-backdrop animate-backdrop ${activeDialog === 'push-permission' ? 'push-perm-backdrop' : ''}`}
          onClick={handleBackdropClick}
          onWheel={handleBackdropWheel}
          onTouchStart={handleBackdropTouchStart}
          onTouchMove={handleBackdropTouchMove}
          onTouchEnd={handleBackdropTouchEnd}
          role="dialog"
          aria-modal="true"
        >
          <div
            className={`profile-modal-card animate-slide-up ${activeDialog === 'push-permission' ? 'profile-push-perm-card' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* View Current Profile Picture */}
            {activeDialog === 'avatar-view' && (
              <>
                <h3 className="profile-modal-title font-title-md">Profile Picture</h3>
                <p className="profile-modal-desc font-body-md" style={{ marginBottom: '0.5rem' }}>
                  Your sanctuary profile image.
                </p>

                <div className="profile-preview-container">
                  <div className="profile-preview-circle">
                    {displayAvatar ? (
                      <img
                        src={displayAvatar}
                        alt={displayName}
                        className="profile-preview-img"
                      />
                    ) : (
                      <span className="material-symbols-outlined" style={{ fontSize: '56px', color: '#00288E' }}>
                        account_circle
                      </span>
                    )}
                  </div>
                  <span className="font-label-md" style={{ marginTop: '0.75rem', fontWeight: 600 }}>
                    {displayName}
                  </span>
                  <span className="font-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                    {displayEmail}
                  </span>
                </div>

                <div className="profile-modal-actions" style={{ marginTop: '1rem' }}>
                  <button
                    className="profile-modal-action-btn primary btn-pressable"
                    onClick={() => {
                      setActiveDialog(null);
                      handleTriggerFileInput();
                    }}
                    type="button"
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                        photo_camera
                      </span>
                      <span>Change Photo</span>
                    </span>
                  </button>
                  <button
                    className="profile-modal-action-btn secondary btn-pressable"
                    onClick={() => setActiveDialog(null)}
                    type="button"
                  >
                    Close
                  </button>
                </div>

                {displayAvatar && (
                  <div style={{ textAlign: 'center', marginTop: '0.5rem' }}>
                    <button
                      type="button"
                      className="profile-remove-photo-btn font-label-md btn-pressable"
                      onClick={() => {
                        handleRemovePhoto();
                        setActiveDialog(null);
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                        delete
                      </span>
                      <span>Remove photo</span>
                    </button>
                  </div>
                )}
              </>
            )}

            {/* Edit Profile Name Modal */}
            {activeDialog === 'edit-name' && (
              <>
                <h3 className="profile-modal-title font-title-md">Edit Profile Name</h3>
                <p className="profile-modal-desc font-body-md" style={{ marginBottom: '0.75rem' }}>
                  Update your display name. This changes how you are greeted across the sanctuary.
                </p>

                <form onSubmit={handleSaveName}>
                  <input
                    type="text"
                    className="profile-modal-input font-body-md"
                    value={editNameInput}
                    onChange={(e) => setEditNameInput(e.target.value)}
                    placeholder="Enter your name"
                    maxLength={60}
                    autoFocus
                    disabled={isSavingName}
                  />

                  {editNameError && (
                    <div className="profile-upload-error font-body-sm" role="alert" style={{ marginTop: '0.5rem' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                        error
                      </span>
                      <span>{editNameError}</span>
                    </div>
                  )}

                  <div className="profile-modal-actions" style={{ marginTop: '1.25rem' }}>
                    <button
                      type="submit"
                      className="profile-modal-action-btn primary btn-pressable"
                      disabled={isSavingName || !editNameInput.trim()}
                    >
                      {isSavingName ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            className="auth-spinner"
                            style={{
                              width: '16px',
                              height: '16px',
                              borderWidth: '2px',
                              borderColor: 'rgba(255, 255, 255, 0.3)',
                              borderTopColor: '#ffffff'
                            }}
                          />
                          <span>Saving...</span>
                        </span>
                      ) : (
                        <span>Save Name</span>
                      )}
                    </button>
                    <button
                      type="button"
                      className="profile-modal-action-btn secondary btn-pressable"
                      onClick={() => setActiveDialog(null)}
                      disabled={isSavingName}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </>
            )}

            {/* Daily Spark Delivery Time Selection Modal */}
            {activeDialog === 'delivery' && (
              <>
                <h3 className="profile-modal-title font-title-md">Daily Spark Delivery Time</h3>
                <p className="profile-modal-desc font-body-md">
                  Choose your preferred morning reflection window. Your daily wisdom lesson will arrive at this time.
                </p>

                <div className="profile-time-grid">
                  {[
                    '06:00 AM',
                    '06:30 AM',
                    '07:00 AM',
                    '07:30 AM',
                    '08:00 AM',
                    '08:30 AM',
                    '09:00 AM',
                    '09:30 AM'
                  ].map((time) => {
                    const isSelected = deliveryTime === time;
                    return (
                      <button
                        key={time}
                        type="button"
                        className={`profile-time-option btn-pressable ${isSelected ? 'selected' : ''}`}
                        onClick={() => handleSelectDeliveryTime(time)}
                      >
                        {time}
                      </button>
                    );
                  })}
                </div>

                <div className="profile-modal-actions" style={{ marginTop: '0.75rem' }}>
                  <button
                    className="profile-modal-action-btn secondary btn-pressable"
                    onClick={() => setActiveDialog(null)}
                    type="button"
                  >
                    Close
                  </button>
                </div>
              </>
            )}

            {/* Preferred Topics Selection Modal (Dynamic from Supabase) */}
            {activeDialog === 'topics' && (
              <>
                <div className="profile-topics-header-wrap">
                  <div className="profile-topics-header-text">
                    <h3 className="profile-modal-title font-title-md">Preferred Topics</h3>
                    <p className="profile-modal-desc font-body-md">
                      Select the contemplative themes that resonate most with your daily practice.
                    </p>
                  </div>
                  <span className="profile-topics-selected-count font-label-sm">
                    {selectedTopics.length} selected
                  </span>
                </div>

                <div className="profile-topics-grid">
                  {availableTopics.length === 0 ? (
                    <p className="profile-modal-desc font-body-sm" style={{ fontStyle: 'italic', margin: '0.75rem 0' }}>
                      No categories found in the database.
                    </p>
                  ) : (
                    availableTopics.map((topic) => {
                      const isSelected = selectedTopics.includes(topic);
                      return (
                        <button
                          key={topic}
                          type="button"
                          className={`profile-topic-chip btn-pressable ${isSelected ? 'selected' : ''}`}
                          onClick={() => handleToggleTopic(topic)}
                          aria-pressed={isSelected}
                        >
                          <span className="material-symbols-outlined">
                            {isSelected ? 'check_circle' : 'add_circle'}
                          </span>
                          <span className="profile-topic-chip-label">{topic}</span>
                        </button>
                      );
                    })
                  )}
                </div>

                <div className="profile-modal-actions" style={{ marginTop: '1rem' }}>
                  <button
                    className="profile-modal-action-btn primary btn-pressable"
                    onClick={handleSaveTopics}
                    disabled={isSavingTopics}
                    type="button"
                  >
                    {isSavingTopics ? 'Saving...' : 'Save Preferences'}
                  </button>
                  <button
                    className="profile-modal-action-btn secondary btn-pressable"
                    onClick={() => setActiveDialog(null)}
                    disabled={isSavingTopics}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}

            {/* Offline Storage Modal (Dynamic for VIP; Informative for Non-VIP) */}
            {activeDialog === 'offline' && (
              <>
                <h3 className="profile-modal-title font-title-md">
                  {isVip ? 'Offline Storage' : 'Offline Downloads (VIP Exclusive)'}
                </h3>

                {!isVip ? (
                  <>
                    <p className="profile-modal-desc font-body-md">
                      Offline downloads are an exclusive entitlement for VIP Sanctuary members. Standard members can stream all content with an active internet connection.
                    </p>
                    <div className="profile-modal-actions" style={{ marginTop: '1rem' }}>
                      <button
                        className="profile-modal-action-btn primary btn-pressable"
                        onClick={() => {
                          setActiveDialog(null);
                          window.location.hash = '#/vip-pass';
                        }}
                        type="button"
                      >
                        Explore VIP Pass
                      </button>
                      <button
                        className="profile-modal-action-btn secondary btn-pressable"
                        onClick={() => setActiveDialog(null)}
                        type="button"
                      >
                        Close
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="profile-modal-desc font-body-md">
                      {offlineStats.count === 0 ? (
                        <>You currently have no media downloaded for offline listening. Tap the download button on any audio reflection or video masterclass to save it offline.</>
                      ) : (
                        <>You have <strong>{offlineStats.count}</strong> offline item{offlineStats.count === 1 ? '' : 's'} using <strong>{offlineStats.formattedSize}</strong> of storage for uninterrupted contemplation.</>
                      )}
                    </p>

                    {offlineStats.items.length > 0 && (
                      <div className="profile-offline-list">
                        {offlineStats.items.map((item) => (
                          <div
                            key={item.id}
                            className={`profile-offline-item ${item.isPlayableOffline === false ? 'legacy-incomplete' : ''}`}
                          >
                            <div
                              className="profile-offline-item-main btn-pressable"
                              onClick={() => handlePlayOfflineItem(item)}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  handlePlayOfflineItem(item);
                                }
                              }}
                              title={item.isPlayableOffline !== false ? `Play ${item.title} offline` : 'Incomplete offline media'}
                            >
                              <div className="profile-offline-thumb">
                                {item.thumbnailUrl ? (
                                  <img
                                    src={item.thumbnailUrl}
                                    alt={item.title}
                                    className="profile-offline-thumb-img"
                                  />
                                ) : (
                                  <span className="material-symbols-outlined profile-offline-thumb-icon">
                                    {item.type === 'video' ? 'movie' : 'headphones'}
                                  </span>
                                )}
                                <span className="profile-offline-type-tag">
                                  {item.type === 'video' ? 'VID' : 'AUD'}
                                </span>
                              </div>

                              <div className="profile-offline-item-info">
                                <span className="profile-offline-item-title">{item.title}</span>
                                <div className="profile-offline-meta-row font-label-sm">
                                  <span className="profile-offline-size">{item.formattedSize}</span>
                                  {item.downloadedAt && (
                                    <>
                                      <span className="profile-offline-dot">•</span>
                                      <span className="profile-offline-date">
                                        {new Date(item.downloadedAt).toLocaleDateString(undefined, {
                                          month: 'short',
                                          day: 'numeric'
                                        })}
                                      </span>
                                    </>
                                  )}
                                </div>

                                <div className="profile-offline-status-row">
                                  {item.isPlayableOffline !== false ? (
                                    <span className="profile-offline-badge ready font-label-sm">
                                      <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>
                                        offline_pin
                                      </span>
                                      <span>Ready for Offline</span>
                                    </span>
                                  ) : (
                                    <span className="profile-offline-badge warning font-label-sm">
                                      <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>
                                        info
                                      </span>
                                      <span>Incomplete (Re-download)</span>
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="profile-offline-item-actions">
                              {item.isPlayableOffline !== false ? (
                                <button
                                  type="button"
                                  className="profile-offline-play-btn btn-pressable"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handlePlayOfflineItem(item);
                                  }}
                                  disabled={loadingOfflineMediaId === item.id}
                                  title={`Play ${item.title} offline`}
                                  aria-label={`Play ${item.title} offline`}
                                >
                                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                                    {loadingOfflineMediaId === item.id ? 'hourglass_top' : 'play_arrow'}
                                  </span>
                                  <span className="profile-offline-play-text">Play</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="profile-offline-redownload-btn btn-pressable"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveDialog(null);
                                    window.location.hash = item.type === 'video' ? `#/video/${item.id}` : `#/audio/${item.id}`;
                                  }}
                                  title="Download again"
                                  aria-label={`Download ${item.title} again`}
                                >
                                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                                    download
                                  </span>
                                  <span className="profile-offline-play-text">Re-download</span>
                                </button>
                              )}

                              <button
                                type="button"
                                className="profile-offline-remove-btn btn-pressable"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveOfflineItem(item.id);
                                }}
                                title="Delete download"
                                aria-label={`Remove ${item.title}`}
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                                  delete
                                </span>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="profile-modal-actions" style={{ marginTop: '1rem' }}>
                      {offlineStats.items.length > 0 && (
                        <button
                          className="profile-modal-action-btn danger btn-pressable"
                          onClick={handleClearAllOffline}
                          type="button"
                        >
                          Clear All
                        </button>
                      )}
                      <button
                        className="profile-modal-action-btn secondary btn-pressable"
                        onClick={() => setActiveDialog(null)}
                        type="button"
                      >
                        Close
                      </button>
                    </div>
                  </>
                )}
              </>
            )}

            {/* About Modal */}
            {activeDialog === 'about' && (
              <>
                <h3 className="profile-modal-title font-title-md">About Dr. Cubie &amp; Team</h3>
                <p className="profile-modal-desc font-body-md">
                  Dr. Cubie Inspiration delivers daily mindful pauses, contemplative audio resonance, and distilled philosophical wisdom to help leaders navigate demanding environments with poise.
                </p>
                <button
                  className="profile-modal-close-btn btn-pressable"
                  onClick={() => setActiveDialog(null)}
                >
                  Close
                </button>
              </>
            )}

            {/* Privacy Modal */}
            {activeDialog === 'privacy' && (
              <>
                <h3 className="profile-modal-title font-title-md">Privacy &amp; Data Transparency</h3>
                <p className="profile-modal-desc font-body-md">
                  Your reflection notes are stored privately on your device. We never sell personal data or monetize attention.
                </p>
                <button
                  className="profile-modal-close-btn btn-pressable"
                  onClick={() => setActiveDialog(null)}
                >
                  Close
                </button>
              </>
            )}

            {/* VIP Subscription Modal */}
            {activeDialog === 'vip' && (
              <>
                <h3 className="profile-modal-title font-title-md">VIP Subscription</h3>
                <p className="profile-modal-desc font-body-md">
                  {isVip ? (
                    <>Your VIP Membership ({userMembership?.plan?.name || 'VIP Sanctuary Membership'}) is currently <strong>Active</strong>
                    {userMembership?.endDate ? <> and valid until <strong>{formatMembershipDate(userMembership.endDate)}</strong></> : null}. You have unrestricted access to all daily Sparks, private audio soundscapes, video masterclasses, and offline downloads.</>
                  ) : (
                    <>You are currently on the <strong>Standard Free Tier</strong>. VIP members enjoy extended guided audio meditations, exclusive video masterclasses, and offline sanctuary downloads.</>
                  )}
                </p>
                <div className="profile-modal-actions" style={{ marginTop: '1rem' }}>
                  {!isVip && (
                    <button
                      className="profile-modal-action-btn primary btn-pressable"
                      onClick={() => {
                        setActiveDialog(null);
                        window.location.hash = '#/vip-pass';
                      }}
                      type="button"
                    >
                      Explore VIP Pass
                    </button>
                  )}
                  <button
                    className="profile-modal-action-btn secondary btn-pressable"
                    onClick={() => setActiveDialog(null)}
                    type="button"
                  >
                    Close
                  </button>
                </div>
                {isVip && (
                  <button
                    className="profile-modal-close-btn btn-pressable"
                    onClick={() => setActiveDialog(null)}
                  >
                    Close
                  </button>
                )}
              </>
            )}

            {/* Sign Out Modal */}
            {activeDialog === 'signout' && (
              <>
                <h3 className="profile-modal-title font-title-md">Sign Out</h3>
                <p className="profile-modal-desc font-body-md">
                  Are you sure you want to sign out? Your reflection streaks and saved sparks are safely backed up to the cloud.
                </p>
                <div className="profile-modal-actions">
                  <button
                    className="profile-modal-action-btn danger btn-pressable"
                    onClick={handleSignOut}
                  >
                    Confirm Sign Out
                  </button>
                  <button
                    className="profile-modal-action-btn secondary btn-pressable"
                    onClick={() => setActiveDialog(null)}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}

            {/* Avatar Upload Preview Modal */}
            {activeDialog === 'avatar-preview' && (
              <>
                <h3 className="profile-modal-title font-title-md">Update Profile Picture</h3>
                <p className="profile-modal-desc font-body-md" style={{ marginBottom: '0.75rem' }}>
                  Preview your new contemplative profile photo.
                </p>

                <div className="profile-preview-container">
                  <div className="profile-preview-circle">
                    {previewUrl ? (
                      <img
                        src={previewUrl}
                        alt="Selected profile preview"
                        className="profile-preview-img"
                      />
                    ) : (
                      <span className="material-symbols-outlined" style={{ fontSize: '48px', color: '#00288E' }}>
                        person
                      </span>
                    )}
                  </div>
                  {selectedFile && (
                    <span className="font-label-sm profile-preview-filename">
                      {selectedFile.name} • {(selectedFile.size / 1024).toFixed(0)} KB
                    </span>
                  )}
                </div>

                {uploadError && (
                  <div className="profile-upload-error font-body-sm" role="alert">
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                      error
                    </span>
                    <span>{uploadError}</span>
                  </div>
                )}

                <div className="profile-modal-actions" style={{ marginTop: '1.25rem' }}>
                  <button
                    className="profile-modal-action-btn primary btn-pressable"
                    onClick={handleConfirmUpload}
                    disabled={isUploading || !selectedFile}
                    type="button"
                  >
                    {isUploading ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                        <span
                          className="auth-spinner"
                          style={{
                            width: '16px',
                            height: '16px',
                            borderWidth: '2px',
                            borderColor: 'rgba(255, 255, 255, 0.3)',
                            borderTopColor: '#ffffff'
                          }}
                        />
                        <span>Uploading...</span>
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                          check
                        </span>
                        <span>Save Photo</span>
                      </span>
                    )}
                  </button>
                  <button
                    className="profile-modal-action-btn secondary btn-pressable"
                    onClick={handleCancelPreview}
                    disabled={isUploading}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>

                {displayAvatar && !isUploading && (
                  <div style={{ textAlign: 'center' }}>
                    <button
                      type="button"
                      className="profile-remove-photo-btn font-label-md btn-pressable"
                      onClick={handleRemovePhoto}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                        delete
                      </span>
                      <span>Remove current photo</span>
                    </button>
                  </div>
                )}
              </>
            )}

            {/* Push Notification Permission Help Modal */}
            {activeDialog === 'push-permission' && (
              <>
                <div className="profile-push-perm-header">
                  <div className="profile-push-perm-handle" />
                  <button
                    type="button"
                    className="profile-push-perm-close-btn btn-pressable"
                    onClick={() => setActiveDialog(null)}
                    aria-label="Close dialog"
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>

                <div className="profile-push-perm-hero">
                  <div className="profile-push-perm-icon-ring">
                    <div className="profile-push-perm-icon-inner">
                      <span className="material-symbols-outlined profile-push-perm-icon">
                        notifications_active
                      </span>
                    </div>
                  </div>
                  <h3 className="profile-push-perm-title font-title-lg">
                    Notifications Disabled
                  </h3>
                  <p className="profile-push-perm-subtitle font-body-md">
                    Device permissions need to be enabled so Dr. Cubie can deliver your daily wisdom sparks and reflection reminders.
                  </p>
                </div>

                <div className="profile-push-perm-steps">
                  <div className="profile-push-perm-step-card">
                    <div className="profile-push-step-badge">
                      <span className="material-symbols-outlined">settings</span>
                    </div>
                    <div className="profile-push-step-content">
                      <div className="profile-push-step-title font-label-md">How to re-enable</div>
                      <div className="profile-push-step-desc font-body-sm">
                        Open device <strong>Settings</strong> → <strong>Apps</strong> → <strong>Dr. Cubie</strong> → <strong>Notifications</strong> → Turn on <strong>Allow Notifications</strong>.
                      </div>
                    </div>
                  </div>
                </div>

                <div className="profile-push-perm-actions">
                  <button
                    type="button"
                    className="profile-push-perm-btn primary btn-pressable"
                    onClick={async () => {
                      setActiveDialog(null);
                      const status = await checkPushPermission();
                      setPushStatus(status);
                      if (status === 'granted') {
                        if (showToast) showToast('Push notifications successfully enabled!');
                      }
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                      check_circle
                    </span>
                    <span>I've Enabled It</span>
                  </button>
                  <button
                    type="button"
                    className="profile-push-perm-btn secondary btn-pressable"
                    onClick={() => setActiveDialog(null)}
                  >
                    Maybe Later
                  </button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Offline Video Player Modal Portaled to document.body */}
      {activeOfflineVideo && typeof document !== 'undefined' && createPortal(
        <div
          className="profile-video-modal-backdrop animate-backdrop"
          onClick={handleCloseOfflineVideo}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="profile-video-modal-card animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="profile-video-modal-header">
              <div className="profile-video-modal-title-wrap">
                <span className="profile-offline-badge ready font-label-sm" style={{ alignSelf: 'flex-start' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>
                    offline_pin
                  </span>
                  <span>Offline Video</span>
                </span>
                <h3 className="profile-video-modal-title font-title-md">
                  {activeOfflineVideo.title}
                </h3>
              </div>
              <button
                type="button"
                className="profile-video-modal-close-btn btn-pressable"
                onClick={handleCloseOfflineVideo}
                aria-label="Close offline video player"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="profile-video-modal-player-box">
              <VideoPlayer
                src={activeOfflineVideo.blobUrl}
                poster={activeOfflineVideo.thumbnailUrl || ''}
                title={activeOfflineVideo.title}
                autoPlay={true}
                variant="hero"
              />
            </div>
          </div>
        </div>,
        document.body
      )}


    </div>
  );
};
