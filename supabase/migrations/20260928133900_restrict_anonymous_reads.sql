-- Defense-in-depth: anonymous clients do not need direct reads
-- from user-linked/private tables. Public catalog/content remains available.
REVOKE SELECT ON public.admins, public.app_settings, public.credit_transactions,
public.mock_test_results, public.mock_test_sessions, public.mock_unlocks,
public.notification_user_state, public.notifications, public.purchase_transactions,
public.promotional_campaigns, public.promotional_grants, public.subscriptions,
public.typing_key_stats, public.typing_results, public.user_free_usage,
public.user_passes, public.user_preferences, public.user_sessions, public.wallet_credits
FROM anon;
REVOKE SELECT ON public.mock_tests, public.passages FROM anon;