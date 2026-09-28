CREATE OR REPLACE FUNCTION public.complete_mock_session(
  p_session_id uuid, p_exam_name text, p_passage_title text, p_gross_wpm numeric,
  p_net_wpm numeric, p_accuracy numeric, p_errors integer, p_total_words integer,
  p_mock_name text, p_category text, p_passage_id uuid, p_is_completed boolean,
  p_is_passed boolean, p_words_typed integer
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE
  v_uid uuid:=auth.uid(); v_session mock_test_sessions; v_mock mock_tests;
  v_passage passages; v_result_id uuid; v_duration integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_session FROM mock_test_sessions WHERE id=p_session_id AND user_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session not found or does not belong to this user'; END IF;
  IF v_session.status!='in_progress' THEN RAISE EXCEPTION 'Session is not in progress (status: %)',v_session.status; END IF;
  SELECT * INTO v_mock FROM mock_tests WHERE id=v_session.mock_test_id;
  IF NOT FOUND OR v_mock.active IS NOT TRUE THEN RAISE EXCEPTION 'Mock is not available'; END IF;
  IF v_mock.passage_id IS NULL THEN RAISE EXCEPTION 'Mock has no assigned passage'; END IF;
  SELECT * INTO v_passage FROM passages WHERE id=v_mock.passage_id AND active=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assigned passage is not available'; END IF;
  IF p_passage_id IS NOT NULL AND p_passage_id<>v_mock.passage_id THEN RAISE EXCEPTION 'Passage does not match the assigned mock'; END IF;
  IF p_gross_wpm IS NULL OR p_gross_wpm<0 OR p_gross_wpm>500
     OR p_net_wpm IS NULL OR p_net_wpm<-500 OR p_net_wpm>500
     OR p_accuracy IS NULL OR p_accuracy<0 OR p_accuracy>100
     OR p_errors IS NULL OR p_errors<0 OR p_total_words IS NULL OR p_total_words<0
     OR p_words_typed IS NULL OR p_words_typed<0 OR p_words_typed>p_total_words
  THEN RAISE EXCEPTION 'Invalid test result metrics'; END IF;
  v_duration:=coalesce(v_session.duration,case when v_mock.duration<=7 then 5 else 10 end);
  INSERT INTO mock_test_results(user_id,mock_test_id,mock_name,category,passage_id,passage_title,duration,gross_wpm,net_wpm,accuracy,errors,total_words,is_completed,is_passed,words_typed,exam_name,session_id)
  VALUES(v_uid,v_session.mock_test_id,v_mock.title,v_mock.category,v_mock.passage_id,v_passage.title,v_duration,p_gross_wpm,p_net_wpm,p_accuracy,p_errors,p_total_words,true,coalesce(p_is_passed,false),p_words_typed,v_passage.exam_name,p_session_id)
  RETURNING id INTO v_result_id;
  UPDATE mock_test_sessions SET status='completed',result_id=v_result_id,last_activity_at=now(),
    reattempt_window_expires_at=CASE WHEN v_session.is_reattempt=false THEN now()+interval '6 hours' ELSE v_session.reattempt_window_expires_at END
    WHERE id=p_session_id;
  RETURN v_result_id;
END;$function$;