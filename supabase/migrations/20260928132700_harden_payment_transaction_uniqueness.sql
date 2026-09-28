-- A Razorpay order and a Razorpay payment must identify only one
-- purchase transaction. Partial indexes preserve compatibility with
-- legacy rows where these fields are null.

CREATE UNIQUE INDEX IF NOT EXISTS purchase_transactions_order_id_uidx
ON public.purchase_transactions(order_id)
WHERE order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS purchase_transactions_payment_gateway_id_uidx
ON public.purchase_transactions(payment_gateway_id)
WHERE payment_gateway_id IS NOT NULL;
