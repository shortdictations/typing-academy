# Purchase History — database notes

No schema changes were made this session. This documents what was
inspected on the live database (project myjljedcniprjgxycdcl) before
building the feature, since the brief required reusing the existing
architecture rather than inventing a new one.

## Existing table reused: `purchase_transactions`
Already has everything the UI needed: `order_id`, `payment_gateway`,
`payment_gateway_id`, `product_type` (PASS/CREDIT), `pass_type`,
`credits`, `amount`, `validity_days`, `status`
(created/pending/paid/failed/refunded), `created_at`, `paid_at`,
`product_id` (FK to `products`), `fulfilled`. RLS already correctly
scoped: `auth.uid() = user_id`, confirmed directly against the live
policy — no security changes needed.

## Known limitation: no direct link to the resulting pass/credit lot
Neither `user_passes` nor `wallet_credits` has a foreign key back to
the `purchase_transactions` row that created it. The detail page
(`js/purchase-detail.js`) works around this with a **best-effort,
display-only** association: for a *paid* transaction, it finds the
`user_passes`/`wallet_credits` row (same user, same pass_type/credit
amount) whose own `created_at` is closest to the transaction's
`paid_at`. This is never used for any real deduction/access
decision — those still come entirely from `get_mock_access()` and
the wallet/pass tables directly — it's purely to display "which pass
did this purchase activate" on the detail page.

If a stronger guarantee is wanted later, the clean fix is a nullable
`purchase_transaction_id` column on `user_passes` and
`wallet_credits`, populated by whatever server-side function
currently fulfills a paid transaction (not identified this session —
it's not a SQL function in the `public` schema, so it's likely an
Edge Function not inspected here). That's a real change to the
fulfillment path, which this task was explicitly told not to modify
— flagging it here rather than making that call unilaterally.
