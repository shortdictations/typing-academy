-- These SECURITY DEFINER RPCs all depend on auth.uid() and must never
-- be callable by anonymous/public roles.
REVOKE EXECUTE ON FUNCTION public.can_access_mock(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_mock_access(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.start_mock_test(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.start_credit_test(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.start_or_resume_mock_test(text, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.complete_mock_session(uuid, text, text, numeric, numeric, numeric, integer, integer, text, text, uuid, boolean, boolean, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.can_access_mock(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_mock_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_mock_test(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_credit_test(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_or_resume_mock_test(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_mock_session(uuid, text, text, numeric, numeric, numeric, integer, integer, text, text, uuid, boolean, boolean, integer) TO authenticated;
