-- ==============================================================================
-- DR. CUBIE INSPIRATION - CREATE USER PUSH TOKENS TABLE & RLS
-- ==============================================================================
-- Migration: 20261005000000_create_push_notifications.sql
-- Description:
--   1. Creates user-scoped public.user_push_tokens table referencing auth.users(id).
--   2. Supports multiple devices per user (Android, iOS, Web).
--   3. Enables Row Level Security (RLS) for strict user isolation.
--   4. Adds helper functions to register/deactivate tokens safely.
--   5. Grants access to authenticated users and service_role.
-- ==============================================================================

-- 1. CREATE USER_PUSH_TOKENS TABLE
CREATE TABLE IF NOT EXISTS public.user_push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fcm_token text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
  device_id text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT user_push_tokens_user_token_unique UNIQUE (user_id, fcm_token)
);

-- 2. CREATE INDEXES FOR FAST LOOKUPS
CREATE INDEX IF NOT EXISTS idx_push_tokens_user_active 
  ON public.user_push_tokens (user_id) 
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_push_tokens_fcm_token 
  ON public.user_push_tokens (fcm_token);

CREATE INDEX IF NOT EXISTS idx_push_tokens_platform
  ON public.user_push_tokens (platform);

-- 3. ENABLE ROW LEVEL SECURITY (RLS)
ALTER TABLE public.user_push_tokens ENABLE ROW LEVEL SECURITY;

-- 4. RLS POLICIES (Strict User-Specific Isolation)

-- SELECT: Users can only read their own device tokens (admins can view all)
DROP POLICY IF EXISTS "Users can view only their own push tokens" ON public.user_push_tokens;
CREATE POLICY "Users can view only their own push tokens"
  ON public.user_push_tokens FOR SELECT
  USING (auth.uid() = user_id OR public.is_admin());

-- INSERT: Users can only insert tokens for their own account
DROP POLICY IF EXISTS "Users can insert only their own push tokens" ON public.user_push_tokens;
CREATE POLICY "Users can insert only their own push tokens"
  ON public.user_push_tokens FOR INSERT
  WITH CHECK (auth.uid() = user_id OR public.is_admin());

-- UPDATE: Users can only update their own tokens
DROP POLICY IF EXISTS "Users can update only their own push tokens" ON public.user_push_tokens;
CREATE POLICY "Users can update only their own push tokens"
  ON public.user_push_tokens FOR UPDATE
  USING (auth.uid() = user_id OR public.is_admin())
  WITH CHECK (auth.uid() = user_id OR public.is_admin());

-- DELETE: Users can only delete their own tokens
DROP POLICY IF EXISTS "Users can delete only their own push tokens" ON public.user_push_tokens;
CREATE POLICY "Users can delete only their own push tokens"
  ON public.user_push_tokens FOR DELETE
  USING (auth.uid() = user_id OR public.is_admin());

-- 5. GRANTS
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_push_tokens TO authenticated;
GRANT ALL ON TABLE public.user_push_tokens TO service_role;

-- 6. TRIGGER FOR updated_at
DROP TRIGGER IF EXISTS set_user_push_tokens_updated_at ON public.user_push_tokens;
CREATE TRIGGER set_user_push_tokens_updated_at
  BEFORE UPDATE ON public.user_push_tokens
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- 7. HELPER RPC: register_push_token
-- Safely registers an FCM token for the currently authenticated user.
-- If the token was previously registered to another user on the same physical device,
-- marks the old record as inactive to prevent notification leakage.
CREATE OR REPLACE FUNCTION public.register_push_token(
  p_fcm_token text,
  p_platform text,
  p_device_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_record public.user_push_tokens;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to register push token';
  END IF;

  IF p_fcm_token IS NULL OR trim(p_fcm_token) = '' THEN
    RAISE EXCEPTION 'Valid FCM token is required';
  END IF;

  IF p_platform NOT IN ('android', 'ios', 'web') THEN
    RAISE EXCEPTION 'Invalid platform. Must be android, ios, or web';
  END IF;

  -- 1. Deactivate this token for any other user on this device
  UPDATE public.user_push_tokens
  SET is_active = false, updated_at = timezone('utc'::text, now())
  WHERE fcm_token = p_fcm_token AND user_id <> v_user_id;

  -- 2. Upsert token for current user
  INSERT INTO public.user_push_tokens (
    user_id,
    fcm_token,
    platform,
    device_id,
    is_active,
    created_at,
    updated_at
  )
  VALUES (
    v_user_id,
    p_fcm_token,
    p_platform,
    p_device_id,
    true,
    timezone('utc'::text, now()),
    timezone('utc'::text, now())
  )
  ON CONFLICT (user_id, fcm_token)
  DO UPDATE SET
    platform = EXCLUDED.platform,
    device_id = COALESCE(EXCLUDED.device_id, public.user_push_tokens.device_id),
    is_active = true,
    updated_at = timezone('utc'::text, now())
  RETURNING * INTO v_record;

  RETURN jsonb_build_object(
    'id', v_record.id,
    'user_id', v_record.user_id,
    'fcm_token', v_record.fcm_token,
    'platform', v_record.platform,
    'device_id', v_record.device_id,
    'is_active', v_record.is_active,
    'updated_at', v_record.updated_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_push_token(text, text, text) TO authenticated, service_role;

-- 8. HELPER RPC: deactivate_push_token
-- Deactivates a specific token when a user signs out or disables notifications.
CREATE OR REPLACE FUNCTION public.deactivate_push_token(
  p_fcm_token text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.user_push_tokens
  SET is_active = false, updated_at = timezone('utc'::text, now())
  WHERE user_id = v_user_id AND fcm_token = p_fcm_token;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.deactivate_push_token(text) TO authenticated, service_role;
