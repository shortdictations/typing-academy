-- Refund credits only when a mock session is cancelled/expired before the first keystroke.
ALTER TABLE public.mock_test_sessions
  ADD COLUMN IF NOT EXISTS typing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS wallet_credit_id uuid REFERENCES public.wallet_credits(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS credit_refunded_at timestamptz;

-- Associate a newly created credit-funded session with the exact wallet lot spent.
CREATE OR REPLACE FUNCTION public.capture_mock_session_credit_lot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_wallet_credit_id uuid;
BEGIN
  IF NEW.access_method = 'credit' AND NEW.wallet_credit_id IS NULL THEN
    SELECT mu.wallet_credit_id
      INTO v_wallet_credit_id
    FROM public.mock_unlocks mu
    WHERE mu.user_id = NEW.user_id
      AND mu.mock_test_id = NEW.mock_test_id
      AND mu.wallet_credit_id IS NOT NULL
    ORDER BY mu.unlocked_at DESC NULLS LAST
    LIMIT 1;

    IF v_wallet_credit_id IS NOT NULL THEN
      UPDATE public.mock_test_sessions
      SET wallet_credit_id = v_wallet_credit_id
      WHERE id = NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_capture_mock_session_credit_lot ON public.mock_test_sessions;
CREATE TRIGGER trg_capture_mock_session_credit_lot
AFTER INSERT ON public.mock_test_sessions
FOR EACH ROW
EXECUTE FUNCTION public.capture_mock_session_credit_lot();

-- Internal, idempotent finalizer. It refunds only sessions with no recorded first keystroke.
CREATE OR REPLACE FUNCTION public.finalize_unstarted_mock_session(
  p_session_id uuid,
  p_force_cancel boolean DEFAULT false
)
RETURNS TABLE(session_status text, credit_refunded boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.mock_test_sessions;
  v_expiry_hours integer;
  v_refunded boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_session
  FROM public.mock_test_sessions
  WHERE id = p_session_id AND user_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, false;
    RETURN;
  END IF;

  IF v_session.status NOT IN ('in_progress', 'expired') THEN
    RETURN QUERY SELECT v_session.status, false;
    RETURN;
  END IF;

  SELECT mock_session_expiry_hours INTO v_expiry_hours
  FROM public.app_settings LIMIT 1;
  v_expiry_hours := coalesce(v_expiry_hours, 6);

  IF NOT p_force_cancel
     AND coalesce(v_session.test_started_at, v_session.started_at)
         >= now() - make_interval(hours => v_expiry_hours) THEN
    RETURN QUERY SELECT v_session.status, false;
    RETURN;
  END IF;

  -- If typing began, the session can expire but must never receive a refund.
  IF v_session.typing_started_at IS NULL
     AND v_session.access_method = 'credit'
     AND v_session.is_reattempt = false
     AND v_session.wallet_credit_id IS NOT NULL
     AND v_session.credit_refunded_at IS NULL THEN
    UPDATE public.wallet_credits
    SET credits_remaining = least(credits_total, credits_remaining + 1)
    WHERE id = v_session.wallet_credit_id
      AND user_id = v_uid
      AND expires_at > now();

    IF FOUND THEN
      v_refunded := true;

      UPDATE public.mock_test_sessions
      SET credit_refunded_at = now()
      WHERE id = v_session.id;

      INSERT INTO public.credit_transactions
        (user_id, transaction_type, credits, source, test_id)
      VALUES
        (v_uid, 'credit_refund', 1,
         CASE WHEN p_force_cancel THEN 'unstarted_cancel' ELSE 'unstarted_expiry' END,
         v_session.mock_test_id);

      -- Permit the same mock to be selected again after its credit was refunded.
      DELETE FROM public.mock_unlocks
      WHERE user_id = v_uid
        AND mock_test_id = v_session.mock_test_id
        AND wallet_credit_id = v_session.wallet_credit_id;
    END IF;
  END IF;

  UPDATE public.mock_test_sessions
  SET status = 'expired', last_activity_at = now()
  WHERE id = v_session.id AND status = 'in_progress';

  RETURN QUERY
  SELECT 'expired'::text, v_refunded;
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_unstarted_mock_session(uuid, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cancel_unstarted_mock_session(p_session_id uuid)
RETURNS TABLE(session_status text, credit_refunded boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  RETURN QUERY
  SELECT * FROM public.finalize_unstarted_mock_session(p_session_id, true);
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_unstarted_mock_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_unstarted_mock_session(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_mock_typing_started(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  UPDATE public.mock_test_sessions
  SET typing_started_at = coalesce(typing_started_at, now()),
      last_activity_at = now()
  WHERE id = p_session_id
    AND user_id = v_uid
    AND status = 'in_progress'
    AND test_started_at IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_ACTIVE_OR_NOT_STARTED';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_mock_typing_started(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_mock_typing_started(uuid) TO authenticated;

-- Expiry processing also refunds a credit if the user never typed and returned only after six hours.
CREATE OR REPLACE FUNCTION public.get_mock_session_resume_status(p_session_id uuid)
RETURNS TABLE(session_status text, resume_expires_at timestamptz, server_now timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.mock_test_sessions;
  v_expiry_hours integer;
  v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_session
  FROM public.mock_test_sessions
  WHERE id = p_session_id AND user_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, null::timestamptz, v_now;
    RETURN;
  END IF;

  SELECT mock_session_expiry_hours INTO v_expiry_hours
  FROM public.app_settings LIMIT 1;
  v_expiry_hours := coalesce(v_expiry_hours, 6);

  IF v_session.status = 'in_progress'
     AND coalesce(v_session.test_started_at, v_session.started_at)
         < v_now - make_interval(hours => v_expiry_hours) THEN
    PERFORM * FROM public.finalize_unstarted_mock_session(p_session_id, false);

    SELECT * INTO v_session
    FROM public.mock_test_sessions
    WHERE id = p_session_id AND user_id = v_uid;
  END IF;

  RETURN QUERY SELECT v_session.status,
    coalesce(v_session.test_started_at, v_session.started_at) + make_interval(hours => v_expiry_hours),
    v_now;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_mock_session_resume_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mock_session_resume_status(uuid) TO authenticated;
