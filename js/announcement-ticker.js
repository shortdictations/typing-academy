/* ============================================================
   announcement-ticker.js
   ------------------------------------------------------------
   Renders the horizontal announcement ticker. Shared by
   dashboard.html and index.html so the fetch/filter logic lives
   in exactly one place instead of being duplicated per page.

   Renders as a single line of moving text directly over the page's
   existing background — no visible bar, box, or border. The
   wrapper's own size/position is computed in JS from the actual
   viewport (document.documentElement.clientWidth, which excludes
   the scrollbar), not from a CSS vw unit — this is what guarantees
   it can never cause page-level horizontal scroll.

   ONE-JOURNEY MODEL (not a repeated/duplicated track): all active
   announcements are joined into a single sequence (icon + each
   announcement separated by a bullet). That ONE element travels
   once across the viewport per animation cycle — starting fully
   off-screen right (translateX(100vw)) and ending fully off-screen
   left (translateX(-100%), i.e. shifted left by exactly its own
   width). There is never a second copy on screen at the same time,
   however short the sequence is. The animation's iteration-count
   is infinite with the same from/to positions, so the "reset" from
   one journey to the next happens while the element is fully
   off-screen on both sides — invisible by construction, no JS
   reset logic needed. Only the animation-duration is computed in
   JS, from the actual measured (viewport width + sequence width),
   so a short single announcement still makes one full, correctly
   paced journey instead of finishing too fast or too slow.

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

  setUpTicker(container, live);
}

function setUpTicker(container, announcements) {
  // The icon is part of the sequence itself — not a fixed element
  // outside it — so the whole line travels together as one piece.
  const icon = '<span class="announcement-ticker-icon">&#128226;</span>';
  const items = announcements.map(a => {
    const text = escapeHtmlTicker(a.title) +
      (a.message ? ": " + escapeHtmlTicker(a.message) : "");
    return a.action_url
      ? '<a class="announcement-ticker-item" href="' + escapeHtmlTicker(a.action_url) + '">' + text + '</a>'
      : '<span class="announcement-ticker-item">' + text + '</span>';
  });
  // ALL active announcements combined into ONE sequence — this is
  // the one and only thing that ever travels across the viewport,
  // never independently animated per announcement.
  const sequenceHtml = icon + items.join('<span class="announcement-ticker-sep">&bull;</span>');

  container.style.display = "block";
  container.innerHTML =
    '<div class="announcement-ticker-track">' +
      '<span class="announcement-ticker-content" id="' + container.id + 'Content">' + sequenceHtml + '</span>' +
    '</div>';

  const content = document.getElementById(container.id + "Content");
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduceMotion) {
    // Static single line, no animation — the announcement itself
    // is not removed, just not scrolling.
    fullBleed(container);
    let resizeTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => fullBleed(container), 200);
    });
    return;
  }

  function rebuild() {
    fullBleed(container);

    const viewportWidth = document.documentElement.clientWidth;
    const sequenceWidth = content.getBoundingClientRect().width;

    // One full journey = the sequence traveling from fully
    // off-screen right to fully off-screen left, i.e. the viewport
    // width plus the sequence's own width — never a fixed/guessed
    // duration, so a short announcement isn't rushed or a long one
    // dragged out.
    const pixelsPerSecond = 50;
    const totalTravel = viewportWidth + sequenceWidth;
    const duration = Math.max(totalTravel / pixelsPerSecond, 4);
    content.style.animationDuration = duration + "s";

    // Force a clean restart rather than letting the browser carry
    // over the current animation progress against a new duration —
    // that's what would otherwise cause a visible jump on resize,
    // since this is the same element being re-animated, not a
    // fresh one.
    content.classList.remove("is-animating");
    void content.offsetWidth; // forces reflow so the removal actually takes effect before re-adding
    content.classList.add("is-animating");
  }

  rebuild();

  // Recalculates on resize/orientation change so the journey's
  // pacing stays correct and the reset stays invisible.
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(rebuild, 200);
  });
}

// Makes the ticker span the true viewport width edge-to-edge,
// computed from the actual DOM rather than a CSS vw unit — this is
// what guarantees no page-level horizontal scroll.
function fullBleed(container) {
  container.style.width = "100%";
  container.style.marginLeft = "0";
  const rect = container.getBoundingClientRect();
  container.style.width = document.documentElement.clientWidth + "px";
  container.style.marginLeft = (-rect.left) + "px";
}

function escapeHtmlTicker(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : str;
  return div.innerHTML;
}
