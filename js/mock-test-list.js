/* ============================================================
   mock-test-list.js
   ------------------------------------------------------------
   Shows EVERY active mock test in one category (?category=legal
   or ssc) in one unified list — SSC/Legal Mock Tests and what
   used to be separate "Credit-Based Tests" now live together
   here, per the TypeShala access model update: PASS and CREDIT
   are two access METHODS for the same test library, not two
   separate libraries.

   Access priority per test (mirrors the real server-side rule):
     1. Free test (access_type='free')            -> always open
     2. Active eligible Pass (checked via the same
        can_access_mock() RPC mock-test-attempt.js uses)         -> PASS INCLUDED, unlimited
     3. No eligible pass, but a credit is available
        (and this test hasn't already been claimed
        with a credit before)                                    -> 1 CREDIT
     4. Already claimed with a credit previously                 -> Completed
     5. None of the above                                        -> GET ACCESS (locked)

   Frontend visibility here is NOT access control — the real
   check/deduction happens server-side in start_mock_test()/
   start_credit_test(), called from mock-test-attempt.js only
   when Start is actually pressed.
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

  // Which of these has this student already completed (any access method)?
  const mockIds = mocks.map(m => m.id);
  const { data: results } = await supabaseClient
    .from("mock_test_results")
    .select("mock_test_id")
    .eq("user_id", user.id)
    .in("mock_test_id", mockIds);
  const completedIds = new Set((results || []).map(r => r.mock_test_id));

  // STEP 1 of the access priority, for every non-free test — real
  // DB-level pass check via the SAME can_access_mock() function
  // that actually enforces this (in the mock_test_results insert
  // policy), never re-implemented client-side.
  const accessMap = await loadPassAccessMap(mocks);

  // For tests where the pass check came back false, we also need
  // this student's credit balance and which of those specific
  // tests were already claimed with a credit before (STEP 3/4).
  const needsCreditInfo = mocks.some(m => m.access_type !== "free" && !accessMap[m.id]);
  const creditInfo = needsCreditInfo
    ? await loadCreditFallbackInfo(user.id, mocks.filter(m => m.access_type !== "free" && !accessMap[m.id]))
    : { balance: 0, unlockedIds: new Set() };

  renderMockList(mocks, completedIds, accessMap, creditInfo);
});

// One can_access_mock() RPC per non-free mock in this list (free
// mocks never need checking). Small lists, so this stays cheap,
// and it's the only way to guarantee this page can't drift out of
// sync with the real access rule.
async function loadPassAccessMap(mocks) {
  const map = {};
  const nonFreeMocks = mocks.filter(m => m.access_type !== "free");

  await Promise.all(nonFreeMocks.map(async (m) => {
    const { data, error } = await supabaseClient.rpc("can_access_mock", { mock_id: m.id });
    map[m.id] = error ? false : !!data;
  }));

  return map;
}

// Credit balance + which of the (pass-ineligible) tests were
// already claimed with a credit before. Read-only — never deducts;
// the actual spend only happens in start_credit_test(), called from
// mock-test-attempt.js when Start is pressed.
async function loadCreditFallbackInfo(userId, candidateMocks) {
  const { data: walletRows, error: walletError } = await supabaseClient
    .from("wallet_credits")
    .select("credits_remaining, expires_at")
    .eq("user_id", userId);

  const now = new Date();
  const balance = walletError
    ? 0
    : (walletRows || [])
        .filter(row => new Date(row.expires_at) > now)
        .reduce((sum, row) => sum + row.credits_remaining, 0);

  const mockIds = candidateMocks.map(m => m.id);
  let unlockedIds = new Set();
  if (mockIds.length > 0) {
    const { data: unlocks } = await supabaseClient
      .from("mock_unlocks")
      .select("mock_test_id")
      .eq("user_id", userId)
      .in("mock_test_id", mockIds);
    unlockedIds = new Set((unlocks || []).map(u => u.mock_test_id));
  }

  return { balance, unlockedIds };
}

function renderMockList(mocks, completedIds, accessMap, creditInfo) {
  const wrap = document.getElementById("mockListBody");
  wrap.innerHTML = '<div class="mock-grid"></div>';
  const grid = wrap.querySelector(".mock-grid");

  mocks.forEach(m => {
    const isFree = m.access_type === "free";
    const hasPass = !isFree && accessMap[m.id] === true;
    const isCompleted = completedIds.has(m.id);
    // Credit fallback only matters when there's no eligible pass.
    const alreadyClaimedByCredit = !isFree && !hasPass && creditInfo.unlockedIds.has(m.id);
    const hasCreditAvailable = !isFree && !hasPass && !alreadyClaimedByCredit && creditInfo.balance > 0;
    const hasAccess = isFree || hasPass || hasCreditAvailable || alreadyClaimedByCredit;

    const card = document.createElement("div");
    card.className = "mock-card";

    let actionHtml;
    let metaText;

    if (isFree) {
      metaText = m.duration + " minutes &middot; Free";
      actionHtml = '<a class="btn" href="mock-test-attempt.html?id=' + encodeURIComponent(m.id) + '">' +
        (isCompleted ? "Retake" : "Start") + '</a>';
    } else if (hasPass) {
      metaText = m.duration + " minutes &middot; PASS INCLUDED";
      actionHtml = '<a class="btn" href="mock-test-attempt.html?id=' + encodeURIComponent(m.id) + '">' +
        (isCompleted ? "Retake" : "Start") + '</a>';
    } else if (alreadyClaimedByCredit || (isCompleted && !hasAccess)) {
      // Claimed with a credit before and no pass now covers it —
      // matches the existing "1 credit, once" rule.
      metaText = m.duration + " minutes";
      actionHtml = '<a class="btn btn-ghost" href="mock-history.html">View Result</a>';
    } else if (hasCreditAvailable) {
      metaText = m.duration + " minutes &middot; 1 CREDIT";
      actionHtml = '<a class="btn" href="mock-test-attempt.html?id=' + encodeURIComponent(m.id) + '">Use 1 Credit</a>';
    } else {
      // Neither an eligible pass nor a spendable credit.
      metaText = m.duration + " minutes";
      const categoryLabel = m.category === "ssc" ? "SSC" : "Legal";
      actionHtml = '<a class="btn" href="subscriptions.html?plan=' + m.category + '">&#128274; Get ' + categoryLabel + ' Access</a>';
    }

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
