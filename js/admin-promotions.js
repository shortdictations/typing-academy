// Production deployment marker: keeps the latest gift-email flow active on the live admin page.
/* ============================================================
   admin-promotions.js
   ------------------------------------------------------------
   Lets an admin grant free credits or a pass directly to a
   specific student, all existing students, or all future
   signups. All actual granting happens server-side via
   admin_create_promotional_campaign() / the new-signup trigger —
   this file only collects the form, calls that one RPC, and
   renders the resulting history. It never writes to
   wallet_credits, user_passes, or promotional_grants directly.
   ============================================================ */

let searchDebounceTimer = null;
let availableStudents = [];

/*__KEEP_REST_OF_FILE__*/