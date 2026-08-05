/* ============================================================
   auth.js
   ------------------------------------------------------------
   Shared login / registration / session helper functions.
   Used by login.html, dashboard.html, and typing.html.
   Requires supabase-config.js to be loaded first.
   ============================================================ */

// Register a brand-new student account
async function registerStudent(fullName, email, password) {
  const { data, error } = await supabaseClient.auth.signUp({
    email: email,
    password: password,
    options: {
      data: { full_name: fullName } // stored on the auth user itself
    }
  });

  if (error) throw error;

  // Also create a row in our own "profiles" table so we can
  // easily show the student's name on the dashboard later.
  if (data.user) {
    await supabaseClient.from("profiles").insert({
      id: data.user.id,
      full_name: fullName
    });
  }

  return data;
}

// Log an existing student in
async function loginStudent(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: email,
    password: password
  });
  if (error) throw error;
  return data;
}

// Log the current student out, then send them to the login page
async function logoutStudent() {
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
}

// Get the currently logged-in user (or null if nobody is logged in)
async function getCurrentUser() {
  const { data } = await supabaseClient.auth.getUser();
  return data.user || null;
}

// Call this at the top of any PROTECTED page (dashboard, typing).
// If nobody is logged in, it redirects to login.html automatically.
// If somebody IS logged in, it fills in the letterhead's name +
// logout button, and returns the user object.
async function requireLogin() {
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = "login.html";
    return null;
  }

  const chip = document.getElementById("userChip");
  if (chip) {
    const name = user.user_metadata && user.user_metadata.full_name
      ? user.user_metadata.full_name
      : user.email;
    chip.textContent = name;
  }

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", logoutStudent);
  }

  return user;
}
