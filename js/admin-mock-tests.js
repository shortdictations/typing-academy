/* ============================================================
   admin-mock-tests.js
   ------------------------------------------------------------
   Powers admin-mock-tests.html: create / edit / delete / filter
   mock tests. Gated by requireAdmin() — the real security is
   Supabase RLS on mock_tests, which rejects writes from
   non-admins regardless of the frontend.

   Category (SSC/Legal) is the only test classification — there
   is no separate "Test Type" concept in this UI. Access
   (Free/Premium) is a separate field: Free tests bypass Pass/
   Credit entirely; Premium tests use an eligible Pass for the
   matching category first, falling back to 1 Credit when the
   student has none.

   Passage availability safeguard: the Passage dropdown only
   offers Mock Test passages that are NOT already referenced by
   some mock_tests.passage_id — this is derived entirely from the
   existing mock_tests <-> passages relationship, never from a
   passages.active column (no such requirement exists here, and
   nothing in this file writes to passages at all). When editing
   an existing mock, that mock's own currently-assigned passage
   stays selectable even though it's "used" by this very row (see
   editingExtraPassage below).
   ============================================================ */

let editingId = null;
let allPassages = []; // full list fetched once; filtered client-side per category
let usedPassageIds = new Set(); // passage_id values already referenced by some mock_tests row
let editingExtraPassage = null; // set only while editing: {id, title, category} for THIS mock's own passage, so it stays selectable even though it's "used" by this row

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireAdmin();
  if (!user) return;

  // Same call dashboard.js/subscriptions.js already make — wires the
  // header avatar dropdown, mobile profile drawer, bottom nav active
  // state, and sidebar collapse toggle. Not previously called on any
  // admin page (checked directly), which left the header's logout
  // button dead even before this redesign.
  if (typeof initAuthHeader === "function") initAuthHeader(user);

  await loadAllPassages();

  document.getElementById("mCategory").addEventListener("change", refreshPassageOptions);
  refreshPassageOptions(); // set correct initial passage list

  document.getElementById("mockForm").addEventListener("submit", handleSubmit);
  document.getElementById("cancelEditBtn").addEventListener("click", exitEditMode);
  document.getElementById("filterCategory").addEventListener("change", loadMockTests);

  await loadMockTests();
});

/* ---------------- Passage picker ---------------- */

// Loads every Mock Test passage AND every passage_id already used by
// an existing mock_tests row, so refreshPassageOptions() can exclude
// already-assigned passages without ever touching passages.active.
async function loadAllPassages() {
  const select = document.getElementById("mPassage");
  select.innerHTML = '<option>Loading passages...</option>';

  const { data: passages, error: passageError } = await supabaseClient
    .from("passages")
    .select("id, title, passage_type, category, duration")
    .eq("passage_type", "Mock Test")
    .order("title", { ascending: true });

  if (passageError || !passages) {
    select.innerHTML = '<option>Could not load passages</option>';
    console.error(passageError);
    return;
  }

  const { data: mocks, error: mockError } = await supabaseClient
    .from("mock_tests")
    .select("id, passage_id");

  if (mockError) {
    console.error(mockError);
    // Passages themselves loaded fine — fail safe by treating no
    // passage as "used" rather than blocking the whole form.
    usedPassageIds = new Set();
  } else {
    usedPassageIds = new Set(
      (mocks || [])
        .map(m => m.passage_id)
        .filter(Boolean)
    );
  }

  allPassages = passages;
}

// Shows Mock Test passages matching the currently selected category,
// excluding any passage already referenced by another mock_tests row
// — except the passage currently assigned to the mock being edited
// (see editingExtraPassage), which always stays selectable.
function refreshPassageOptions() {
  const select = document.getElementById("mPassage");
  const note = document.getElementById("mPassageNote");
  const category = document.getElementById("mCategory").value; // 'ssc' | 'legal'
  const categoryLabel = category === "ssc" ? "SSC" : "Legal";

  const matching = allPassages.filter(p =>
    p.category === categoryLabel &&
    (!usedPassageIds.has(p.id) || (editingExtraPassage && p.id === editingExtraPassage.id))
  );

  select.innerHTML = "";
  if (matching.length === 0) {
    select.innerHTML = '<option value="">No matching passages — add one in Passages first</option>';
    note.textContent = "No matching " + categoryLabel + " passages — add one in Passages first.";
    return;
  }

  matching.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    const currentTag = editingExtraPassage && p.id === editingExtraPassage.id ? " — currently assigned" : "";
    opt.textContent = p.title + " — " + p.category + currentTag;
    select.appendChild(opt);
  });
  note.textContent = "Showing " + categoryLabel + " passages.";
}

/* ---------------- Loading / rendering the list ---------------- */

async function loadMockTests() {
  const listBody = document.getElementById("mockListBody");
  listBody.innerHTML = '<div class="loading-strip">Loading mock tests...</div>';

  const categoryFilter = document.getElementById("filterCategory").value;

  let query = supabaseClient
    .from("mock_tests")
    .select("*, passages(title)")
    .order("category", { ascending: true })
    .order("display_order", { ascending: true });

  if (categoryFilter !== "all") {
    query = query.eq("category", categoryFilter);
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
    const passageTitle = m.passages ? m.passages.title : "(passage deleted)";
    const costCell = m.access_type === "free" ? "Free" : "Pass, or 1 Credit";

    rows += `
      <tr>
        <td>${escapeHtml(m.title)}</td>
        <td><span class="pill">${escapeHtml(m.category.toUpperCase())}</span></td>
        <td>${escapeHtml(passageTitle)}</td>
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
          <th>Category</th>
          <th>Passage</th>
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

  const category = document.getElementById("mCategory").value; // 'ssc' | 'legal'
  const accessType = document.getElementById("mAccess").value; // 'free' | 'premium'

  const payload = {
    title: document.getElementById("mTitle").value.trim(),
    category: category,
    access_type: accessType,
    passage_id: document.getElementById("mPassage").value,
    // Duration is intentionally not selected by the admin.
    // Keep the legacy DB column populated on new rows for schema compatibility;
    // the student selects 5 or 10 minutes when starting the mock.
    duration: 10,
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
      const { error } = await supabaseClient.from("mock_tests").insert(payload).select().single();
      if (error) throw error;
      showFormSuccess("Mock test added.");
    }

    // Reload the used-passage set (and the passage list itself) so
    // the just-assigned passage disappears from the dropdown
    // immediately — no browser refresh needed. This is what
    // actually enforces the safeguard: it's derived fresh from
    // mock_tests.passage_id every time, never from a stored flag.
    await loadAllPassages();
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

  document.getElementById("mTitle").value = m.title;
  document.getElementById("mCategory").value = m.category;
  document.getElementById("mAccess").value = m.access_type;

  // This mock's own passage counts as "used" (it's referenced by
  // this very row), so without this it would vanish from the
  // dropdown while editing. Keep it selectable, tagged as the
  // current assignment — never written back to the passage itself.
  editingExtraPassage = {
    id: m.passage_id,
    title: m.passages ? m.passages.title : "(passage deleted)",
    category: m.category === "ssc" ? "SSC" : "Legal"
  };

  refreshPassageOptions(); // sets the passage list to match this row's category

  // Now that the passage list matches this row's category, select it
  document.getElementById("mPassage").value = m.passage_id;

  document.getElementById("mOrder").value = m.display_order;
  document.getElementById("mActive").value = m.active ? "true" : "false";

  document.getElementById("formLabel").textContent = "Editing: " + m.title;
  document.getElementById("submitBtn").textContent = "Update Mock Test";
  document.getElementById("cancelEditBtn").style.display = "inline-block";

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function exitEditMode() {
  editingId = null;
  editingExtraPassage = null;
  document.getElementById("mockForm").reset();
  refreshPassageOptions();
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

  // Deleting a mock test frees up its passage — reload the used-set
  // so that passage reappears in the dropdown immediately.
  await loadAllPassages();
  refreshPassageOptions();
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
