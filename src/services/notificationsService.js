import { supabase } from '../lib/supabase.js';

/**
 * Helper to format a timestamp into a clean, relative human-readable label
 * (e.g. "Just now", "5m ago", "2h ago", "Yesterday • 8:15 AM", "Sep 24")
 */
export const formatNotificationTime = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const diffInMs = now.getTime() - date.getTime();
  const diffInSec = Math.floor(diffInMs / 1000);
  const diffInMin = Math.floor(diffInSec / 60);
  const diffInHours = Math.floor(diffInMin / 60);
  const diffInDays = Math.floor(diffInHours / 24);

  if (diffInSec < 60) {
    return 'Just now';
  }
  if (diffInMin < 60) {
    return `${diffInMin}m ago`;
  }
  if (diffInHours < 24 && now.getDate() === date.getDate()) {
    return `${diffInHours}h ago`;
  }

  // Format time portion (e.g. 7:30 AM)
  const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  // Yesterday
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear()
  ) {
    return `Yesterday • ${timeStr}`;
  }

  if (diffInDays < 7) {
    const dayName = date.toLocaleDateString([], { weekday: 'short' });
    return `${dayName} • ${timeStr}`;
  }

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

/**
 * Helper to group a list of notifications into time categories:
 * - "Today"
 * - "Yesterday"
 * - "Earlier"
 */
export const groupNotificationsByTime = (notifications = []) => {
  const groups = {
    today: [],
    yesterday: [],
    earlier: []
  };

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

  notifications.forEach((item) => {
    const itemDate = new Date(item.created_at || item.createdAt);
    const itemTime = isNaN(itemDate.getTime()) ? 0 : itemDate.getTime();

    if (itemTime >= startOfToday) {
      groups.today.push(item);
    } else if (itemTime >= startOfYesterday) {
      groups.yesterday.push(item);
    } else {
      groups.earlier.push(item);
    }
  });

  return groups;
};

/**
 * Single Authoritative Notification Route Resolver.
 *
 * Guarantees that:
 * 1. The explicit `route` received in any notification payload (FCM data, action, or DB)
 *    ALWAYS takes highest priority.
 * 2. An Audio or Video notification NEVER converts into a Spark route under any circumstances.
 * 3. Both raw objects, nested data payloads, and Supabase database rows resolve identically.
 */
export const resolveNotificationRoute = (rawPayload) => {
  if (!rawPayload) return 'today';

  // Normalize payload: merge top-level and nested data properties
  const data = (rawPayload.data && typeof rawPayload.data === 'object') ? rawPayload.data : {};
  const notif = (rawPayload.notification && typeof rawPayload.notification === 'object') ? rawPayload.notification : {};
  const merged = { ...rawPayload, ...notif, ...data };

  // 1. HIGHEST PRIORITY: Explicit 'route' string
  const rawRoute = merged.route || data.route || notif.route || rawPayload.route;
  if (typeof rawRoute === 'string' && rawRoute.trim()) {
    const cleanRoute = rawRoute.trim().replace(/^[#/]+/, '');
    console.log('[NotificationRouter] Using explicit route:', cleanRoute);
    return cleanRoute;
  }

  // 2. Fallback resolution strictly using type, relatedContentType, and relatedContentId
  const type = String(merged.type || '').trim().toLowerCase();
  const relType = String(merged.related_content_type || merged.relatedContentType || '').trim().toLowerCase();
  const relId = String(merged.related_content_id || merged.relatedContentId || '').trim();

  console.log('[NotificationRouter] Resolving fallback route for:', { type, relType, relId });

  // SPECIFIC AUDIO: Must ALWAYS route to audios/audios/{audioId}, NEVER to Spark!
  if (type === 'audio' || relType === 'audio') {
    return relId ? `audios/audios/${relId}` : 'audios';
  }

  // SPECIFIC VIDEO: Must ALWAYS route to videos/videos/{videoId}, NEVER to Spark!
  if (type === 'video' || relType === 'video') {
    return relId ? `videos/videos/${relId}` : 'videos';
  }

  // SPECIFIC SPARK: Only route to spark if explicitly a spark
  if (type === 'spark' || relType === 'spark') {
    return relId ? `spark/${relId}` : 'today';
  }

  // VIP
  if (type === 'vip' || relType === 'vip') {
    return 'vip-pass';
  }

  // PROFILE / STREAK
  if (type === 'streak' || type === 'profile') {
    return 'profile';
  }

  // GENERAL APP / INBOX
  if (type === 'general' || type === 'system') {
    return 'notifications';
  }

  return 'today';
};

// Single Authoritative Alias
export const getNotificationRoute = resolveNotificationRoute;

/**
 * Material Symbol icon name for the notification type
 */
export const getNotificationIcon = (type) => {
  switch (type) {
    case 'spark':
      return 'auto_awesome';
    case 'streak':
      return 'local_fire_department';
    case 'vip':
      return 'workspace_premium';
    case 'video':
      return 'smart_display';
    case 'audio':
      return 'headphones';
    case 'system':
      return 'info';
    default:
      return 'notifications';
  }
};

/**
 * Fetch all notifications for the authenticated user.
 * RLS enforces auth.uid() = user_id.
 */
export const fetchUserNotifications = async (userId, limit = 50) => {
  if (!supabase || !userId) {
    return { data: [], error: null };
  }

  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('id, user_id, title, message, type, related_content_id, related_content_type, is_read, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.warn('[NotificationsService] fetchUserNotifications error:', error.message, error);
      return { data: [], error };
    }

    return { data: data || [], error: null };
  } catch (err) {
    console.error('[NotificationsService] fetchUserNotifications exception:', err);
    return { data: [], error: err };
  }
};

/**
 * Fetch unread notification count for the authenticated user.
 */
export const fetchUnreadCount = async (userId) => {
  if (!supabase || !userId) {
    return 0;
  }

  try {
    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) {
      console.warn('[NotificationsService] fetchUnreadCount error:', error.message);
      return 0;
    }

    return count || 0;
  } catch (err) {
    console.error('[NotificationsService] fetchUnreadCount exception:', err);
    return 0;
  }
};

/**
 * Mark a single notification as read.
 */
export const markNotificationAsRead = async (notificationId, userId) => {
  if (!supabase || !notificationId || !userId) {
    return { success: false, error: 'Missing parameters' };
  }

  try {
    const { data, error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId)
      .eq('user_id', userId)
      .select();

    if (error) {
      console.warn('[NotificationsService] markNotificationAsRead error:', error.message);
      return { success: false, error: error.message };
    }

    return { success: true, data };
  } catch (err) {
    console.error('[NotificationsService] markNotificationAsRead exception:', err);
    return { success: false, error: err.message };
  }
};

/**
 * Mark ALL notifications as read for the current user.
 */
export const markAllNotificationsAsRead = async (userId) => {
  if (!supabase || !userId) {
    return { success: false, error: 'User ID missing' };
  }

  try {
    const { data, error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false)
      .select();

    if (error) {
      console.warn('[NotificationsService] markAllNotificationsAsRead error:', error.message);
      return { success: false, error: error.message };
    }

    return { success: true, count: data?.length || 0 };
  } catch (err) {
    console.error('[NotificationsService] markAllNotificationsAsRead exception:', err);
    return { success: false, error: err.message };
  }
};

/**
 * Create a new notification for a user and trigger server-side push delivery.
 */
export const createNotification = async ({
  userId,
  title,
  message,
  type = 'general',
  relatedContentId = null,
  relatedContentType = null,
  route = null,
  dispatchPush = true
}) => {
  if (!supabase || !userId || !title || !message) {
    return { success: false, error: 'Missing required notification fields' };
  }

  try {
    const { data, error } = await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        title,
        message,
        type,
        related_content_id: relatedContentId,
        related_content_type: relatedContentType,
        is_read: false
      })
      .select()
      .single();

    if (error) {
      console.warn('[NotificationsService] createNotification error:', error.message);
      return { success: false, error: error.message };
    }

    // Trigger server-side push notification via Edge Function (non-blocking)
    if (dispatchPush && data) {
      const destination = route || getNotificationRoute({ type, relatedContentId, relatedContentType });
      supabase.functions
        .invoke('send-push-notification', {
          body: {
            notificationId: data.id,
            userId,
            title,
            message,
            type,
            relatedContentId,
            relatedContentType,
            route: destination
          }
        })
        .then(({ data: pushRes, error: pushErr }) => {
          if (pushErr) {
            console.warn('[NotificationsService] Push delivery dispatch error:', pushErr.message);
          } else {
            console.log('[NotificationsService] Push delivery result:', pushRes);
          }
        })
        .catch((pushErr) => {
          console.warn('[NotificationsService] Push delivery dispatch note:', pushErr?.message || pushErr);
        });
    }

    return { success: true, data };
  } catch (err) {
    console.error('[NotificationsService] createNotification exception:', err);
    return { success: false, error: err.message };
  }
};

/**
 * Subscribe to realtime notification changes for the current user.
 * Notifies the callback whenever a notification is INSERTed, UPDATEd, or DELETEd.
 */
export const subscribeToUserNotifications = (userId, onNotificationChange) => {
  if (!supabase || !userId || typeof onNotificationChange !== 'function') {
    return { unsubscribe: () => {} };
  }

  try {
    const channelName = `realtime-notifications-${userId.slice(0, 8)}-${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`
        },
        (payload) => {
          onNotificationChange(payload);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Connected to realtime stream
        }
      });

    return {
      unsubscribe: () => {
        try {
          supabase.removeChannel(channel);
        } catch (e) {
          console.warn('[NotificationsService] Error removing channel:', e);
        }
      }
    };
  } catch (err) {
    console.error('[NotificationsService] subscribeToUserNotifications exception:', err);
    return { unsubscribe: () => {} };
  }
};
