/* ============================================================
   mock-test.js
   ------------------------------------------------------------
   Runs the Mock Test HUB page (mock-test.html): the two
   category cards (unchanged) plus a new, separate Credit-Based
   Tests section. Credit Based Tests are identified purely from
   the database (mock_tests.access_type = 'credit'), never from
   hardcoded titles. Frontend visibility here is NOT access
   control — the actual credit check/deduction happens in
   start_credit_test(), called only from mock-test-attempt.js
   when the student actually presses Start.
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireLogin();
  if (!user) return; // requireLogin already redirected to login.html

  await loadCreditBalance(user.id);
  await loadCreditTests(user.id);
});

async function loadCreditBalance(userId) {
  const el = document.getElementById("creditBalance");
  const { data, error } = await supabaseClient
    .from("wallet_credits")
    .select("credits_remaining, expires_at")
    .eq("user_id", userId);

  if (error) {
    console.error(error);
    el.textContent = "—";
    return;
  }

  const now = new Date();
  const total = (data || [])
    .filter(row => new Date(row.expires_at) > now)
    .reduce((sum, row) => sum + row.credits_remaining, 0);

  el.textContent = "Credits: " + total;
}

async function loadCreditTests(userId) {
  const listEl = document.getElementById("creditTestList");

  const { data: mocks, error } = await supabaseClient
    .from("mock_tests")
    .select("*")
    .eq("access_type", "credit")
    .eq("active", true)
    .order("display_order", { ascending: true });

  if (error) {
    console.error(error);
    listEl.innerHTML = '<div class="empty-state">Could not load Credit-Based Tests.</div>';
    return;
  }

  if (!mocks || mocks.length === 0) {
    listEl.innerHTML = '<div class="empty-state">No Credit-Based Tests are available yet.</div>';
    return;
  }

  // Which of these has this student already permanently consumed?
  const mockIds = mocks.map(m => m.id);
  const { data: unlocks } = await supabaseClient
    .from("mock_unlocks")
    .select("mock_test_id")
    .eq("user_id", userId)
    .in("mock_test_id", mockIds);
  const consumedIds = new Set((unlocks || []).map(u => u.mock_test_id));

  renderCreditTests(mocks, consumedIds);
}

function renderCreditTests(mocks, consumedIds) {
  const listEl = document.getElementById("creditTestList");
  listEl.innerHTML = "";

  mocks.forEach(m => {
    const isConsumed = consumedIds.has(m.id);
    const categoryLabel = m.category === "ssc" ? "SSC" : "Legal";

    const card = document.createElement("div");
    card.className = "card";
    card.style.marginBottom = "14px";

    const actionHtml = isConsumed
      ? '<a class="btn btn-ghost" href="mock-history.html">View Result</a>'
      : '<a class="btn" href="mock-test-attempt.html?id=' + encodeURIComponent(m.id) + '">Start Test</a>';

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
        <div>
          <div style="font-family:var(--font-display); font-weight:700; font-size:1.1rem;">
            ${escapeHtml(m.title)}
            <span class="pill" style="margin-left:8px;">${categoryLabel}</span>
            ${isConsumed ? '<span class="pill" style="margin-left:6px;">Completed</span>' : ""}
          </div>
          <div style="font-size:0.85rem; color:var(--ink-soft); margin-top:4px;">
            ${m.duration} minutes &middot; ${isConsumed ? "&#10003; Completed" : "&#128274; 1 Credit"}
          </div>
        </div>
        <div>${actionHtml}</div>
      </div>`;

    listEl.appendChild(card);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
