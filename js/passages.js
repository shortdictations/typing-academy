/* ============================================================
   passages.js
   ------------------------------------------------------------
   Loads typing passages from the Supabase "passages" table.
   (Previously this file held a hardcoded list — passages now
   live in the database and are managed from admin.html.)
   ============================================================ */

// Get every ACTIVE, PRACTICE-type passage matching a category + duration.
// Mock Test passages are deliberately excluded here — they're only
// ever fetched by mock-test.js.
// Returns [] (and logs the error) if the request fails.
async function fetchPassages(category, duration) {
  const { data, error } = await supabaseClient
    .from("passages")
    .select("*")
    .eq("category", category)
    .eq("duration", duration)
    .eq("passage_type", "Practice")
    .eq("active", true)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Could not load passages:", error);
    return [];
  }
  return data;
}
