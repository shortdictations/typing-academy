/* ============================================================
   subscriptions.js
   ------------------------------------------------------------
   Populates "My Current Access" on the purchase page by reading
   the student's own rows from user_passes and wallet_credits
   (both already allow "select own rows" via existing RLS — no
   new backend logic was added for this). Purchase buttons are
   inert placeholders; no payment logic here yet.
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireLogin();
  if (!user) return;

  const [{ data: passes, error: passesError }, { data: credits, error: creditsError }] = await Promise.all([
    supabaseClient.from("user_passes").select("*").eq("user_id", user.id),
    supabaseClient.from("wallet_credits").select("*").eq("user_id", user.id)
  ]);

  if (passesError) console.error(passesError);
  if (creditsError) console.error(creditsError);

  renderPassStatus("SSC", passes || [], document.getElementById("accessSsc"));
  renderPassStatus("LEGAL", passes || [], document.getElementById("accessLegal"));
  renderPassStatus("COMBO", passes || [], document.getElementById("accessCombo"));
  renderCreditStatus(credits || [], document.getElementById("accessCredits"));
});

// A pass is valid only when: starts_at <= now() AND expires_at > now()
// AND status != 'cancelled' — same rule the database access-control
// function uses, just for display here.
function renderPassStatus(passType, passes, el) {
  const now = new Date();
  const rows = passes.filter(p => p.pass_type === passType);
  const validRow = rows.find(p =>
    p.status !== "cancelled" &&
    new Date(p.starts_at) <= now &&
    new Date(p.expires_at) > now
  );

  if (validRow) {
    const expiryText = new Date(validRow.expires_at).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric"
    });
    el.innerHTML = 'Active until<br><strong style="color:var(--ink);">' + expiryText + '</strong>';
  } else {
    el.textContent = "Not active";
  }
}

function renderCreditStatus(credits, el) {
  const now = new Date();
  const totalRemaining = credits
    .filter(c => new Date(c.expires_at) > now)
    .reduce((sum, c) => sum + c.credits_remaining, 0);

  el.textContent = totalRemaining + " available";
}
