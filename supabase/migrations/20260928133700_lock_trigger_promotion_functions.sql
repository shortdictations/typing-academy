-- Trigger-only promotion functions must never be directly callable by clients.
REVOKE EXECUTE ON FUNCTION public.grant_new_user_promotional_campaigns() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.grant_signup_free_credits() FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public.grant_new_user_promotional_campaigns() OWNER TO postgres;
ALTER FUNCTION public.grant_signup_free_credits() OWNER TO postgres;