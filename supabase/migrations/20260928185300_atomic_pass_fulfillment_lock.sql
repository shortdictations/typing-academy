-- Serialize pass grants for the same user/pass type.
-- This prevents concurrent Razorpay callback/webhook retries from
-- double-extending or double-creating a pass.

CREATE OR REPLACE FUNCTION public.extend_or_create_pass(
  p_user_id uuid,
  p_pass_type text,
  p_validity_days integer
)
RETURNS public.user_passes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_existing public.user_passes;
  v_result public.user_passes;
BEGIN
  IF p_pass_type NOT IN ('SSC', 'LEGAL', 'COMBO') THEN
    RAISE EXCEPTION 'Invalid pass_type: %', p_pass_type;
  END IF;

  IF p_validity_days IS NULL OR p_validity_days <= 0 THEN
    RAISE EXCEPTION 'validity_days must be a positive number';
  END IF;

  -- Serialize grants for this exact user/pass-type pair for the
  -- duration of this database transaction.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_pass_type, 0)
  );

  SELECT *
  INTO v_existing
  FROM public.user_passes
  WHERE user_id = p_user_id
    AND pass_type = p_pass_type
    AND status != 'cancelled'
    AND expires_at > now()
  ORDER BY expires_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.user_passes
    SET expires_at = v_existing.expires_at + make_interval(days => p_validity_days),
        updated_at = now()
    WHERE id = v_existing.id
    RETURNING * INTO v_result;
  ELSE
    INSERT INTO public.user_passes
      (user_id, pass_type, starts_at, expires_at, status)
    VALUES
      (p_user_id, p_pass_type, now(),
       now() + make_interval(days => p_validity_days), 'active')
    RETURNING * INTO v_result;
  END IF;

  RETURN v_result;
END;
$function$;
