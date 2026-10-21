alter table public.purchase_transactions
  drop constraint if exists purchase_transactions_status_check;

alter table public.purchase_transactions
  add constraint purchase_transactions_status_check
  check (status = any (array['created'::text, 'pending'::text, 'paid'::text, 'failed'::text, 'cancelled'::text, 'refunded'::text]));
