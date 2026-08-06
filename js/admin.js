/* ============================================================
   admin.js
   ------------------------------------------------------------
   Powers admin.html: add / edit / delete passages, and filter
   the list by category. Access is gated by requireAdmin(),
   which redirects non-admins to dashboard.html. This is a
   convenience check only — the REAL security is the Supabase
   Row Level Security policies on the passages table, which
   reject any insert/update/delete from a non-admin no matter
   what the browser does.
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

  const filter = document.getElementById("filterCategory").value;

  let query = supabaseClient.from("passages").select("*").order("created_at", { ascending: false });
  if (filter !== "all") {
    query = query.eq("category", filter);
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
        <td>${escapeHtml(p.difficulty || "-")}</td>
        <td>${p.duration} min</td>
        <td>${p.active ? "Active" : "Inactive"}</td>
        <td style="white-space:nowrap;">
          <button type="button" class="btn btn-ghost" style="padding:5px 10px;font-size:0.75rem;" onclick="startEdit('${p.id}')">Edit</button>
          <button type="button" class="btn" style="padding:5px 10px;font-size:0.75rem;" onclick="deletePassage('${p.id}')">Delete</button>
        </td>
      </tr>`;
  });

  listBody.innerHTML = `
    <table class="marksheet">
      <thead>
        <tr>
          <th>Title</th>
          <th>Category</th>
          <th>Difficulty</th>
          <th>Duration</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

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
    difficulty: document.getElementById("pDifficulty").value,
    duration: parseInt(document.getElementById("pDuration").value, 10),
    active: document.getElementById("pActive").value === "true"
  };

  try {
    if (editingId) {
      const { error } = await supabaseClient.from("passages").update(payload).eq("id", editingId);
      if (error) throw error;
      showFormSuccess("Passage updated.");
    } else {
      const { error } = await supabaseClient.from("passages").insert(payload);
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
  document.getElementById("pDifficulty").value = p.difficulty || "Medium";
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
