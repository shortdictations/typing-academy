/* ============================================================
   admin-mock-tests.js
   ------------------------------------------------------------
   Powers admin-mock-tests.html: create / edit / delete / filter
   mock tests across exactly three Test Types. Gated by
   requireAdmin() — the real security is Supabase RLS on
   mock_tests, which rejects writes from non-admins regardless
   of the frontend.

   IMPORTANT — Test Type vs Category vs Access, kept distinct:
     Test Type  = 'ssc_mock' | 'legal_mock' | 'credit'
                  (a UI-level concept, derived from and stored
                  back into the existing category + access_type
                  columns — no new column was needed)
     Category   = 'ssc' | 'legal' (organizational; for Credit
                  Based Test it does NOT grant any pass access)
     Access     = 'free' | 'premium' | 'credit' (stored in the
                  existing access_type column, unchanged schema)

   Mapping used everywhere below:
     ssc_mock   -> category='ssc',   access_type='free'|'premium'
     legal_mock -> category='legal', access_type='free'|'premium'
     credit     -> category=admin's choice ('ssc'|'legal'), access_type='credit'
   ============================================================ */

let editingId = null;
let allPassages = []; // full list fetched once; filtered client-side per Test Type

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireAdmin();
  if (!user) return;

  await loadAllPassages();

  document.getElementById("mTestType").addEventListener("change", onTestTypeChange);
  document.getElementById("mCategory").addEventListener("change", onCategoryChange);
  onTestTypeChange(); // set correct initial field visibility + passage list

  document.getElementById("mockForm").addEventListener("submit", handleSubmit);
  document.getElementById("cancelEditBtn").addEventListener("click", exitEditMode);
  document.getElementById("filterCategory").addEventListener("change", loadMockTests);
  document.getElementById("filterTestType").addEventListener("change", loadMockTests);

  await loadMockTests();
});

/* ---------------- Test Type <-> Category/Access wiring ---------------- */

function onTestTypeChange() {
  const testType = document.getElementById("mTestType").value;
  const categorySelect = document.getElementById("mCategory");
  const accessWrap = document.getElementById("mAccessWrap");
  const costWrap = document.getElementById("mCostWrap");
  const categoryNote = document.getElementById("mCategoryNote");

  if (testType === "ssc_mock") {
    categorySelect.value = "ssc";
    categorySelect.disabled = true;
    categoryNote.textContent = "Fixed to SSC for this Test Type.";
    accessWrap.style.display = "block";
    costWrap.style.display = "none";
  } else if (testType === "legal_mock") {
    categorySelect.value = "legal";
    categorySelect.disabled = true;
    categoryNote.textContent = "Fixed to Legal for this Test Type.";
    accessWrap.style.display = "block";
    costWrap.style.display = "none";
  } else { // credit
    categorySelect.disabled = false;
    categoryNote.textContent = "For organization/filtering only — does not grant Pass access.";
    accessWrap.style.display = "none";
    costWrap.style.display = "block";
  }

  refreshPassageOptions();
}

function onCategoryChange() {
  // Only matters while Category is actually editable (Credit Based Test)
  refreshPassageOptions();
}

/* ---------------- Passage picker ---------------- */

async function loadAllPassages() {
  const select = document.getElementById("mPassage");
  select.innerHTML = '<option>Loading passages...</option>';

  const { data, error } = await supabaseClient
    .from("passages")
    .select("id, title, passage_type, category, duration")
    .order("title", { ascending: true });

  if (error || !data) {
    select.innerHTML = '<option>Could not load passages</option>';
    console.error(error);
    return;
  }

  allPassages = data;
}

// Only shows passages matching the currently selected Test Type + Category:
//   ssc_mock/legal_mock -> passage_type = 'Mock Test',        category matches
//   credit               -> passage_type = 'Credit Based Test', category matches
function refreshPassageOptions() {
  const select = document.getElementById("mPassage");
  const note = document.getElementById("mPassageNote");
  const testType = document.getElementById("mTestType").value;
  const category = document.getElementById("mCategory").value; // 'ssc' | 'legal'
  const categoryLabel = category === "ssc" ? "SSC" : "Legal";

  const requiredPassageType = testType === "credit" ? "Credit Based Test" : "Mock Test";

  const matching = allPassages.filter(p =>
    p.passage_type === requiredPassageType && p.category === categoryLabel
  );

  select.innerHTML = "";
  if (matching.length === 0) {
    select.innerHTML = '<option value="">No matching passages — add one in Passages first</option>';
    note.textContent = 'Looking for: Passage Type = "' + requiredPassageType + '", Category = "' + categoryLabel + '". None found yet.';
    return;
  }

  matching.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.title + " — " + p.passage_type + " — " + p.category;
    select.appendChild(opt);
  });
  note.textContent = 'Showing passages where Passage Type = "' + requiredPassageType + '" and Category = "' + categoryLabel + '".';
}

/* ---------------- Loading / rendering the list ---------------- */

function testTypeFromRow(m) {
  if (m.access_type === "credit") return "credit";
  return m.category === "ssc" ? "ssc_mock" : "legal_mock";
}
function testTypeLabel(testType) {
  if (testType === "credit") return "Credit Based Test";
  if (testType === "ssc_mock") return "SSC Mock Test";
  return "Legal Mock Test";
}

async function loadMockTests() {
  const listBody = document.getElementById("mockListBody");
  listBody.innerHTML = '<div class="loading-strip">Loading mock tests...</div>';

  const categoryFilter = document.getElementById("filterCategory").value;
  const testTypeFilter = document.getElementById("filterTestType").value;

  let query = supabaseClient
    .from("mock_tests")
    .select("*, passages(title)")
    .order("category", { ascending: true })
    .order("display_order", { ascending: true });

  if (categoryFilter !== "all") {
    query = query.eq("category", categoryFilter);
  }
  if (testTypeFilter === "credit") {
    query = query.eq("access_type", "credit");
  } else if (testTypeFilter === "ssc_mock") {
    query = query.eq("category", "ssc").neq("access_type", "credit");
  } else if (testTypeFilter === "legal_mock") {
    query = query.eq("category", "legal").neq("access_type", "credit");
  }

  const { data, error } = await query;

  if (error) {
    listBody.innerHTML = '<div class="empty-state">Could not load mock tests.</div>';
    console.error(error);
    return;
  }

  renderList(data);
}

function renderList(mocks) {
  const listBody = document.getElementById("mockListBody");

  if (mocks.length === 0) {
    listBody.innerHTML = '<div class="empty-state">No mock tests found for this filter.</div>';
    return;
  }

  let rows = "";
  mocks.forEach(m => {
    const testType = testTypeFromRow(m);
    const passageTitle = m.passages ? m.passages.title : "(passage deleted)";
    const costCell = testType === "credit" ? "Cost: 1 Credit" : (m.access_type === "free" ? "Free" : "Premium");

    rows += `
      <tr>
        <td>${escapeHtml(m.title)}</td>
        <td><span class="pill">${escapeHtml(testTypeLabel(testType))}</span></td>
        <td><span class="pill">${escapeHtml(m.category.toUpperCase())}</span></td>
        <td>${escapeHtml(passageTitle)}</td>
        <td>${m.duration} min</td>
        <td>${escapeHtml(costCell)}</td>
        <td>${m.display_order}</td>
        <td>${m.active ? "Active" : "Inactive"}</td>
        <td style="white-space:nowrap;">
          <button type="button" class="btn btn-ghost" style="padding:5px 10px;font-size:0.75rem;" onclick="startEdit('${m.id}')">Edit</button>
          <button type="button" class="btn" style="padding:5px 10px;font-size:0.75rem;" onclick="deleteMockTest('${m.id}')">Delete</button>
        </td>
      </tr>`;
  });

  listBody.innerHTML = `
    <div style="overflow-x:auto;">
    <table class="marksheet">
      <thead>
        <tr>
          <th>Title</th>
          <th>Test Type</th>
          <th>Category</th>
          <th>Passage</th>
          <th>Duration</th>
          <th>Access / Cost</th>
          <th>Display Order</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    </div>`;

  window._mockLookup = {};
  mocks.forEach(m => { window._mockLookup[m.id] = m; });
}

/* ---------------- Add / Edit form ---------------- */

async function handleSubmit(e) {
  e.preventDefault();
  hideFormMessages();

  const submitBtn = document.getElementById("submitBtn");
  submitBtn.disabled = true;

  const testType = document.getElementById("mTestType").value;
  let category, accessType;

  if (testType === "ssc_mock") {
    category = "ssc";
    accessType = document.getElementById("mAccess").value; // 'free' | 'premium'
  } else if (testType === "legal_mock") {
    category = "legal";
    accessType = document.getElementById("mAccess").value;
  } else {
    category = document.getElementById("mCategory").value; // admin's choice
    accessType = "credit"; // fixed, never editable
  }

  const payload = {
    title: document.getElementById("mTitle").value.trim(),
    category: category,
    access_type: accessType,
    passage_id: document.getElementById("mPassage").value,
    duration: parseInt(document.getElementById("mDuration").value, 10),
    display_order: parseInt(document.getElementById("mOrder").value, 10) || 0,
    active: document.getElementById("mActive").value === "true"
  };

  if (!payload.passage_id) {
    showFormError("Please select a passage to assign to this mock test.");
    submitBtn.disabled = false;
    return;
  }

  try {
    if (editingId) {
      const { error } = await supabaseClient.from("mock_tests").update(payload).eq("id", editingId);
      if (error) throw error;
      showFormSuccess("Mock test updated.");
    } else {
      const { error } = await supabaseClient.from("mock_tests").insert(payload);
      if (error) throw error;
      showFormSuccess("Mock test added.");
    }
    exitEditMode();
    await loadMockTests();
  } catch (err) {
    showFormError(err.message || "Something went wrong. Please try again.");
  } finally {
    submitBtn.disabled = false;
  }
}

function startEdit(id) {
  const m = window._mockLookup[id];
  if (!m) return;

  editingId = id;
  const testType = testTypeFromRow(m);

  document.getElementById("mTitle").value = m.title;
  document.getElementById("mTestType").value = testType;
  onTestTypeChange(); // sets category lock/unlock, shows Access or Cost, refreshes passage list

  if (testType === "credit") {
    document.getElementById("mCategory").value = m.category;
    refreshPassageOptions();
  } else {
    document.getElementById("mAccess").value = m.access_type;
  }

  // Now that the passage list matches this row's Test Type/Category, select it
  document.getElementById("mPassage").value = m.passage_id;

  document.getElementById("mDuration").value = String(m.duration);
  document.getElementById("mOrder").value = m.display_order;
  document.getElementById("mActive").value = m.active ? "true" : "false";

  document.getElementById("formLabel").textContent = "Editing: " + m.title;
  document.getElementById("submitBtn").textContent = "Update Mock Test";
  document.getElementById("cancelEditBtn").style.display = "inline-block";

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function exitEditMode() {
  editingId = null;
  document.getElementById("mockForm").reset();
  onTestTypeChange();
  document.getElementById("formLabel").textContent = "Add a New Mock Test";
  document.getElementById("submitBtn").textContent = "Add Mock Test";
  document.getElementById("cancelEditBtn").style.display = "none";
}

async function deleteMockTest(id) {
  const m = window._mockLookup[id];
  const label = m ? m.title : "this mock test";
  if (!confirm('Delete "' + label + '"? This cannot be undone (student results already saved for it are kept).')) return;

  const { error } = await supabaseClient.from("mock_tests").delete().eq("id", id);
  if (error) {
    alert("Could not delete: " + error.message);
    return;
  }
  await loadMockTests();
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
