-- These functions mutate paid entitlements and are only called by
-- server-side fulfillment code. They must never be directly callable
-- by anonymous or authenticated clients.

REVOKE EXECUTE ON FUNCTION public.extend_or_create_pass(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.extend_or_create_pass(uuid, text, integer)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.upgrade_pass_to_combo(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.upgrade_pass_to_combo(uuid)
  TO service_role;
