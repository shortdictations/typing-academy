-- Keep the canonical unique order_id index and remove redundant duplicates.
DROP INDEX IF EXISTS public.purchase_transactions_order_id_idx;
DROP INDEX IF EXISTS public.purchase_transactions_order_id_unique_idx;
