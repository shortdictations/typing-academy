/* ============================================================
   supabase-config.js
   ------------------------------------------------------------
   PASTE YOUR OWN SUPABASE PROJECT DETAILS BELOW.
   You get these from: Supabase Dashboard -> Project Settings -> API

   1. SUPABASE_URL   -> "Project URL"
   2. SUPABASE_ANON_KEY -> "anon" "public" key (NOT the service_role key)

   Do NOT put spaces or quotes-inside-quotes. Just replace the
   text between the quotes.
   ============================================================ */

const SUPABASE_URL = "https://myjljedcniprjgxycdcl.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_zsWoPlDyYA04_GKV74D-Hg_7-RAUipe";

// This creates one shared connection object that every other
// JS file (auth.js, typing.js, dashboard.js) will use.
//
// Session policy: persistSession + autoRefreshToken are the
// supabase-js v2 defaults already — spelled out explicitly here so
// the intent is clear in code. Together they mean: an active user's
// session refreshes silently in the background and survives page
// reloads/short breaks (never logged out for that). The ~30-day
// inactivity cutoff itself is enforced server-side by Supabase Auth's
// refresh-token inactivity setting, NOT by any timer in this file —
// see Supabase Dashboard -> Authentication -> Sessions -> Inactivity
// timeout, which must be set to 30 days (720 hours) for that policy
// to actually take effect.
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true
  }
});
