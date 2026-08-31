/* ============================================================
   admin-announcements.js
   ------------------------------------------------------------
   Manages the announcements shown near the top of the student
   dashboard (dashboard.html + js/dashboard.js render them).
   Gated by requireAdmin(); real security is the announcements
   RLS policies (admin-only write, same admins table used by
   the passages table). Does not touch products, passes,
   credits, mock tests, or any payment/fulfillment table.
   ============================================================ */

let editingId = null; // null = "create" mode, otherwise the id being edited

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireAdmin();
  if (!user) return; // requireAdmin already redirected

  // Same call dashboard.js/subscriptions.js already make — wires the
  // header avatar dropdown, mobile profile drawer, bottom nav active
  // state, and sidebar collapse toggle. Not previously called on any
  // admin page (checked directly), which left the header's logout
  // button dead even before this redesign.
  if (typeof initAuthHeader === "function") initAuthHeader(user);

  document.getElementById("announcementForm").addEventListener("submit", handleSubmit);
  document.getElementById("cancelEditBtn").addEventListener("click", exitEditMode);

  await loadAnnouncements();
});

/* ---------------- Loading / rendering the list ---------------- */

async function loadAnnouncements() {
  const listBody = document.getElementById("announcementListBody");

  const { data, error } = await supabaseClient
    .from("announcements")
    .select("*")
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    listBody.innerHTML = '<div class="empty-state">Could not load announcements.</div>';
    console.error(error);
    return;
  }

  window._announcementLookup = {};
  data.forEach(a => { window._announcementLookup[a.id] = a; });

  if (data.length === 0) {
    listBody.innerHTML = '<div class="empty-state">No announcements yet.</div>';
    return;
  }

  let rows = "";
  data.forEach(a => {
    rows += `
      <tr>
        <td>${escapeHtmlAnn(a.title)}</td>
        <td><span class="pill">${escapeHtmlAnn(a.type)}</span></td>
        <td>${escapeHtmlAnn(showOnLabel(a.show_on))}</td>
        <td>${a.active ? "Active" : "Inactive"}</td>
        <td>${formatDateCell(a.start_at)}</td>
        <td>${formatDateCell(a.end_at)}</td>
        <td style="white-space:nowrap;">
          <button type="button" class="btn btn-ghost" style="padding:5px 10px;font-size:0.75rem;" onclick="startEdit('${a.id}')">Edit</button>
          <button type="button" class="btn" style="padding:5px 10px;font-size:0.75rem;" onclick="toggleActive('${a.id}')">${a.active ? "Deactivate" : "Activate"}</button>
          <button type="button" class="btn" style="padding:5px 10px;font-size:0.75rem;" onclick="deleteAnnouncement('${a.id}')">Delete</button>
        </td>
      </tr>`;
  });

  listBody.innerHTML = `
    <div style="overflow-x:auto;">
    <table class="marksheet">
      <thead>
        <tr><th>Title</th><th>Type</th><th>Show On</th><th>Active</th><th>Start</th><th>End</th><th>Actions</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    </div>`;
}

// Human-readable Show On text — never exposes the raw array.
function showOnLabel(showOn) {
  const arr = showOn || [];
  const hasDashboard = arr.includes("dashboard");
  const hasHome = arr.includes("home");
  if (hasDashboard && hasHome) return "Dashboard + Home Page";
  if (hasDashboard) return "Dashboard";
  if (hasHome) return "Home Page";
  return "\u2014"; // shouldn't happen — the DB constraint requires at least one
}

function formatDateCell(iso) {
  if (!iso) return "&mdash;";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/* ---------------- Create / Edit ---------------- */

async function handleSubmit(e) {
  e.preventDefault();
  hideFormMessages();

  const submitBtn = document.getElementById("submitBtn");
  submitBtn.disabled = true;

  const showOn = [];
  if (document.getElementById("aShowDashboard").checked) showOn.push("dashboard");
  if (document.getElementById("aShowHome").checked) showOn.push("home");

  const payload = {
    title: document.getElementById("aTitle").value.trim(),
    message: document.getElementById("aMessage").value.trim(),
    type: document.getElementById("aType").value,
    active: document.getElementById("aActive").value === "true",
    start_at: localInputToIso(document.getElementById("aStartAt").value),
    end_at: localInputToIso(document.getElementById("aEndAt").value),
    display_order: parseInt(document.getElementById("aOrder").value, 10) || 0,
    action_label: document.getElementById("aActionLabel").value.trim() || null,
    action_url: document.getElementById("aActionUrl").value.trim() || null,
    show_on: showOn
  };

  if (!payload.title || !payload.message) {
    showFormError("Title and message are required.");
    submitBtn.disabled = false;
    return;
  }

  if (showOn.length === 0) {
    showFormError("Select at least one location — Dashboard, Home Page, or both.");
    submitBtn.disabled = false;
    return;
  }

  // An action button only makes sense with both a label and a link.
  if ((payload.action_label && !payload.action_url) || (!payload.action_label && payload.action_url)) {
    showFormError("To show an action button, fill in both the label and the link (or leave both blank).");
    submitBtn.disabled = false;
    return;
  }

  try {
    if (editingId) {
      const { error } = await supabaseClient.from("announcements").update(payload).eq("id", editingId);
      if (error) throw error;
      showFormSuccess("Announcement updated.");
    } else {
      const { error } = await supabaseClient.from("announcements").insert(payload);
      if (error) throw error;
      showFormSuccess("Announcement created.");
    }
    exitEditMode();
    await loadAnnouncements();
  } catch (err) {
    showFormError(err.message || "Something went wrong. Please try again.");
  } finally {
    submitBtn.disabled = false;
  }
}

function startEdit(id) {
  const a = window._announcementLookup[id];
  if (!a) return;

  editingId = id;
  document.getElementById("aTitle").value = a.title;
  document.getElementById("aMessage").value = a.message;
  document.getElementById("aType").value = a.type;
  document.getElementById("aActive").value = a.active ? "true" : "false";
  document.getElementById("aStartAt").value = isoToLocalInput(a.start_at);
  document.getElementById("aEndAt").value = isoToLocalInput(a.end_at);
  document.getElementById("aOrder").value = a.display_order;
  document.getElementById("aActionLabel").value = a.action_label || "";
  document.getElementById("aActionUrl").value = a.action_url || "";
  const showOn = a.show_on || ["dashboard"];
  document.getElementById("aShowDashboard").checked = showOn.includes("dashboard");
  document.getElementById("aShowHome").checked = showOn.includes("home");

  document.getElementById("formLabel").textContent = "Editing: " + a.title;
  document.getElementById("submitBtn").textContent = "Update Announcement";
  document.getElementById("cancelEditBtn").style.display = "inline-block";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function exitEditMode() {
  editingId = null;
  document.getElementById("announcementForm").reset();
  document.getElementById("formLabel").textContent = "Create Announcement";
  document.getElementById("submitBtn").textContent = "Create Announcement";
  document.getElementById("cancelEditBtn").style.display = "none";
}

async function toggleActive(id) {
  const a = window._announcementLookup[id];
  if (!a) return;
  const { error } = await supabaseClient.from("announcements").update({ active: !a.active }).eq("id", id);
  if (error) { alert("Could not update: " + error.message); return; }
  await loadAnnouncements();
}

async function deleteAnnouncement(id) {
  const a = window._announcementLookup[id];
  const label = a ? a.title : "this announcement";
  if (!confirm('Delete "' + label + '"? This cannot be undone.')) return;

  const { error } = await supabaseClient.from("announcements").delete().eq("id", id);
  if (error) { alert("Could not delete: " + error.message); return; }
  await loadAnnouncements();
}

/* ---------------- Helpers ---------------- */

// datetime-local input value ("YYYY-MM-DDTHH:mm", local time) -> ISO
// string for storage, or null if the field was left blank.
function localInputToIso(value) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

// Stored ISO string -> the "YYYY-MM-DDTHH:mm" local-time format a
// datetime-local input expects, or "" if there is no date.
function isoToLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
    "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function hideFormMessages() {
  document.getElementById("formError").style.display = "none";
  document.getElementById("formSuccess").style.display = "none";
}
function showFormError(text) {
  const el = document.getElementById("formError");
  el.textContent = text;
  el.style.display = "block";
}
function showFormSuccess(text) {
  const el = document.getElementById("formSuccess");
  el.textContent = text;
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, 4000);
}
function escapeHtmlAnn(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : str;
  return div.innerHTML;
}
