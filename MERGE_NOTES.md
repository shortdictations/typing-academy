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
