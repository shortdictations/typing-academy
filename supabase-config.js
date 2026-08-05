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

const SUPABASE_URL = "PASTE_YOUR_SUPABASE_PROJECT_URL_HERE";
const SUPABASE_ANON_KEY = "PASTE_YOUR_SUPABASE_ANON_KEY_HERE";

// This creates one shared connection object that every other
// JS file (auth.js, typing.js, dashboard.js) will use.
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
