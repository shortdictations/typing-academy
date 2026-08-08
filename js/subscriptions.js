/* ============================================================
   subscriptions.js
   ------------------------------------------------------------
   Reads the logged-in student's own rows from the subscriptions
   table (RLS already restricts this to their own data) and shows
   Legal and SSC status as two completely separate plans.

   No payment gateway is wired up here — "Subscribe" is a plain,
   inert button for now, per instructions.
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireLogin();
  if (!user) return;

  const { data: subs, error } = await supabaseClient
    .from("subscriptions")
    .select("*")
    .eq("user_id", user.id);

  if (error) {
    console.error(error);
    document.getElementById("legalStatus").innerHTML = '<div class="empty-state">Could not load subscription status.</div>';
    document.getElementById("sscStatus").innerHTML = '<div class="empty-state">Could not load subscription status.</div>';
    return;
  }

  renderPlanStatus("legal", "Legal Mocks", subs || [], document.getElementById("legalStatus"));
  renderPlanStatus("ssc", "SSC Mocks", subs || [], document.getElementById("sscStatus"));
});

// Finds the most relevant subscription row for a type and renders
// its status. If more than one row exists for the same type
// (e.g. an old expired one plus a new active one), the active,
// unexpired one takes priority.
function renderPlanStatus(type, label, subs, container) {
  const now = new Date();

  const rowsOfType = subs.filter(s => s.subscription_type === type);
  const activeRow = rowsOfType.find(s =>
    s.status === "active" && (!s.expiry_date || new Date(s.expiry_date) > now)
  );

  if (activeRow) {
    const expiryText = activeRow.expiry_date
      ? new Date(activeRow.expiry_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
      : "No expiry date set";

    container.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
        <span class="pill" style="background:#E9F1EC; color:var(--ok);">Active</span>
      </div>
      <div style="font-size:0.9rem; color:var(--ink-soft);">
        Expiry date: <strong style="color:var(--ink);">${expiryText}</strong>
      </div>`;
  } else {
    container.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">
        <span class="pill">Not Subscribed</span>
      </div>
      <p style="font-size:0.85rem; color:var(--ink-soft); margin:0 0 14px;">
        You're currently limited to the first 3 free ${label}. Subscribe to unlock the rest.
      </p>
      <button class="btn" disabled style="opacity:0.6; cursor:not-allowed;">Subscribe to ${label}</button>
      <p style="font-size:0.72rem; color:var(--ink-soft); margin-top:8px;">Online subscription purchase is coming soon.</p>`;
  }
}
