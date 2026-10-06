import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.8';

/**
 * Supabase Edge Function: send-push-notification
 *
 * Responsibilities:
 * 1. Authenticate & validate caller (admin, self-notification, or service-role trigger).
 * 2. Identify target user(s) and fetch active FCM tokens from public.user_push_tokens.
 * 3. Securely authenticate with Firebase Cloud Messaging (FCM) v1 HTTP API using service account credentials.
 * 4. Dispatch rich notifications (title, body, payload, routing, badges) to Android and iOS devices.
 * 5. Automatically detect and deactivate stale/unregistered FCM tokens in Supabase.
 *
 * SECURITY:
 * - Firebase Service Account credentials reside ONLY in Edge Function secrets.
 * - Client devices never have access to private keys or server tokens.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// In-memory cache for OAuth2 access token
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

/**
 * Convert base64 / base64url string to Uint8Array
 */
function base64ToUint8Array(base64: string): Uint8Array {
  // Normalize base64url to standard base64
  let normalized = base64.replace(/-/g, '+').replace(/_/g, '/');
  while (normalized.length % 4 !== 0) {
    normalized += '=';
  }
  const binaryString = atob(normalized);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert ArrayBuffer to base64url string
 */
function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Import PEM RSA private key for Web Crypto signing (RS256)
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // Strip header, footer, and whitespace
  const cleanPem = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');

  const binaryDer = base64ToUint8Array(cleanPem);

  return await crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256'
    },
    false,
    ['sign']
  );
}

/**
 * Generate Google OAuth2 Access Token from Firebase Service Account
 */
async function getGoogleAccessToken(serviceAccount: {
  client_email: string;
  private_key: string;
  project_id: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  // Return cached token if still valid (buffer of 60 seconds)
  if (cachedAccessToken && cachedAccessToken.expiresAt > now + 60) {
    return cachedAccessToken.token;
  }

  const header = {
    alg: 'RS256',
    typ: 'JWT'
  };

  const claims = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const encodedHeader = btoa(JSON.stringify(header))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const encodedClaims = btoa(JSON.stringify(claims))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const unsignedToken = `${encodedHeader}.${encodedClaims}`;
  const cryptoKey = await importPrivateKey(serviceAccount.private_key);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );

  const signedJwt = `${unsignedToken}.${arrayBufferToBase64Url(signature)}`;

  // Exchange signed JWT for OAuth2 access token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${signedJwt}`
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    throw new Error(`Failed to obtain Google access token: ${tokenResponse.status} ${errorText}`);
  }

  const tokenData = await tokenResponse.json();
  cachedAccessToken = {
    token: tokenData.access_token,
    expiresAt: now + (tokenData.expires_in || 3600)
  };

  return cachedAccessToken.token;
}

/**
 * Retrieve Firebase service account from environment secrets
 */
function getFirebaseConfig(): {
  client_email: string;
  private_key: string;
  project_id: string;
} | null {
  // Option A: Single JSON secret
  const rawServiceAccount = Deno.env.get('FIREBASE_SERVICE_ACCOUNT');
  if (rawServiceAccount) {
    try {
      const parsed = JSON.parse(rawServiceAccount);
      if (parsed.client_email && parsed.private_key && parsed.project_id) {
        return {
          client_email: parsed.client_email,
          private_key: parsed.private_key,
          project_id: parsed.project_id
        };
      }
    } catch (e) {
      console.warn('[send-push-notification] Failed to parse FIREBASE_SERVICE_ACCOUNT JSON:', e);
    }
  }

  // Option B: Individual environment secrets
  const projectId = Deno.env.get('FIREBASE_PROJECT_ID');
  const clientEmail = Deno.env.get('FIREBASE_CLIENT_EMAIL');
  const privateKey = Deno.env.get('FIREBASE_PRIVATE_KEY');

  if (projectId && clientEmail && privateKey) {
    return {
      project_id: projectId,
      client_email: clientEmail,
      // Handle escaped newlines in env variables
      private_key: privateKey.replace(/\\n/g, '\n')
    };
  }

  return null;
}

serve(async (req: Request) => {
  // 1. Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 2. Parse request payload
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON request body' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const {
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
      badge = 1,
      dryRun = false
    } = body;

    if (!title || !message) {
      return new Response(
        JSON.stringify({ error: 'Title and message are required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // 3. Initialize Supabase Admin Client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'https://nflcrjyxgwaedzmlbaqj.supabase.co';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 4. Verify caller authorization if authorization header provided
    const authHeader = req.headers.get('Authorization');
    let requestingUserId: string | null = null;
    let isCallerAdmin = false;

    if (authHeader) {
      const { data: { user } } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''));
      if (user) {
        requestingUserId = user.id;
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle();
        if (profile?.role === 'admin') {
          isCallerAdmin = true;
        }
      }
    }

    // Security check: Non-admin users can only target themselves
    if (requestingUserId && !isCallerAdmin) {
      if (broadcast || (userIds && userIds.length > 1) || (userId && userId !== requestingUserId)) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized: Only administrators can broadcast or target other users' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
        );
      }
    }

    // 5. Query active FCM tokens from Supabase
    let tokensQuery = supabaseAdmin
      .from('user_push_tokens')
      .select('id, user_id, fcm_token, platform')
      .eq('is_active', true);

    if (broadcast) {
      // Broadcast to all active devices
    } else if (Array.isArray(userIds) && userIds.length > 0) {
      tokensQuery = tokensQuery.in('user_id', userIds);
    } else if (userId) {
      tokensQuery = tokensQuery.eq('user_id', userId);
    } else if (requestingUserId) {
      tokensQuery = tokensQuery.eq('user_id', requestingUserId);
    } else {
      return new Response(
        JSON.stringify({ error: 'Missing target user ID(s) or broadcast flag' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const { data: activeTokens, error: tokensError } = await tokensQuery;

    if (tokensError) {
      console.error('[send-push-notification] Error fetching tokens:', tokensError);
      return new Response(
        JSON.stringify({ error: `Database error querying tokens: ${tokensError.message}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    const totalTokensFound = activeTokens?.length || 0;

    // Determine destination route
    let finalRoute = route;
    if (!finalRoute) {
      if (type === 'spark' || relatedContentType === 'spark') {
        finalRoute = relatedContentId ? `spark/${relatedContentId}` : 'today';
      } else if (type === 'video' || relatedContentType === 'video') {
        finalRoute = relatedContentId ? `videos/videos/${relatedContentId}` : 'videos';
      } else if (type === 'audio' || relatedContentType === 'audio') {
        finalRoute = relatedContentId ? `audios/audios/${relatedContentId}` : 'audios';
      } else if (type === 'vip' || relatedContentType === 'vip') {
        finalRoute = 'vip-pass';
      } else if (type === 'streak' || type === 'profile') {
        finalRoute = 'profile';
      } else {
        finalRoute = 'notifications';
      }
    }

    // If dry run or no active tokens, return status immediately
    if (dryRun) {
      return new Response(
        JSON.stringify({
          success: true,
          dryRun: true,
          totalTokens: totalTokensFound,
          message: `Dry run completed. Found ${totalTokensFound} active device token(s).`
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    if (totalTokensFound === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          totalTokens: 0,
          sentCount: 0,
          message: 'Notification stored in database; target user has no active push device tokens registered.'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // 6. Check Firebase configuration
    const firebaseConfig = getFirebaseConfig();
    if (!firebaseConfig) {
      console.warn('[send-push-notification] Firebase server credentials not configured in Edge Function secrets.');
      return new Response(
        JSON.stringify({
          success: false,
          configured: false,
          totalTokens: totalTokensFound,
          error: 'Firebase service account credentials are not configured in Supabase Edge Function secrets.',
          instructions: 'Set FIREBASE_SERVICE_ACCOUNT secret using: npx supabase secrets set FIREBASE_SERVICE_ACCOUNT=\'{"project_id":"...","client_email":"...","private_key":"..."}\''
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // 7. Obtain Google OAuth2 access token for FCM v1
    const googleToken = await getGoogleAccessToken(firebaseConfig);
    const fcmEndpoint = `https://fcm.googleapis.com/v1/projects/${firebaseConfig.project_id}/messages:send`;

    let sentCount = 0;
    let failedCount = 0;
    const staleTokens: string[] = [];
    const dispatchErrors: Array<{ token: string; error: string }> = [];

    // 8. Dispatch notification to each active FCM token
    for (const item of activeTokens) {
      const fcmMessage = {
        message: {
          token: item.fcm_token,
          notification: {
            title: title,
            body: message
          },
          data: {
            notificationId: String(notificationId || ''),
            type: String(type || 'general'),
            relatedContentId: String(relatedContentId || ''),
            relatedContentType: String(relatedContentType || ''),
            route: String(finalRoute),
            timestamp: new Date().toISOString()
          },
          android: {
            priority: 'HIGH',
            notification: {
              channel_id: 'drcubie_notifications',
              color: '#e5a95a',
              icon: 'ic_notification',
              default_sound: true,
              default_vibrate_timings: true
            }
          },
          apns: {
            headers: {
              'apns-priority': '10'
            },
            payload: {
              aps: {
                alert: {
                  title: title,
                  body: message
                },
                badge: Number(badge) || 1,
                sound: 'default'
              }
            }
          }
        }
      };

      try {
        const fcmRes = await fetch(fcmEndpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${googleToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(fcmMessage)
        });

        if (fcmRes.ok) {
          sentCount++;
        } else {
          failedCount++;
          const errBody = await fcmRes.text();
          let errDetail = errBody;
          try {
            const parsedErr = JSON.parse(errBody);
            errDetail = parsedErr.error?.message || errBody;
          } catch {
            // keep raw text
          }

          dispatchErrors.push({ token: item.fcm_token.slice(0, 12) + '...', error: errDetail });

          // Detect stale / unregistered tokens
          if (
            fcmRes.status === 404 ||
            /UNREGISTERED|NOT_FOUND|registration-token-not-registered/i.test(errDetail)
          ) {
            staleTokens.push(item.fcm_token);
          }
        }
      } catch (err) {
        failedCount++;
        dispatchErrors.push({
          token: item.fcm_token.slice(0, 12) + '...',
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }

    // 9. Deactivate stale tokens if detected
    if (staleTokens.length > 0) {
      await supabaseAdmin
        .from('user_push_tokens')
        .update({ is_active: false })
        .in('fcm_token', staleTokens);
      console.log(`[send-push-notification] Deactivated ${staleTokens.length} stale FCM token(s).`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        configured: true,
        totalTokens: totalTokensFound,
        sentCount,
        failedCount,
        staleTokensDeactivated: staleTokens.length,
        errors: dispatchErrors.length > 0 ? dispatchErrors.slice(0, 5) : []
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (err) {
    console.error('[send-push-notification] Exception:', err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'Internal Server Error'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
