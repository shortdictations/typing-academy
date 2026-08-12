/* ============================================================
   mock-test-list.js
   ------------------------------------------------------------
   Shows every active mock test in one category (?category=legal
   or ?category=ssc), in admin-set display order. The first 3
   mocks in the category are Free; the rest follow whatever
   access_type the admin assigned (this mirrors "first 3 free"
   automatically as long as admin sets display_order 1-3 for the
   free ones, but access_type is what's actually enforced/shown —
   see the note in setup-mock-tests.sql about premium not yet
   being access-controlled server-side, since payments aren't
   built yet).
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireLogin();
  if (!user) return;

  const params = new URLSearchParams(window.location.search);
  const category = params.get("category") === "ssc" ? "ssc" : "legal";

  document.getElementById("pageTitle").textContent =
    category === "ssc" ? "SSC Mock Tests" : "Legal Mock Tests";

  const { data: mocks, error } = await supabaseClient
    .from("mock_tests")
    .select("*")
    .eq("category", category)
    .neq("access_type", "credit") // Credit-Based Tests never appear in the pass-based lists
    .eq("active", true)
    .order("display_order", { ascending: true });

  if (error) {
    document.getElementById("mockListBody").innerHTML =
      '<div class="empty-state">Could not load mock tests. Please refresh the page.</div>';
    console.error(error);
    return;
  }

  if (!mocks || mocks.length === 0) {
    document.getElementById("mockListBody").innerHTML =
      '<div class="empty-state">No mock tests are available in this category yet.</div>';
    return;
  }

  // Find which of these mocks this student has already completed
  const mockIds = mocks.map(m => m.id);
  const { data: results } = await supabaseClient
    .from("mock_test_results")
    .select("mock_test_id")
    .eq("user_id", user.id)
    .in("mock_test_id", mockIds);

  const completedIds = new Set((results || []).map(r => r.mock_test_id));

  // Real subscription check (reads actual DB rows — this is display
  // logic only; the real security is the can_access_mock() check
  // enforced at the database level when a result is saved).
  const unlockedCategories = await loadUnlockedCategories(user.id);

  renderMockList(mocks, completedIds, unlockedCategories);
});

// Returns a Set of subscription_type values ('legal' / 'ssc') the
// student currently has ACTIVE, unexpired access to.
async function loadUnlockedCategories(userId) {
  const { data: subs, error } = await supabaseClient
    .from("subscriptions")
    .select("subscription_type, status, expiry_date")
    .eq("user_id", userId)
    .eq("status", "active");

  if (error || !subs) {
    console.error("Could not load subscriptions:", error);
    return new Set();
  }

  const now = new Date();
  const unlocked = new Set();
  subs.forEach(s => {
    if (!s.expiry_date || new Date(s.expiry_date) > now) {
      unlocked.add(s.subscription_type);
    }
  });
  return unlocked;
}

function renderMockList(mocks, completedIds, unlockedCategories) {
  const wrap = document.getElementById("mockListBody");
  wrap.innerHTML = '<div class="mock-grid"></div>';
  const grid = wrap.querySelector(".mock-grid");

  mocks.forEach(m => {
    const isPremium = m.access_type === "premium";
    const isCompleted = completedIds.has(m.id);
    const hasAccess = !isPremium || unlockedCategories.has(m.category);
    const categoryLabel = m.category === "ssc" ? "SSC" : "Legal";

    const card = document.createElement("div");
    card.className = "mock-card";

    let actionHtml;
    if (hasAccess) {
      actionHtml = '<a class="btn" href="mock-test-attempt.html?id=' + encodeURIComponent(m.id) + '">' +
        (isCompleted ? "Retake" : "Start") + '</a>';
    } else {
      // Lock icon lives inside the button itself; no separate "Premium"
      // label elsewhere on the card — the button already says it all.
      actionHtml = '<a class="btn" href="subscriptions.html?plan=' + m.category + '">&#128274; Get ' + categoryLabel + ' Pass</a>';
    }

    const metaText = isPremium ? (m.duration + " minutes") : (m.duration + " minutes &middot; Free");

    card.innerHTML = `
      <div class="mock-card-top">
        <div class="mock-card-title">
          ${escapeHtml(m.title)}
          ${isCompleted ? '<span class="pill">Completed</span>' : ""}
        </div>
        ${actionHtml}
      </div>
      <div class="mock-card-meta">${metaText}</div>`;

    grid.appendChild(card);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
