/* ============================================================
   mock-test.js
   ------------------------------------------------------------
   Runs the Mock Test HUB page (mock-test.html): the two
   category cards (unchanged) plus the Credit-Based Tests
   catalog. Credit Based Tests are identified purely from the
   database (mock_tests.access_type = 'credit'), never hardcoded.
   Frontend visibility here is NOT access control — the actual
   credit check/deduction happens in start_credit_test(), called
   only from mock-test-attempt.js when Start is actually pressed.
   This page only decides what to SHOW (Start vs Buy Credits vs
   Completed), based on real balance/consumption data read from
   the database.
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireLogin();
  if (!user) return; // requireLogin already redirected to login.html

  const balance = await loadCreditBalance(user.id);
  await loadCreditTests(user.id, balance);
});

// Returns { free, purchased, total } — read directly from
// wallet_credits, split by credit_type, unexpired lots only.
async function loadCreditBalance(userId) {
  const els = {
    free: document.getElementById("creditFree"),
    purchased: document.getElementById("creditPurchased"),
    total: document.getElementById("creditTotal")
  };

  const { data, error } = await supabaseClient
    .from("wallet_credits")
    .select("credit_type, credits_remaining, expires_at")
    .eq("user_id", userId);

  if (error) {
    console.error(error);
    els.free.textContent = "—";
    els.purchased.textContent = "—";
    els.total.textContent = "—";
    return { free: 0, purchased: 0, total: 0 };
  }

  const now = new Date();
  const unexpired = (data || []).filter(row => new Date(row.expires_at) > now);
  const free = unexpired.filter(r => r.credit_type === "free").reduce((s, r) => s + r.credits_remaining, 0);
  const purchased = unexpired.filter(r => r.credit_type === "purchased").reduce((s, r) => s + r.credits_remaining, 0);
  const total = free + purchased;

  els.free.textContent = free;
  els.purchased.textContent = purchased;
  els.total.textContent = total;

  return { free, purchased, total };
}

async function loadCreditTests(userId, balance) {
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

  const mockIds = mocks.map(m => m.id);
  const { data: unlocks } = await supabaseClient
    .from("mock_unlocks")
    .select("mock_test_id")
    .eq("user_id", userId)
    .in("mock_test_id", mockIds);
  const consumedIds = new Set((unlocks || []).map(u => u.mock_test_id));

  renderCreditTests(mocks, consumedIds, balance);
}

function renderCreditTests(mocks, consumedIds, balance) {
  const listEl = document.getElementById("creditTestList");
  listEl.innerHTML = "";

  mocks.forEach(m => {
    const isConsumed = consumedIds.has(m.id);
    const categoryLabel = m.category === "ssc" ? "SSC" : "Legal";

    const card = document.createElement("div");
    card.className = "card";
    card.style.marginBottom = "14px";

    let actionHtml;
    let statusLine;
    if (isConsumed) {
      actionHtml = '<a class="btn btn-ghost" href="mock-history.html">View Result</a>';
      statusLine = "&#10003; Completed";
    } else if (balance.total <= 0) {
      // Section 7: zero credits — show Buy Credits, never a working Start.
      actionHtml = '<a class="btn" href="subscriptions.html">Buy Credits</a>';
      statusLine = "&#128274; 1 Credit";
    } else {
      actionHtml = '<a class="btn" href="mock-test-attempt.html?id=' + encodeURIComponent(m.id) + '">Start Test</a>';
      statusLine = "&#128274; 1 Credit";
    }

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
        <div>
          <div style="font-family:var(--font-display); font-weight:700; font-size:1.1rem;">
            ${escapeHtml(m.title)}
            <span class="pill" style="margin-left:8px;">${categoryLabel}</span>
            ${isConsumed ? '<span class="pill" style="margin-left:6px;">Completed</span>' : ""}
          </div>
          <div style="font-size:0.85rem; color:var(--ink-soft); margin-top:4px;">
            ${m.duration} minutes &middot; ${statusLine}
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
