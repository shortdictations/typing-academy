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
   the scrollbar), not from a CSS vw unit — this is what actually
   guarantees it can never cause page-level horizontal scroll,
   rather than leaning on a blanket body-level overflow fix.

   The moving line is built from a repeating "unit" (icon + all
   active announcements joined by a bullet). The unit's real
   rendered width is measured, then just enough copies are placed
   back-to-back to cover the full viewport width plus one extra —
   so there is always a trailing copy ready to enter as the
   leading one exits, however short or long the content is. The
   track then animates by exactly one unit's width (measured, not
   guessed), which is what makes the loop seamless regardless of
   content length, screen width, or announcement count.

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
  // The icon is part of the moving content itself — not a fixed
  // element outside it — so the whole line travels together with
  // no separate ticker structure around it.
  const icon = '<span class="announcement-ticker-icon">&#128226;</span>';
  const items = announcements.map(a => {
    const text = escapeHtmlTicker(a.title) +
      (a.message ? ": " + escapeHtmlTicker(a.message) : "");
    return a.action_url
      ? '<a class="announcement-ticker-item" href="' + escapeHtmlTicker(a.action_url) + '">' + text + '</a>'
      : '<span class="announcement-ticker-item">' + text + '</span>';
  });
  const unitHtml = icon + items.join('<span class="announcement-ticker-sep">&bull;</span>');

  container.style.display = "block";
  container.innerHTML =
    '<div class="announcement-ticker-track">' +
      '<div class="announcement-ticker-content" id="' + container.id + 'Content"></div>' +
    '</div>';

  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const content = document.getElementById(container.id + "Content");

  if (reduceMotion) {
    // Static single line, no repetition, no animation — the
    // announcement itself is not removed, just not scrolling.
    content.innerHTML = '<span class="announcement-ticker-unit" style="margin-right:0;">' + unitHtml + "</span>";
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

    // Measure one unit's real rendered width (including its own
    // trailing gap) before deciding how many copies are needed —
    // never guessed, never hardcoded.
    content.innerHTML = '<span class="announcement-ticker-unit" id="' + container.id + 'Probe">' + unitHtml + "</span>";
    const probe = document.getElementById(container.id + "Probe");
    const gapPx = parseFloat(getComputedStyle(probe).marginRight) || 0;
    const pitch = probe.getBoundingClientRect().width + gapPx; // distance from one unit's start to the next

    if (pitch <= 0) return; // nothing to animate (shouldn't happen — announcements always render some text)

    const viewportWidth = document.documentElement.clientWidth;
    // Enough copies to cover the full viewport, plus one extra so a
    // trailing copy is always already in place as the leading one
    // exits — this is what removes any blank gap for short content.
    const neededCopies = Math.ceil(viewportWidth / pitch) + 1;

    let html = "";
    for (let i = 0; i < neededCopies; i++) {
      html += '<span class="announcement-ticker-unit">' + unitHtml + "</span>";
    }
    content.innerHTML = html;

    // Distance and duration both come from the actual measured
    // pitch, so speed stays a consistent ~50px/s and the loop
    // point always lines up exactly, whatever the content is.
    const pixelsPerSecond = 50;
    const duration = Math.max(pitch / pixelsPerSecond, 6);
    content.style.setProperty("--ticker-distance", pitch + "px");
    content.style.animationDuration = duration + "s";

    // Force a clean restart rather than letting the browser carry
    // over the current animation progress against a new distance/
    // duration — that's what would otherwise cause a visible jump
    // on resize, since this is the same element being re-animated,
    // not a fresh one.
    content.classList.remove("is-animating");
    void content.offsetWidth; // forces reflow so the removal actually takes effect before re-adding
    content.classList.add("is-animating");
  }

  rebuild();

  // Recalculates on resize/orientation change so the loop never
  // develops a gap or a jump when the viewport changes.
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(rebuild, 200);
  });
}

// Makes the ticker span the true viewport width edge-to-edge,
// computed from the actual DOM rather than a CSS vw unit — this is
// what guarantees no page-level horizontal scroll, without relying
// on a blanket overflow-x:hidden somewhere else on the page.
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
