-- Roll back the unstarted-mock credit refund feature and restore the original
-- six-hour expiry behaviour without automatic credit refunds.
DROP TRIGGER IF EXISTS trg_capture_mock_session_credit_lot ON public.mock_test_sessions;
DROP FUNCTION IF EXISTS public.capture_mock_session_credit_lot();
DROP FUNCTION IF EXISTS public.cancel_unstarted_mock_session(uuid);
DROP FUNCTION IF EXISTS public.mark_mock_typing_started(uuid);
DROP FUNCTION IF EXISTS public.finalize_unstarted_mock_session(uuid, boolean);

ALTER TABLE public.mock_test_sessions
  DROP COLUMN IF EXISTS typing_started_at,
  DROP COLUMN IF EXISTS wallet_credit_id,
  DROP COLUMN IF EXISTS credit_refunded_at;

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
    UPDATE public.mock_test_sessions
    SET status = 'expired', last_activity_at = v_now
    WHERE id = v_session.id AND status = 'in_progress';

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
