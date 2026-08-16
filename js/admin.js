/* ============================================================
   admin.js
   ------------------------------------------------------------
   Powers admin.html: add / edit / delete passages, and filter
   the list. Access is gated by requireAdmin(), which redirects
   non-admins to dashboard.html. This is a convenience check
   only — the REAL security is the Supabase Row Level Security
   policies on the passages table, which reject any insert/
   update/delete from a non-admin no matter what the browser
   does.

   Passage Type is not shown or editable in this form — every
   passage created here is automatically passage_type='Mock
   Test' (linked to a mock_tests catalog row, pass-based access
   with a 1-Credit fallback), and existing passages' passage_type
   is never touched on edit. Category (SSC/Legal) is the only
   classification the admin sees. "Practice" is no longer offered
   here — existing Practice-tagged passages are intentionally
   excluded from this list so they can't be accidentally mutated
   through this form, but they remain fully untouched in the
   database and keep working exactly as before on the regular
   typing practice page (js/passages.js is unchanged).
   ============================================================ */

let editingId = null; // null = "add" mode, otherwise the id being edited

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireAdmin();
  if (!user) return; // requireAdmin already redirected

  document.getElementById("passageForm").addEventListener("submit", handleSubmit);
  document.getElementById("cancelEditBtn").addEventListener("click", exitEditMode);
  document.getElementById("filterCategory").addEventListener("change", loadPassages);

  await loadPassages();
});

/* ---------------- Loading / rendering the list ---------------- */

async function loadPassages() {
  const listBody = document.getElementById("passageListBody");
  listBody.innerHTML = '<div class="loading-strip">Loading passages...</div>';

  const categoryFilter = document.getElementById("filterCategory").value;

  // Only Mock Test passages ever appear here — Practice-tagged
  // passages are managed elsewhere (the regular typing practice
  // content pool) and are deliberately excluded so they can't be
  // edited into an invalid state via this form. Passage Type is
  // not admin-editable or filterable here — Category is the only
  // classification the admin sees.
  let query = supabaseClient
    .from("passages")
    .select("*")
    .eq("passage_type", "Mock Test")
    .order("created_at", { ascending: false });

  if (categoryFilter !== "all") {
    query = query.eq("category", categoryFilter);
  }

  const { data, error } = await query;

  if (error) {
    listBody.innerHTML = '<div class="empty-state">Could not load passages.</div>';
    console.error(error);
    return;
  }

  renderList(data);
}

function renderList(passages) {
  const listBody = document.getElementById("passageListBody");

  if (passages.length === 0) {
    listBody.innerHTML = '<div class="empty-state">No passages found for this filter.</div>';
    return;
  }

  let rows = "";
  passages.forEach(p => {
    rows += `
      <tr>
        <td>${escapeHtml(p.title)}</td>
        <td><span class="pill">${escapeHtml(p.category)}</span></td>
        <td>${p.duration} min</td>
        <td>${p.active ? "Active" : "Inactive"}</td>
        <td style="white-space:nowrap;">
          <button type="button" class="btn btn-ghost" style="padding:5px 10px;font-size:0.75rem;" onclick="startEdit('${p.id}')">Edit</button>
          <button type="button" class="btn" style="padding:5px 10px;font-size:0.75rem;" onclick="deletePassage('${p.id}')">Delete</button>
          <button type="button" class="btn" style="padding:5px 10px;font-size:0.75rem;" onclick="toggleActive('${p.id}')">${p.active ? "Deactivate" : "Activate"}</button>
        </td>
      </tr>`;
  });

  listBody.innerHTML = `
    <div style="overflow-x:auto;">
    <table class="marksheet">
      <thead>
        <tr>
          <th>Title</th>
          <th>Category</th>
          <th>Duration</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    </div>`;

  // Keep a lookup so Edit can find the full row without another request
  window._passageLookup = {};
  passages.forEach(p => { window._passageLookup[p.id] = p; });
}

/* ---------------- Add / Edit form ---------------- */

async function handleSubmit(e) {
  e.preventDefault();
  hideFormMessages();

  const submitBtn = document.getElementById("submitBtn");
  submitBtn.disabled = true;

  const payload = {
    title: document.getElementById("pTitle").value.trim(),
    content: document.getElementById("pContent").value.trim(),
    category: document.getElementById("pCategory").value,
    duration: parseInt(document.getElementById("pDuration").value, 10),
    active: document.getElementById("pActive").value === "true"
    // No difficulty, no exam_name — removed from this form entirely.
    // Existing values for those columns (if any) are left untouched
    // on UPDATE since they're simply not included in this payload.
    // passage_type is likewise NOT included here — see below: it's
    // set automatically for new passages only, and left alone
    // entirely on edit so an existing row's value is never
    // unnecessarily overwritten.
  };

  try {
    if (editingId) {
      const { error } = await supabaseClient.from("passages").update(payload).eq("id", editingId).select().single();
      if (error) throw error;
      showFormSuccess("Passage updated.");
    } else {
      // New passages created from this form are always Mock Test
      // passages — the admin no longer picks Passage Type.
      const { error } = await supabaseClient.from("passages").insert({ ...payload, passage_type: "Mock Test" }).select().single();
      if (error) throw error;
      showFormSuccess("Passage added.");
    }

    exitEditMode();
    await loadPassages();
  } catch (err) {
    showFormError(err.message || "Something went wrong. Please try again.");
  } finally {
    submitBtn.disabled = false;
  }
}

function startEdit(id) {
  const p = window._passageLookup[id];
  if (!p) return;

  editingId = id;
  document.getElementById("pTitle").value = p.title;
  document.getElementById("pContent").value = p.content;
  document.getElementById("pCategory").value = p.category;
  document.getElementById("pDuration").value = String(p.duration);
  document.getElementById("pActive").value = p.active ? "true" : "false";

  document.getElementById("formLabel").textContent = "Editing: " + p.title;
  document.getElementById("submitBtn").textContent = "Update Passage";
  document.getElementById("cancelEditBtn").style.display = "inline-block";

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function exitEditMode() {
  editingId = null;
  document.getElementById("passageForm").reset();
  document.getElementById("formLabel").textContent = "Add a New Passage";
  document.getElementById("submitBtn").textContent = "Add Passage";
  document.getElementById("cancelEditBtn").style.display = "none";
}

async function toggleActive(id) {
  const p = window._passageLookup[id];
  if (!p) return;

  const { error } = await supabaseClient.from("passages").update({ active: !p.active }).eq("id", id);
  if (error) {
    alert("Could not update: " + error.message);
    return;
  }
  await loadPassages();
}

async function deletePassage(id) {
  const p = window._passageLookup[id];
  const label = p ? p.title : "this passage";
  if (!confirm('Delete "' + label + '"? This cannot be undone.')) return;

  const { error } = await supabaseClient.from("passages").delete().eq("id", id);
  if (error) {
    alert("Could not delete: " + error.message);
    return;
  }
  await loadPassages();
}

/* ---------------- Small helpers ---------------- */

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
  setTimeout(() => { el.style.display = "none"; }, 3000);
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
