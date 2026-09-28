-- Admin RPCs remain callable by authenticated users only; each function
-- checks membership in the admins table.
REVOKE EXECUTE ON FUNCTION public.admin_create_promotional_campaign(text, text, integer, integer, text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_force_logout_user(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_get_analytics_overview(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_search_users(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_promotional_campaign(text, text, integer, integer, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_force_logout_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_analytics_overview(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_search_users(text) TO authenticated;

-- Direct promotional grants are trusted server-side/trigger operations.
REVOKE EXECUTE ON FUNCTION public.grant_promotional_benefit(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- User-owned session/test lifecycle operations require auth.uid().
REVOKE EXECUTE ON FUNCTION public.start_reattempt(uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_session_duration(uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_page_opened(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_test_started(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.register_active_session() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.validate_active_session(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.clear_active_session_if_current(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.start_reattempt(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_session_duration(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_page_opened(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_test_started(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_active_session() TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_active_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_active_session_if_current(uuid) TO authenticated;
