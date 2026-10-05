import React, { useState, useEffect, useCallback } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SparksProvider, useSparks } from './context/SparksContext';
import { AudioProvider } from './context/AudioContext';
import { AccessControlProvider } from './context/AccessControlContext';
import { Header } from './components/Header/Header';
import { BottomNav } from './components/BottomNav/BottomNav';
import { ShareSheet } from './components/ShareSheet/ShareSheet';
import { Toast } from './components/Toast/Toast';
import { AuthModal } from './components/Auth/AuthModal';
import { AppLoader } from './components/Common/AppLoader';

import { Today } from './pages/Today/Today';
import { Saved } from './pages/Saved/Saved';
import { VipPass } from './pages/VipPass/VipPass';
import { SparkDetail } from './pages/SparkDetail/SparkDetail';
import { VideoDetail } from './pages/VideoDetail/VideoDetail';
import { AudioDetail } from './pages/AudioDetail/AudioDetail';
import { Profile } from './pages/Profile/Profile';
import { Notifications } from './pages/Notifications/Notifications';
import { Videos } from './pages/Videos/Videos';
import { Audios } from './pages/Audios/Audios';
import { Sparks } from './pages/Sparks/Sparks';
import { Recommendations } from './pages/Recommendations/Recommendations';

import {
  fetchUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  subscribeToUserNotifications,
  getNotificationRoute
} from './services/notificationsService';
import { getUserPreferences, isSparkDeliveredForUser } from './services/userPreferencesService';
import { NotificationBanner } from './components/NotificationBanner/NotificationBanner';
import { AdminNotificationModal } from './components/Admin/AdminNotificationModal';
import {
  initializePushListeners,
  isNotificationDuplicate
} from './services/pushNotificationService';

/**
 * AppShell manages application routes, authenticated state coordination,
 * dynamic notifications, and global layout rendering.
 */
const AppShell = () => {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { sparks, loading: sparksLoading } = useSparks();

  // Track initial startup lifecycle: loader remains until real init is complete, then cleanly unmounts
  const [hasInitialBootCompleted, setHasInitialBootCompleted] = useState(false);

  // Authoritative app readiness: auth session verification + initial content readiness
  const isAppReady = !authLoading && (!sparksLoading || (Array.isArray(sparks) && sparks.length > 0));

  // Routes: 'today' | 'saved' | 'vip-pass' | 'profile' | 'notifications' | 'spark/:id'
  const [route, setRoute] = useState(() => {
    const hash = window.location.hash.replace('#/', '').replace('#', '');
    return hash || 'today';
  });

  const [previousRoute, setPreviousRoute] = useState('today');

  // Dynamic user notifications state from Supabase
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isNotifPopupOpen, setIsNotifPopupOpen] = useState(false);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [notificationsError, setNotificationsError] = useState(null);

  // In-app foreground push notification banner & Admin modal
  const [activeInAppBanner, setActiveInAppBanner] = useState(null);
  const [isAdminNotifModalOpen, setIsAdminNotifModalOpen] = useState(false);

  // Sync hash changes with app route
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#/', '').replace('#', '');
      if (hash === 'admin-notifications') {
        setIsAdminNotifModalOpen(true);
        return;
      }
      if (hash) {
        setRoute(hash);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Listen for admin modal open custom event
  useEffect(() => {
    const handleOpenAdmin = () => {
      setIsAdminNotifModalOpen(true);
    };
    window.addEventListener('drcubie_open_admin_notifications', handleOpenAdmin);
    return () => window.removeEventListener('drcubie_open_admin_notifications', handleOpenAdmin);
  }, []);

  const navigateTo = useCallback((newRoute) => {
    if (newRoute !== route) {
      setPreviousRoute(route);
      setRoute(newRoute);
      window.location.hash = `#/${newRoute}`;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      // Always close popup when navigating
      setIsNotifPopupOpen(false);
    }
  }, [route]);

  const navigateToSpark = useCallback((sparkId) => {
    navigateTo(`spark/${sparkId}`);
  }, [navigateTo]);

  const navigateToVideo = useCallback((videoId) => {
    navigateTo(`videos/${videoId}`);
  }, [navigateTo]);

  const navigateToAudio = useCallback((audioId) => {
    navigateTo(`audios/${audioId}`);
  }, [navigateTo]);

  const handleBack = useCallback(() => {
    if (
      previousRoute &&
      previousRoute !== route &&
      !previousRoute.startsWith('spark') &&
      !previousRoute.startsWith('video') &&
      !previousRoute.startsWith('audio')
    ) {
      navigateTo(previousRoute);
    } else {
      navigateTo('today');
    }
  }, [previousRoute, route, navigateTo]);

  // Load user notifications from Supabase
  const loadNotifications = useCallback(async (userId) => {
    if (!userId) {
      setNotifications([]);
      setUnreadCount(0);
      setLoadingNotifications(false);
      return;
    }

    setLoadingNotifications(true);
    setNotificationsError(null);

    const { data, error } = await fetchUserNotifications(userId);
    if (error) {
      console.warn('[App] Error fetching notifications:', error);
      setNotificationsError(error);
      setNotifications([]);
      setUnreadCount(0);
    } else {
      const prefs = getUserPreferences(userId);
      const isDelivered = isSparkDeliveredForUser(prefs?.dailyDeliveryTime);
      const todayDateStr = new Date().toDateString();

      // Daily Spark notifications visibility follows the user's selected delivery time
      const visibleList = (data || []).filter((n) => {
        if (!isDelivered) {
          const nDate = new Date(n.created_at || n.createdAt);
          if (nDate.toDateString() === todayDateStr && (n.type === 'spark' || /spark/i.test(n.title || ''))) {
            return false;
          }
        }
        return true;
      });

      setNotifications(visibleList);
      const unread = visibleList.filter((n) => !n.is_read).length;
      setUnreadCount(unread);
    }
    setLoadingNotifications(false);
  }, []);

  // Sync notifications on auth state changes (login / logout) & set up realtime + native push
  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      // Clear notifications on logout
      setNotifications([]);
      setUnreadCount(0);
      setIsNotifPopupOpen(false);
      setActiveInAppBanner(null);
      setNotificationsError(null);
      return;
    }

    // Load notifications for the logged in user
    loadNotifications(user.id);

    // Re-evaluate notification delivery when user preferences (like spark delivery time) update
    const handlePrefChange = () => {
      loadNotifications(user.id);
    };
    window.addEventListener('drcubie_preferences_updated', handlePrefChange);

    // Subscribe to realtime updates for this user
    const subscription = subscribeToUserNotifications(user.id, (payload) => {
      if (payload?.eventType === 'INSERT' && payload.new) {
        const notif = payload.new;
        if (!isNotificationDuplicate(notif.id)) {
          setActiveInAppBanner(notif);
        }
      }
      loadNotifications(user.id);
    });

    // Initialize Native & Web Push Notification listeners (FCM foreground & background click handling)
    let pushCleanup = null;
    initializePushListeners({
      userId: user.id,
      onNotificationReceived: (pushNotif) => {
        if (!isNotificationDuplicate(pushNotif.id)) {
          setActiveInAppBanner(pushNotif);
        }
        loadNotifications(user.id);
      },
      onNotificationTapped: (targetRoute, notifData) => {
        if (notifData?.id && user?.id) {
          markNotificationAsRead(notifData.id, user.id);
        }
        navigateTo(targetRoute || 'notifications');
      }
    }).then((res) => {
      pushCleanup = res?.cleanup;
    });

    return () => {
      window.removeEventListener('drcubie_preferences_updated', handlePrefChange);
      if (subscription && typeof subscription.unsubscribe === 'function') {
        subscription.unsubscribe();
      }
      if (typeof pushCleanup === 'function') {
        pushCleanup();
      }
    };
  }, [isAuthenticated, user?.id, loadNotifications, navigateTo]);

  // Handle individual notification click
  const handleNotificationClick = async (item) => {
    if (!item) return;

    // Immediately mark as read optimistically in state
    if (!item.is_read) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === item.id ? { ...n, is_read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));

      // Persist to Supabase if authenticated
      if (user?.id) {
        markNotificationAsRead(item.id, user.id);
      }
    }

    // Close the preview popup
    setIsNotifPopupOpen(false);

    // Navigate to content destination if present
    const destination = getNotificationRoute(item);
    if (destination) {
      navigateTo(destination);
    }
  };

  // Handle mark all as read
  const handleMarkAllAsRead = async () => {
    if (!user?.id) return;

    // Optimistically update all to read
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);

    // Persist to Supabase
    await markAllNotificationsAsRead(user.id);
  };

  // View All Notifications full-page transition
  const handleViewAllNotifications = () => {
    setIsNotifPopupOpen(false);
    navigateTo('notifications');
  };

  // Determine active main tab for bottom navigation
  let activeTab = 'today';
  if (route === 'saved') activeTab = 'saved';
  else if (route === 'vip-pass') activeTab = 'vip-pass';
  else if (route === 'profile') activeTab = 'profile';

  const isSparkDetail =
    (route.startsWith('spark/') && route !== 'spark') ||
    (route.startsWith('sparks/') && route !== 'sparks');
  const currentSparkId = isSparkDetail ? route.replace(/^sparks?\//, '') : null;

  const isVideoDetail =
    (route.startsWith('videos/') && route !== 'videos') ||
    (route.startsWith('video/') && route !== 'video');
  const currentVideoId = isVideoDetail ? route.replace(/^videos?\//, '') : null;

  const isAudioDetail =
    (route.startsWith('audios/') && route !== 'audios') ||
    (route.startsWith('audio/') && route !== 'audio');
  const currentAudioId = isAudioDetail ? route.replace(/^audios?\//, '') : null;

  return (
    <div className="app-wrapper">
      {/* Dr. Cubie Modern Branded Startup Loader */}
      {!hasInitialBootCompleted && (
        <AppLoader
          isReady={isAppReady}
          message="Preparing your inspiration..."
          onExited={() => setHasInitialBootCompleted(true)}
        />
      )}

      <div className="app-shell">
        {/* Top Fixed App Header with Bell and Dropdown Popup */}
        <Header
          onNavigate={navigateTo}
          currentRoute={route}
          onBack={handleBack}
          unreadCount={unreadCount}
          notifications={notifications}
          isPopupOpen={isNotifPopupOpen}
          onToggleNotifications={() => setIsNotifPopupOpen((prev) => !prev)}
          onCloseNotifications={() => setIsNotifPopupOpen(false)}
          onNotificationClick={handleNotificationClick}
          onMarkAllAsRead={handleMarkAllAsRead}
          onViewAllNotifications={handleViewAllNotifications}
          loadingNotifications={loadingNotifications}
          notificationsError={notificationsError}
        />

        {/* Main Page Viewport Container */}
        <main className="page-container" id="main-content">
          {route === 'today' && (
            <Today
              onNavigateToSpark={navigateToSpark}
              onNavigateToSparks={() => navigateTo('sparks')}
              onNavigateToVideos={() => navigateTo('videos')}
              onNavigateToAudios={() => navigateTo('audios')}
              onNavigateToRecommendations={() => navigateTo('recommendations')}
              onNavigateToVideo={navigateToVideo}
              onNavigateToAudio={navigateToAudio}
            />
          )}

          {route === 'sparks' && (
            <Sparks
              onBack={handleBack}
              onNavigateToSpark={navigateToSpark}
            />
          )}

          {route === 'videos' && (
            <Videos
              onBack={handleBack}
              onNavigateToSpark={navigateToSpark}
              onNavigateToVideo={navigateToVideo}
            />
          )}

          {route === 'audios' && (
            <Audios
              onBack={handleBack}
              onNavigateToSpark={navigateToSpark}
              onNavigateToAudio={navigateToAudio}
            />
          )}

          {route === 'recommendations' && (
            <Recommendations
              onBack={handleBack}
              onNavigateToSpark={navigateToSpark}
              onNavigateToVideo={navigateToVideo}
              onNavigateToAudio={navigateToAudio}
            />
          )}

          {route === 'saved' && (
            <Saved
              onNavigateToSpark={navigateToSpark}
              onNavigateToToday={() => navigateTo('today')}
              onNavigateToVip={() => navigateTo('vip-pass')}
              onNavigateToVideo={navigateToVideo}
              onNavigateToAudio={navigateToAudio}
            />
          )}

          {route === 'vip-pass' && (
            <VipPass
              onNavigateToSpark={navigateToSpark}
              onNavigateToVideo={navigateToVideo}
              onNavigateToAudio={navigateToAudio}
            />
          )}

          {(route === 'profile' || route === 'auth' || route === 'signin' || route === 'signup') && (
            <Profile />
          )}

          {/* Dedicated Full-Page Notifications Screen */}
          {route === 'notifications' && (
            <Notifications
              notifications={notifications}
              loading={loadingNotifications}
              error={notificationsError}
              onNotificationClick={handleNotificationClick}
              onMarkAllAsRead={handleMarkAllAsRead}
              onBack={handleBack}
              onNavigate={navigateTo}
              onRefresh={() => user?.id && loadNotifications(user.id)}
            />
          )}

          {isSparkDetail && (
            <SparkDetail
              sparkId={currentSparkId}
              onBack={handleBack}
            />
          )}

          {isVideoDetail && (
            <VideoDetail
              videoId={currentVideoId}
              onBack={handleBack}
              onNavigateToSpark={navigateToSpark}
            />
          )}

          {isAudioDetail && (
            <AudioDetail
              audioId={currentAudioId}
              onBack={handleBack}
              onNavigateToSpark={navigateToSpark}
            />
          )}
        </main>

        {/* Bottom Floating Navigation Dock */}
        <BottomNav
          currentRoute={activeTab}
          onNavigate={navigateTo}
        />

        {/* Shared Share Modal Sheet */}
        <ShareSheet />

        {/* Shared Notification Toast */}
        <Toast />

        {/* Realtime / Foreground In-App Push Notification Banner */}
        <NotificationBanner
          notification={activeInAppBanner}
          onClose={() => setActiveInAppBanner(null)}
          onClick={handleNotificationClick}
        />

        {/* Admin Push Notification Console */}
        <AdminNotificationModal
          isOpen={isAdminNotifModalOpen}
          onClose={() => setIsAdminNotifModalOpen(false)}
          currentUserId={user?.id}
          onNotificationCreated={() => {
            if (user?.id) loadNotifications(user.id);
          }}
        />

        {/* Shared Auth Modal Sheet */}
        <AuthModal />
      </div>
    </div>
  );
};

export const App = () => {
  return (
    <AuthProvider>
      <SparksProvider>
        <AccessControlProvider>
          <AudioProvider>
            <AppShell />
          </AudioProvider>
        </AccessControlProvider>
      </SparksProvider>
    </AuthProvider>
  );
};

export default App;
