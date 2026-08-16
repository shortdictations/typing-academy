/* ============================================================
   announcement-ticker.js
   ------------------------------------------------------------
   Renders the horizontal announcement ticker. Shared by
   dashboard.html and index.html so the fetch/filter logic lives
   in exactly one place instead of being duplicated per page.

   Call initAnnouncementTicker(containerId, locationKey) once per
   page, where locationKey is "dashboard" or "home" — it decides
   which announcements are eligible via the show_on column
   (e.g. show_on=['dashboard'] or ['dashboard','home']).

   Shows only announcements that are:
     - active = true
     - show_on includes locationKey
     - currently within their start_at/end_at window (nulls mean
       no restriction on that side)
   respecting display_order. The container is hidden completely
   (not left empty) when nothing currently qualifies.

   Read-only — never writes anything. Does not touch auth,
   passes, credits, mock tests, or payments.
   ============================================================ */

async function initAnnouncementTicker(containerId, locationKey) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const { data, error } = await supabaseClient
    .from("announcements")
    .select("*")
    .eq("active", true)
    .contains("show_on", [locationKey])
    .order("display_order", { ascending: true });

  if (error || !data) {
    console.error("announcements fetch error:", error);
    return; // container stays hidden (its default state)
  }

  const now = new Date();
  const live = data.filter(a => {
    const started = !a.start_at || new Date(a.start_at) <= now;
    const notEnded = !a.end_at || new Date(a.end_at) >= now;
    return started && notEnded;
  });

  if (live.length === 0) {
    container.style.display = "none";
    container.innerHTML = "";
    return;
  }

  renderTicker(container, live);
}

function renderTicker(container, announcements) {
  const items = announcements.map(a => {
    const text = escapeHtmlTicker(a.title) +
      (a.message ? ": " + escapeHtmlTicker(a.message) : "");
    return a.action_url
      ? '<a class="announcement-ticker-item" href="' + escapeHtmlTicker(a.action_url) + '">' + text + '</a>'
      : '<span class="announcement-ticker-item">' + text + '</span>';
  });

  // The visible sequence, separated by a bullet.
  const sequence = items.join('<span class="announcement-ticker-sep">&bull;</span>');

  // Duplicated once back-to-back so the CSS animation can loop
  // seamlessly: scrolling exactly -50% of the track's width moves
  // the first copy fully out just as the second copy reaches the
  // start, with no visible seam or jump.
  container.innerHTML =
    '<span class="announcement-ticker-icon">&#128226;</span>' +
    '<div class="announcement-ticker-track">' +
      '<div class="announcement-ticker-content" id="' + container.id + 'Content">' +
        sequence + '<span class="announcement-ticker-sep">&bull;</span>' +
        sequence + '<span class="announcement-ticker-sep">&bull;</span>' +
      '</div>' +
    '</div>';

  container.style.display = "flex";

  // Speed scales with content length so pace stays comfortable
  // whether there's one short announcement or several long ones,
  // instead of a fixed duration that would race or crawl.
  const content = document.getElementById(container.id + "Content");
  requestAnimationFrame(() => {
    const halfWidth = content.scrollWidth / 2; // one full, un-duplicated pass
    const pixelsPerSecond = 60;
    const duration = Math.max(halfWidth / pixelsPerSecond, 12); // 12s floor for very short content
    content.style.animationDuration = duration + "s";
  });
}

function escapeHtmlTicker(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : str;
  return div.innerHTML;
}
