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

  // Real access check per mock — calls the SAME can_access_mock()
  // function that actually enforces this (in the mock_test_results
  // insert policy), instead of re-implementing the unlock rule here
  // a second time. This is what makes it impossible for this list
  // to ever diverge from the real enforcement again — previously it
  // checked the legacy `subscriptions` table only, which Razorpay
  // fulfillment (writing to user_passes) never touched.
  const accessMap = await loadAccessMap(mocks);

  renderMockList(mocks, completedIds, accessMap);
});

// One can_access_mock() RPC per premium mock in this list (free
// mocks never need checking). Small lists, so this stays cheap,
// and it's the only way to guarantee this page can't drift out of
// sync with the real access rule again.
async function loadAccessMap(mocks) {
  const map = {};
  const premiumMocks = mocks.filter(m => m.access_type === "premium");

  await Promise.all(premiumMocks.map(async (m) => {
    const { data, error } = await supabaseClient.rpc("can_access_mock", { mock_id: m.id });
    map[m.id] = error ? false : !!data;
  }));

  return map;
}

function renderMockList(mocks, completedIds, accessMap) {
  const wrap = document.getElementById("mockListBody");
  wrap.innerHTML = '<div class="mock-grid"></div>';
  const grid = wrap.querySelector(".mock-grid");

  mocks.forEach(m => {
    const isPremium = m.access_type === "premium";
    const isCompleted = completedIds.has(m.id);
    const hasAccess = !isPremium || accessMap[m.id] === true;
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
      <div class="mock-card-title">
        ${escapeHtml(m.title)}
        ${isCompleted ? '<span class="pill">Completed</span>' : ""}
      </div>
      <div class="mock-card-bottom">
        <div class="mock-card-meta">${metaText}</div>
        ${actionHtml}
      </div>`;

    grid.appendChild(card);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
