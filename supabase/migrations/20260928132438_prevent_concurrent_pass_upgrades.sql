-- A user can only have one active upgrade purchase at a time.
-- This closes the race where two requests both see an SSC/LEGAL pass
-- and create separate Combo upgrade orders before either fulfillment
-- converts the source pass.

CREATE UNIQUE INDEX IF NOT EXISTS purchase_transactions_one_active_upgrade_per_user_uidx
ON public.purchase_transactions(user_id)
WHERE transaction_type = 'UPGRADE'
  AND status IN ('created', 'paid');
