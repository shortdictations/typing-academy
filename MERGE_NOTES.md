# TypeShala V8 Auth + Combo Upgrade Merge

This build merges the V8 authentication/sign-up experience into the Combo Upgrade project.

## V8 auth applied
- `login.html`: V8 combined sign-in/sign-up flow with email step, password step, Google sign-in, inline password reset, verification/resend state, and view-transition morphing.
- `register.html`: V8 redirect to the combined sign-up flow (`login.html?mode=signup`).
- `forgot-password.html`: V8 password-reset request page.
- `reset-password.html`: V8 password-reset completion page.
- `auth-redesign.css`: V8 authentication styling.

## Combo / payment implementation preserved
The following files were deliberately retained from the Combo Upgrade build:
- `admin-products.html`
- `js/admin-products.js`
- `js/payments.js`
- `js/subscriptions.js`
- `supabase/functions/_shared/fulfill.ts`
- `supabase/functions/create-razorpay-order/index.ts`

This preserves admin-controlled pass pricing/offer pricing/upgrade pricing, server-side purchase eligibility and pricing validation, Combo upgrades, transaction type `UPGRADE`, and same-expiry upgrade behavior.

## Shared auth backend
- `js/auth.js` was identical in both source projects and was retained unchanged.


## Subscription card update
- Active SSC now renders only the SSC card, with validity/current-plan/access details and the admin-configured SSC -> Combo upgrade price inside the same card. Legal and Combo cards are hidden.
- Active Legal follows the same pattern in reverse.
- Active Combo renders only the Combo current-plan card; SSC and Legal cards are hidden.
- No-active-pass users still see all configured PASS purchase cards.
- Upgrade continues to use the existing Combo product id and `data-is-upgrade="true"`, preserving the existing server-side Razorpay/upgrade flow and same-expiry conversion.
- Upgrade price is read from `upgrade_to_combo_price`; no price is hard-coded in the frontend.

## Purchase History — Combo Upgrade display/pricing fix
- Purchase History and Purchase Details now distinguish `transaction_type = UPGRADE` from a normal Combo purchase and display **Upgrade to Combo** instead of the Combo product name.
- Upgrade transactions are labeled **Pass Upgrade** in history and **Upgrade to Combo** in details.
- `create-razorpay-order` now enforces the source pass's configured `upgrade_to_combo_price` at the server payment boundary for UPGRADE transactions, preventing the Combo regular/offer price from being charged or recorded for an upgrade.
- Razorpay checkout description is also **Upgrade to Combo** for upgrade transactions.
