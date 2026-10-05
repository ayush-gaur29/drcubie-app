import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from '../lib/supabase';
import { getNotificationRoute } from './notificationsService';

/**
 * Push Notification Service for Dr. Cubie Inspiration.
 *
 * Coordinates:
 * 1. Native Capacitor push notifications (Android / iOS FCM)
 * 2. Secure device token registration & lifecycle with Supabase (user_push_tokens table & RPC)
 * 3. In-app foreground notification handling & deduplication with Supabase Realtime
 * 4. Background/closed notification deep link handling
 * 5. Server-side push delivery via Supabase Edge Function 'send-push-notification'
 */

// Cache key for current device's registered token
const STORAGE_KEY_FCM_TOKEN = 'drcubie_device_fcm_token';
const STORAGE_KEY_PUSH_ENABLED = 'drcubie_push_enabled';

// In-memory set for deduplicating notifications across Realtime & FCM
const seenNotificationIds = new Set();

/**
 * Deduplicate notification IDs across Realtime and FCM push delivery.
 * Returns true if notification was already processed recently, false if new.
 */
export const isNotificationDuplicate = (id) => {
  if (!id) return false;
  const strId = String(id);
  if (seenNotificationIds.has(strId)) {
    return true;
  }
  seenNotificationIds.add(strId);
  // Auto-expire from deduplication cache after 45 seconds
  setTimeout(() => {
    seenNotificationIds.delete(strId);
  }, 45000);
  return false;
};

/**
 * Check if running in a native Capacitor mobile container (Android / iOS)
 */
export const isNativePlatform = () => {
  return Capacitor.isNativePlatform();
};

/**
 * Get current platform identifier ('android' | 'ios' | 'web')
 */
export const getPlatformName = () => {
  const p = Capacitor.getPlatform();
  if (p === 'android' || p === 'ios') return p;
  return 'web';
};

/**
 * Check current push notification permission status.
 * Returns: 'granted' | 'denied' | 'prompt'
 */
export const checkPushPermission = async () => {
  try {
    if (isNativePlatform()) {
      const status = await PushNotifications.checkPermissions();
      if (status.receive === 'granted') return 'granted';
      if (status.receive === 'denied') return 'denied';
      return 'prompt';
    } else if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'granted') return 'granted';
      if (Notification.permission === 'denied') return 'denied';
      return 'prompt';
    }
  } catch (err) {
    console.warn('[PushService] checkPushPermission error:', err);
  }
  return 'prompt';
};

/**
 * Request notification permission from user / operating system.
 * Returns: 'granted' | 'denied' | 'prompt'
 */
export const requestPushPermission = async () => {
  try {
    if (isNativePlatform()) {
      const result = await PushNotifications.requestPermissions();
      if (result.receive === 'granted') {
        localStorage.setItem(STORAGE_KEY_PUSH_ENABLED, 'true');
        return 'granted';
      } else {
        localStorage.setItem(STORAGE_KEY_PUSH_ENABLED, 'false');
        return 'denied';
      }
    } else if (typeof window !== 'undefined' && 'Notification' in window) {
      const result = await Notification.requestPermission();
      if (result === 'granted') {
        localStorage.setItem(STORAGE_KEY_PUSH_ENABLED, 'true');
        return 'granted';
      } else {
        localStorage.setItem(STORAGE_KEY_PUSH_ENABLED, 'false');
        return 'denied';
      }
    }
  } catch (err) {
    console.warn('[PushService] requestPushPermission error:', err);
    return 'denied';
  }
  return 'denied';
};

/**
 * Register push notification token in Supabase public.user_push_tokens.
 * Strictly associates device token with the authenticated user ID.
 */
export const registerPushTokenInSupabase = async (userId, token, platform = null, deviceId = null) => {
  if (!supabase || !userId || !token) {
    return { success: false, error: 'Missing userId or token' };
  }

  const effectivePlatform = platform || getPlatformName();

  try {
    // 1. Try using the secure RPC helper
    const { data, error } = await supabase.rpc('register_push_token', {
      p_fcm_token: token,
      p_platform: effectivePlatform,
      p_device_id: deviceId || (isNativePlatform() ? 'mobile-device' : 'web-browser')
    });

    if (!error && data) {
      localStorage.setItem(STORAGE_KEY_FCM_TOKEN, token);
      localStorage.setItem(STORAGE_KEY_PUSH_ENABLED, 'true');
      return { success: true, data };
    }

    // 2. Fallback to direct upsert on user_push_tokens table (RLS protected)
    const { data: upsertData, error: upsertErr } = await supabase
      .from('user_push_tokens')
      .upsert(
        {
          user_id: userId,
          fcm_token: token,
          platform: effectivePlatform,
          device_id: deviceId || 'device',
          is_active: true
        },
        { onConflict: 'user_id, fcm_token' }
      )
      .select()
      .maybeSingle();

    if (upsertErr) {
      console.warn('[PushService] registerPushToken upsert warning:', upsertErr.message);
      return { success: false, error: upsertErr.message };
    }

    localStorage.setItem(STORAGE_KEY_FCM_TOKEN, token);
    localStorage.setItem(STORAGE_KEY_PUSH_ENABLED, 'true');
    return { success: true, data: upsertData };
  } catch (err) {
    console.error('[PushService] registerPushToken exception:', err);
    return { success: false, error: err.message };
  }
};

/**
 * Deactivate push token in Supabase when user logs out or disables notifications.
 */
export const deactivatePushTokenInSupabase = async (userId, token = null) => {
  if (!supabase) return { success: false };

  const targetToken = token || localStorage.getItem(STORAGE_KEY_FCM_TOKEN);
  if (!targetToken) return { success: true };

  try {
    // 1. Call RPC if available
    const { error } = await supabase.rpc('deactivate_push_token', {
      p_fcm_token: targetToken
    });

    if (error && userId) {
      // 2. Direct update fallback
      await supabase
        .from('user_push_tokens')
        .update({ is_active: false })
        .eq('fcm_token', targetToken)
        .eq('user_id', userId);
    }

    localStorage.setItem(STORAGE_KEY_PUSH_ENABLED, 'false');
    return { success: true };
  } catch (err) {
    console.warn('[PushService] deactivatePushToken exception:', err);
    return { success: false, error: err.message };
  }
};

/**
 * Initialize Push Notification Listeners (Native Capacitor)
 *
 * Sets up:
 * - 'registration' -> stores token and uploads to Supabase
 * - 'registrationError' -> error logging
 * - 'pushNotificationReceived' -> foreground in-app presentation
 * - 'pushNotificationActionPerformed' -> notification tap / deep linking
 */
export const initializePushListeners = async ({
  userId,
  onNotificationReceived,
  onNotificationTapped
}) => {
  if (!isNativePlatform()) {
    return { cleanup: () => {} };
  }

  const listeners = [];

  try {
    // 1. Token Registration Handler
    const regListener = await PushNotifications.addListener('registration', async (token) => {
      console.log('[PushService] Native FCM registration token received:', token.value?.slice(0, 16) + '...');
      if (userId && token.value) {
        await registerPushTokenInSupabase(userId, token.value);
      }
    });
    listeners.push(regListener);

    // 2. Registration Error Handler
    const errListener = await PushNotifications.addListener('registrationError', (error) => {
      console.warn('[PushService] Native push registration error:', error);
    });
    listeners.push(errListener);

    // 3. Foreground Notification Received Handler
    const recvListener = await PushNotifications.addListener(
      'pushNotificationReceived',
      (notification) => {
        console.log('[PushService] Foreground push notification received:', notification);
        const data = notification.data || {};
        const notifId = data.notificationId || notification.id;

        // Prevent duplicate popups if Realtime already handled this notification
        if (notifId && isNotificationDuplicate(notifId)) {
          return;
        }

        if (typeof onNotificationReceived === 'function') {
          onNotificationReceived({
            id: notifId,
            title: notification.title,
            message: notification.body,
            type: data.type || 'general',
            route: data.route,
            data
          });
        }
      }
    );
    listeners.push(recvListener);

    // 4. Notification Action Performed Handler (Tap on notification)
    const actionListener = await PushNotifications.addListener(
      'pushNotificationActionPerformed',
      (action) => {
        console.log('[PushService] Push notification tapped / opened:', action);
        const notif = action.notification || {};
        const data = notif.data || {};
        const targetRoute = data.route || getNotificationRoute(data) || 'notifications';

        if (typeof onNotificationTapped === 'function') {
          onNotificationTapped(targetRoute, {
            id: data.notificationId || notif.id,
            title: notif.title,
            message: notif.body,
            ...data
          });
        }
      }
    );
    listeners.push(actionListener);

    // If permission is already granted, trigger registration
    const currentPermission = await checkPushPermission();
    if (currentPermission === 'granted') {
      await PushNotifications.register();
    }
  } catch (err) {
    console.warn('[PushService] Error setting up native push listeners:', err);
  }

  return {
    cleanup: () => {
      listeners.forEach((l) => {
        try {
          l.remove();
        } catch {
          // ignore
        }
      });
    }
  };
};

/**
 * Trigger Push Notification delivery via Supabase Edge Function 'send-push-notification'.
 * Calls server-side Firebase FCM v1 API securely.
 */
export const triggerPushNotification = async ({
  notificationId,
  userId,
  userIds,
  broadcast = false,
  title,
  message,
  type = 'general',
  relatedContentId = null,
  relatedContentType = null,
  route = null,
  dryRun = false
}) => {
  if (!supabase) {
    return { success: false, error: 'Supabase client not initialized' };
  }

  try {
    const { data, error } = await supabase.functions.invoke('send-push-notification', {
      body: {
        notificationId,
        userId,
        userIds,
        broadcast,
        title,
        message,
        type,
        relatedContentId,
        relatedContentType,
        route,
        dryRun
      }
    });

    if (error) {
      console.warn('[PushService] triggerPushNotification error:', error.message);
      return { success: false, error: error.message };
    }

    return { success: true, data };
  } catch (err) {
    console.error('[PushService] triggerPushNotification exception:', err);
    return { success: false, error: err.message };
  }
};
