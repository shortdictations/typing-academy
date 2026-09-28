-- Atomic credit purchase fulfillment
-- Applied to production on 2026-09-28.

ALTER TABLE public.wallet_credits
  ADD COLUMN IF NOT EXISTS purchase_transaction_id uuid;

ALTER TABLE public.credit_transactions
  ADD COLUMN IF NOT EXISTS purchase_transaction_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wallet_credits_purchase_transaction_id_fkey'
  ) THEN
    ALTER TABLE public.wallet_credits
      ADD CONSTRAINT wallet_credits_purchase_transaction_id_fkey
      FOREIGN KEY (purchase_transaction_id)
      REFERENCES public.purchase_transactions(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'credit_transactions_purchase_transaction_id_fkey'
  ) THEN
    ALTER TABLE public.credit_transactions
      ADD CONSTRAINT credit_transactions_purchase_transaction_id_fkey
      FOREIGN KEY (purchase_transaction_id)
      REFERENCES public.purchase_transactions(id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS wallet_credits_purchase_transaction_id_uidx
  ON public.wallet_credits(purchase_transaction_id)
  WHERE purchase_transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS credit_transactions_purchase_transaction_id_uidx
  ON public.credit_transactions(purchase_transaction_id)
  WHERE purchase_transaction_id IS NOT NULL
    AND transaction_type = 'credit_purchase';

CREATE OR REPLACE FUNCTION public.fulfill_credit_purchase(
  p_purchase_transaction_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purchase public.purchase_transactions%ROWTYPE;
  v_expires_at timestamptz;
  v_credit_id uuid;
BEGIN
  SELECT *
  INTO v_purchase
  FROM public.purchase_transactions
  WHERE id = p_purchase_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase transaction not found: %', p_purchase_transaction_id;
  END IF;

  IF v_purchase.product_type <> 'CREDIT' THEN
    RAISE EXCEPTION 'Purchase transaction % is not a CREDIT purchase', p_purchase_transaction_id;
  END IF;

  IF v_purchase.fulfilled = true AND v_purchase.status = 'paid' THEN
    SELECT id INTO v_credit_id
    FROM public.wallet_credits
    WHERE purchase_transaction_id = p_purchase_transaction_id
    LIMIT 1;

    RETURN jsonb_build_object(
      'already_fulfilled', true,
      'credit_id', v_credit_id,
      'purchase_transaction_id', p_purchase_transaction_id
    );
  END IF;

  IF v_purchase.status <> 'paid' THEN
    RAISE EXCEPTION 'Purchase transaction % is not paid (status=%)',
      p_purchase_transaction_id, v_purchase.status;
  END IF;

  IF COALESCE(v_purchase.credits, 0) <= 0 THEN
    RAISE EXCEPTION 'Credit purchase % has invalid credits value',
      p_purchase_transaction_id;
  END IF;

  v_expires_at :=
    now() + make_interval(days => COALESCE(v_purchase.validity_days, 0));

  INSERT INTO public.wallet_credits (
    user_id,
    credit_type,
    credits_total,
    credits_remaining,
    expires_at,
    purchase_transaction_id
  )
  VALUES (
    v_purchase.user_id,
    'purchased',
    v_purchase.credits,
    v_purchase.credits,
    v_expires_at,
    p_purchase_transaction_id
  )
  RETURNING id INTO v_credit_id;

  INSERT INTO public.credit_transactions (
    user_id,
    transaction_type,
    credits,
    source,
    purchase_transaction_id
  )
  VALUES (
    v_purchase.user_id,
    'credit_purchase',
    v_purchase.credits,
    'Credit package purchase',
    p_purchase_transaction_id
  );

  UPDATE public.purchase_transactions
  SET
    status = 'paid',
    paid_at = COALESCE(paid_at, now()),
    fulfilled = true
  WHERE id = p_purchase_transaction_id;

  RETURN jsonb_build_object(
    'already_fulfilled', false,
    'credit_id', v_credit_id,
    'purchase_transaction_id', p_purchase_transaction_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fulfill_credit_purchase(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fulfill_credit_purchase(uuid)
  TO service_role;
