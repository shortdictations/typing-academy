create table if not exists public.purchase_refunds (
  id uuid primary key default gen_random_uuid(),
  purchase_transaction_id uuid not null references public.purchase_transactions(id) on delete restrict,
  refund_gateway_id text not null unique,
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'processed' check (status in ('processed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.purchase_refunds enable row level security;
drop policy if exists "Users can view own purchase refunds" on public.purchase_refunds;
create policy "Users can view own purchase refunds" on public.purchase_refunds for select to authenticated using (
  exists (select 1 from public.purchase_transactions p where p.id=purchase_transaction_id and p.user_id=auth.uid())
  or exists (select 1 from public.admins a where a.user_id=auth.uid())
);
create index if not exists purchase_refunds_transaction_idx on public.purchase_refunds(purchase_transaction_id);
create or replace function public.record_purchase_refund(p_refund_gateway_id text,p_payment_gateway_id text,p_amount numeric,p_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_tx public.purchase_transactions%rowtype; v_total numeric;
begin
 select * into v_tx from public.purchase_transactions where payment_gateway_id=p_payment_gateway_id for update;
 if not found then return jsonb_build_object('recorded',false,'reason','unknown_payment'); end if;
 if p_amount is null or p_amount<=0 then raise exception 'Invalid refund amount'; end if;
 insert into public.purchase_refunds(purchase_transaction_id,refund_gateway_id,amount,metadata)
 values(v_tx.id,p_refund_gateway_id,p_amount,p_metadata) on conflict (refund_gateway_id) do nothing;
 select coalesce(sum(amount),0) into v_total from public.purchase_refunds where purchase_transaction_id=v_tx.id;
 if v_total >= v_tx.amount then
   update public.purchase_transactions set status='refunded',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('total_refunded_amount',v_total,'refund_status','processed') where id=v_tx.id;
 else
   update public.purchase_transactions set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('total_refunded_amount',v_total,'refund_status','partially_refunded') where id=v_tx.id;
 end if;
 return jsonb_build_object('recorded',true,'purchase_transaction_id',v_tx.id,'total_refunded_amount',v_total,'fully_refunded',v_total>=v_tx.amount);
end $$;
revoke all on function public.record_purchase_refund(text,text,numeric,jsonb) from public,anon,authenticated;
grant execute on function public.record_purchase_refund(text,text,numeric,jsonb) to service_role;