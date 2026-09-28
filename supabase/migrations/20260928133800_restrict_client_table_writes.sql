-- Defense-in-depth: entitlement, payment, session and ledger tables are
-- mutated only by trusted server-side RPCs/functions or admin policies.
REVOKE INSERT, UPDATE, DELETE ON public.admins FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.app_settings FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.credit_transactions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.mock_test_results FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.mock_test_sessions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.mock_unlocks FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.purchase_transactions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.promotional_campaigns FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.promotional_grants FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.subscriptions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_free_usage FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_passes FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_sessions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.wallet_credits FROM anon, authenticated;