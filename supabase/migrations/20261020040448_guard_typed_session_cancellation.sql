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

  -- Explicit cancellation is permitted only before the first keystroke.
  -- An already-typed session remains resumable if its six-hour window is open.
  IF p_force_cancel AND v_session.typing_started_at IS NOT NULL THEN
    RETURN QUERY SELECT v_session.status, false;
    RETURN;
  END IF;

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

      DELETE FROM public.mock_unlocks
      WHERE user_id = v_uid
        AND mock_test_id = v_session.mock_test_id
        AND wallet_credit_id = v_session.wallet_credit_id;
    END IF;
  END IF;

  UPDATE public.mock_test_sessions
  SET status = 'expired', last_activity_at = now()
  WHERE id = v_session.id AND status = 'in_progress';

  RETURN QUERY SELECT 'expired'::text, v_refunded;
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_unstarted_mock_session(uuid, boolean) FROM PUBLIC, anon, authenticated;
