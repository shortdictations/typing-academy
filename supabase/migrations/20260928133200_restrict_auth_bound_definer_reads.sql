-- Both functions depend on auth.uid() and return user-specific state.
REVOKE EXECUTE ON FUNCTION public.resolve_pass_purchase(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_pass_purchase(uuid, boolean) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_next_mock(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_next_mock(text) TO authenticated;
