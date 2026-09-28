-- Enforce the TypeShala unattempted-first rule at the database layer.
-- A normal start may only select an active mock for which the user has
-- no completed result. Reattempts remain available through start_reattempt().
CREATE OR REPLACE FUNCTION public.start_or_resume_mock_test(p_category text, p_duration integer)
RETURNS TABLE(session_id uuid, mock_test_id uuid, is_resumed boolean, access_reason text, mock_title text, mock_category text, mock_duration integer, session_started_at timestamptz, page_opened boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE
  v_uid uuid:=auth.uid(); v_existing mock_test_sessions; v_expiry_hours integer;
  v_eligible_pass boolean; v_mock mock_tests; v_lot_id uuid; v_lot_type text;
  v_new_session_id uuid; v_unlock_id uuid; v_txn_id uuid; v_credit_charged boolean:=false;
  v_existing_mock mock_tests;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_category NOT IN ('ssc','legal') THEN RAISE EXCEPTION 'Invalid category: %',p_category; END IF;
  IF p_duration NOT IN (5,10) THEN RAISE EXCEPTION 'Invalid duration: %',p_duration; END IF;

  SELECT mock_session_expiry_hours INTO v_expiry_hours FROM app_settings LIMIT 1;
  v_expiry_hours:=coalesce(v_expiry_hours,2);

  SELECT * INTO v_existing FROM mock_test_sessions
  WHERE user_id=v_uid AND status='in_progress' LIMIT 1;
  IF FOUND THEN
    IF v_existing.last_activity_at < now()-make_interval(hours=>v_expiry_hours) THEN
      UPDATE mock_test_sessions SET status='expired' WHERE id=v_existing.id;
    ELSE
      UPDATE mock_test_sessions SET last_activity_at=now() WHERE id=v_existing.id;
      SELECT * INTO v_existing_mock FROM mock_tests WHERE id=v_existing.mock_test_id;
      RETURN QUERY SELECT v_existing.id,v_existing.mock_test_id,true,'RESUMED'::text,
        v_existing_mock.title,v_existing.category,v_existing_mock.duration,
        coalesce(v_existing.test_started_at,v_existing.started_at),
        (v_existing.page_opened_at IS NOT NULL);
      RETURN;
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM user_passes WHERE user_id=v_uid AND status!='cancelled'
      AND starts_at<=now() AND expires_at>now()
      AND ((p_category='ssc' AND pass_type IN ('SSC','COMBO'))
        OR (p_category='legal' AND pass_type IN ('LEGAL','COMBO')))
  ) INTO v_eligible_pass;

  IF NOT v_eligible_pass THEN
    SELECT id,credit_type INTO v_lot_id,v_lot_type FROM wallet_credits
    WHERE user_id=v_uid AND credits_remaining>0 AND expires_at>now()
    ORDER BY (credit_type='free') DESC,expires_at ASC LIMIT 1 FOR UPDATE;
    IF v_lot_id IS NULL THEN
      RETURN QUERY SELECT null::uuid,null::uuid,false,'NO_CREDITS'::text,null::text,null::text,null::integer,null::timestamptz,null::boolean;
      RETURN;
    END IF;
  END IF;

  -- Only a mock never completed by this user is eligible for a normal start.
  SELECT m.* INTO v_mock FROM mock_tests m
  WHERE m.category=p_category AND m.active=true
    AND NOT EXISTS (
      SELECT 1 FROM mock_test_results r
      WHERE r.user_id=v_uid AND r.mock_test_id=m.id AND r.is_completed=true
    )
  ORDER BY random() LIMIT 1;

  IF v_mock.id IS NULL THEN
    RETURN QUERY SELECT null::uuid,null::uuid,false,'NO_ELIGIBLE_MOCK'::text,null::text,null::text,null::integer,null::timestamptz,null::boolean;
    RETURN;
  END IF;

  BEGIN
    IF NOT v_eligible_pass THEN
      UPDATE wallet_credits SET credits_remaining=credits_remaining-1 WHERE id=v_lot_id;
      v_credit_charged:=true;
      INSERT INTO mock_unlocks(user_id,mock_test_id,wallet_credit_id)
        VALUES(v_uid,v_mock.id,v_lot_id) RETURNING id INTO v_unlock_id;
      INSERT INTO credit_transactions(user_id,transaction_type,credits,source,test_id)
        VALUES(v_uid,'credit_used',-1,v_lot_type,v_mock.id) RETURNING id INTO v_txn_id;
    END IF;

    INSERT INTO mock_test_sessions(user_id,mock_test_id,category,access_method,is_reattempt,duration)
      VALUES(v_uid,v_mock.id,p_category,CASE WHEN v_eligible_pass THEN 'pass' ELSE 'credit' END,false,p_duration)
      RETURNING id INTO v_new_session_id;
  EXCEPTION WHEN unique_violation THEN
    IF v_credit_charged THEN
      UPDATE wallet_credits SET credits_remaining=credits_remaining+1 WHERE id=v_lot_id;
      IF v_unlock_id IS NOT NULL THEN DELETE FROM mock_unlocks WHERE id=v_unlock_id; END IF;
      IF v_txn_id IS NOT NULL THEN DELETE FROM credit_transactions WHERE id=v_txn_id; END IF;
    END IF;
    SELECT * INTO v_existing FROM mock_test_sessions WHERE user_id=v_uid AND status='in_progress' LIMIT 1;
    SELECT * INTO v_existing_mock FROM mock_tests WHERE id=v_existing.mock_test_id;
    RETURN QUERY SELECT v_existing.id,v_existing.mock_test_id,true,'RESUMED'::text,
      v_existing_mock.title,v_existing.category,v_existing_mock.duration,
      coalesce(v_existing.test_started_at,v_existing.started_at),
      (v_existing.page_opened_at IS NOT NULL);
    RETURN;
  END;

  RETURN QUERY SELECT v_new_session_id,v_mock.id,false,
    (CASE WHEN v_eligible_pass THEN 'PASS' ELSE 'CREDIT_USED' END)::text,
    null::text,null::text,null::integer,null::timestamptz,null::boolean;
END;$function$;