/* ============================================================
   help-support.js
   ------------------------------------------------------------
   No backend mail service is configured for this project, so
   submitting builds a mailto: link (opens the user's own email app
   with the message pre-filled) rather than silently pretending to
   send an email server-side. Recipient is fixed to
   shortdictations@gmail.com. The sender identity (name/email) comes
   straight from the logged-in account — same email_confirmed_at
   check as Settings — rather than asking the student to retype it.

   The header (avatar/name/credits/dropdown) is NOT implemented here
   at all — this page uses the exact same initAuthHeader()/
   requireLogin() from js/auth.js that dashboard.html, settings.html,
   and every other authenticated page use. There's nothing
   page-specific to fix; see the DOMContentLoaded handler below,
   which just calls the shared requireLogin() like every other page.

   The 4 help articles below are real, written against this
   project's actual features (mock tests, passes, credits, settings)
   — same as the FAQ. The search box and "View Articles" buttons
   work against this real content, not a fabricated system.
   ============================================================ */

// ---------------------------------------------------------------
// Article content — grounded in this project's actual behavior:
// WPM/accuracy formulas from mock-test-attempt.js, the
// credits-vs-pass precedence rule from subscriptions.html's own
// copy, the free-credit count from the site-wide announcement
// banner, and the real page names used in the sidebar/nav.
// ---------------------------------------------------------------
const HELP_ARTICLES = {
  "getting-started": {
    title: "Getting Started with TypeShala",
    accentClass: "dash-tile-blue",
    intro: "TypeShala is a typing practice platform built for SSC and Legal/Court typing exam aspirants. It runs full-length mock tests modeled on the real exam format, and scores every attempt automatically.",
    sections: [
      {
        heading: "Creating an account and logging in",
        paragraphs: [
          "Register with your name, email address, and a password from the Register page. Once your account is created, you can log in any time from the Login page with the same email and password."
        ]
      },
      {
        heading: "Free credits for new users",
        paragraphs: [
          "New accounts receive 3 free credits automatically, usable on any SSC or Legal mock test — no purchase needed to try your first few tests."
        ]
      },
      {
        heading: "Starting your first mock test",
        paragraphs: ["From the sidebar, go to Start Test, choose a category, then pick a mock test from the list. The passage is assigned automatically — you won't choose it yourself — and appears the moment you click Start."]
      },
      {
        heading: "Choosing SSC or Legal",
        paragraphs: [
          "SSC and Legal/Court are separate typing categories, each with their own passages and mock tests. If you need both, a Combo Pass unlocks every category with one pass instead of two."
        ]
      },
      {
        heading: "Understanding your score",
        bullets: [
          "Gross WPM — every character you typed, correct or not, converted to words per minute.",
          "Net WPM — the same calculation using only your correctly typed characters, so mistakes lower this number.",
          "Accuracy — the percentage of what you typed that was correct."
        ]
      },
      {
        heading: "Where to review your progress",
        paragraphs: [
          "Every completed test is saved to My Tests (Mock History), and your Dashboard shows your average WPM, average accuracy, and a chart of your recent tests. Typing regularly and reviewing where you lost accuracy is the fastest way to improve."
        ]
      }
    ]
  },

  "mock-tests": {
    title: "How Mock Tests Work",
    accentClass: "dash-tile-green",
    intro: "Every mock test on TypeShala runs the same way: pick a test, get a passage, type against the clock, and see your score immediately.",
    sections: [
      {
        heading: "Starting a test",
        paragraphs: [
          "Go to Start Test, choose SSC or Legal, then pick a specific mock test from the list. Your passage is assigned automatically — the same test always uses the same passage — and only appears once you click Start."
        ]
      },
      {
        heading: "Test duration and timing",
        paragraphs: [
          "Each mock test has a fixed duration, shown before you start. The timer only begins the moment you start typing, not the moment the page loads, so you can read the passage first if you want."
        ]
      },
      {
        heading: "How your score is calculated",
        bullets: [
          "Gross WPM — total characters typed ÷ 5, divided by minutes elapsed.",
          "Net WPM — only correctly typed characters ÷ 5, divided by minutes elapsed.",
          "Accuracy — correct characters as a percentage of everything you typed.",
          "Mistakes — the count of characters that didn't match the passage."
        ]
      },
      {
        heading: "When the timer ends",
        paragraphs: [
          "Typing locks the instant time runs out, and your result is calculated and saved automatically from whatever you'd typed up to that point — you don't need to submit manually."
        ]
      },
      {
        heading: "What unlocks a test",
        paragraphs: [
          "An eligible active Pass for that category, or a Credit. If you have both, your Pass is always used first — Credits are only spent when you don't have an eligible Pass, so they're never used unnecessarily."
        ]
      },
      {
        heading: "Reviewing past results",
        paragraphs: [
          "My Tests (Mock History) lists every attempt you've made with its WPM, accuracy, and date. Your Dashboard also shows your 5 most recent tests at a glance."
        ]
      }
    ]
  },

  "pass-credits": {
    title: "Passes & Credits Explained",
    accentClass: "dash-tile-purple",
    intro: "TypeShala offers two ways to unlock mock tests: a category Pass for unlimited attempts, or single-use Credits — whichever suits how often you practice.",
    sections: [
      {
        heading: "Passes",
        bullets: [
          "SSC Pass — unlimited SSC mock tests for the pass's validity period.",
          "Legal Pass — unlimited Legal/Court mock tests for the pass's validity period.",
          "Combo Pass — unlimited tests in both categories with a single pass."
        ]
      },
      {
        heading: "Credits",
        paragraphs: [
          "1 Credit = 1 test attempt, usable on any SSC or Legal mock test. New accounts get 3 free credits automatically, and more can be purchased in packs from the Pass & Credits page."
        ]
      },
      {
        heading: "Which one gets used first",
        paragraphs: [
          "If you have both an eligible active Pass and Credits, your Pass is always used first — Credits are only spent once you don't have an eligible Pass for that test, so they never get used unnecessarily."
        ]
      },
      {
        heading: "Checking your validity and balance",
        paragraphs: [
          "Your Dashboard shows an Active Pass card (with days remaining) and a Remaining Credits card. The Pass & Credits page shows the same information in more detail, including which categories are currently active."
        ]
      },
      {
        heading: "When a pass expires",
        paragraphs: [
          "Once a Pass's validity period ends, it stops unlocking tests in that category — you'll need to renew it, or fall back on any Credits you still have."
        ]
      },
      {
        heading: "Buying more",
        paragraphs: [
          "Visit Pass & Credits to purchase a Pass or top up Credits. Payments are processed securely through Razorpay."
        ]
      }
    ]
  },

  "account-profile": {
    title: "Managing Your Account & Profile",
    accentClass: "dash-tile-orange",
    intro: "Your name, email, mobile number, password, and theme preference are all managed from one place: Settings.",
    sections: [
      {
        heading: "Profile information",
        paragraphs: [
          "Settings → Account lets you update your Full Name and Mobile Number at any time using the Change button next to each field. Your Email Address is shown alongside a Verified or Not Verified status, based on whether you've confirmed it with TypeShala."
        ]
      },
      {
        heading: "Changing your password",
        paragraphs: ["Go to Settings → Security → Change Password to set a new password for your account."]
      },
      {
        heading: "Theme: Light, Dark, and System",
        paragraphs: [
          "Settings → Appearance → Theme lets you choose Light, Dark, or System (which follows your device's own setting). Your choice is remembered and applied consistently across every page."
        ]
      },
      {
        heading: "Logging out",
        paragraphs: [
          "Click your avatar in the top-right corner of any page to open the account menu, which includes Logout."
        ]
      }
    ]
  }
};

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireLogin(); // redirects to login.html if not logged in — same shared function every authenticated page uses
  if (!user) return;

  renderSenderIdentity(user);
  wireQuickHelpLinks();
  wireArticlePanel();
  wireHelpSearch();

  document.getElementById("helpForm").addEventListener("submit", (e) => handleHelpSubmit(e, user));
});

function renderSenderIdentity(user) {
  document.getElementById("helpSenderEmail").textContent = user.email || "—";

  const verifiedPill = document.getElementById("helpVerifiedPill");
  if (user.email_confirmed_at) {
    verifiedPill.textContent = "Verified ✓";
    verifiedPill.className = "settings-verified-pill";
  } else {
    verifiedPill.textContent = "Not verified";
    verifiedPill.className = "settings-verified-pill settings-unverified-pill";
  }
}

// Each Quick Help card's "View Articles" opens the matching article
// in the panel below the cards.
function wireQuickHelpLinks() {
  document.querySelectorAll("[data-article]").forEach(btn => {
    btn.addEventListener("click", () => openArticle(btn.dataset.article));
  });
}

function wireArticlePanel() {
  document.getElementById("helpArticlePanel").addEventListener("click", (e) => {
    if (e.target.closest("[data-close-article]")) closeArticle();
  });
}

function openArticle(key) {
  const article = HELP_ARTICLES[key];
  const panel = document.getElementById("helpArticlePanel");
  if (!article || !panel) return;

  const sectionsHtml = article.sections.map(s => {
    const paras = (s.paragraphs || []).map(p => `<p>${escapeHtmlHelp(p)}</p>`).join("");
    const bullets = s.bullets ? `<ul>${s.bullets.map(b => `<li>${escapeHtmlHelp(b)}</li>`).join("")}</ul>` : "";
    return `<div class="help-article-section"><h3>${escapeHtmlHelp(s.heading)}</h3>${paras}${bullets}</div>`;
  }).join("");

  panel.innerHTML = `
    <button type="button" class="help-article-back" data-close-article>&larr; Back to Help Topics</button>
    <div class="help-article-head">
      <span class="help-topic-icon ${article.accentClass}">${ARTICLE_ICONS[key] || ""}</span>
      <h2>${escapeHtmlHelp(article.title)}</h2>
    </div>
    <p class="help-article-intro">${escapeHtmlHelp(article.intro)}</p>
    ${sectionsHtml}
    <button type="button" class="btn btn-ghost help-article-close" data-close-article>Close Article</button>
  `;
  panel.style.display = "block";
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeArticle() {
  const panel = document.getElementById("helpArticlePanel");
  panel.style.display = "none";
  panel.innerHTML = "";
}

// Small inline icon set reused from the Quick Help cards, keyed by
// article so openArticle() can show the same icon in the panel head.
const ARTICLE_ICONS = {
  "getting-started": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09Z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2Z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>',
  "mock-tests": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M10 13h.01M14 13h.01M18 13h.01M8 17h8"/></svg>',
  "pass-credits": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/></svg>',
  "account-profile": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="8" r="4"/></svg>'
};

// Flat, lowercased searchable text per article (title + every
// heading + every paragraph/bullet) — built once, reused by every
// keystroke in wireHelpSearch() below.
const ARTICLE_SEARCH_INDEX = Object.fromEntries(
  Object.entries(HELP_ARTICLES).map(([key, a]) => {
    const parts = [a.title, a.intro];
    a.sections.forEach(s => {
      parts.push(s.heading);
      if (s.paragraphs) parts.push(...s.paragraphs);
      if (s.bullets) parts.push(...s.bullets);
    });
    return [key, parts.join(" ").toLowerCase()];
  })
);

// "Every word in the query appears somewhere in the text" — more
// forgiving than exact-substring matching (e.g. searching "first
// test" should still find an article that says "first mock test"),
// and still 100% real content matching, not fabricated results.
function matchesQuery(text, query) {
  const words = query.split(/\s+/).filter(Boolean);
  return words.every(w => text.includes(w));
}

// Search covers both the real FAQ entries already on the page (as
// before) AND the article content above — matching articles get
// their Quick Help card highlighted (and non-matches dimmed) rather
// than inventing a separate "search results" list; clicking the
// highlighted card's "View Articles" opens the real match.
function wireHelpSearch() {
  const input = document.getElementById("helpSearchInput");
  const emptyState = document.getElementById("helpFaqEmpty");
  if (!input) return;

  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();
    let anyFaqVisible = false;

    document.querySelectorAll(".help-faq-group").forEach(group => {
      let groupHasMatch = false;
      group.querySelectorAll(".help-faq-item").forEach(item => {
        const text = item.textContent.toLowerCase();
        const matches = query === "" || matchesQuery(text, query);
        item.style.display = matches ? "" : "none";
        if (matches) {
          groupHasMatch = true;
          if (query !== "") item.open = true;
        }
      });
      group.style.display = groupHasMatch ? "" : "none";
      if (groupHasMatch) anyFaqVisible = true;
    });
    if (emptyState) emptyState.style.display = anyFaqVisible ? "none" : "block";

    Object.keys(HELP_ARTICLES).forEach(key => {
      const card = document.getElementById("helpCard-" + key);
      if (!card) return;
      const matches = query !== "" && matchesQuery(ARTICLE_SEARCH_INDEX[key], query);
      card.classList.toggle("help-topic-card-match", matches);
      card.classList.toggle("help-topic-card-dim", query !== "" && !matches);
    });
  });
}

function handleHelpSubmit(e, user) {
  e.preventDefault();
  document.getElementById("helpError").style.display = "none";

  const subject = document.getElementById("helpSubject").value.trim();
  const message = document.getElementById("helpMessage").value.trim();
  if (!subject || !message) return;

  const name = (user.user_metadata && user.user_metadata.full_name) || user.email;
  const body = "From: " + name + " (" + user.email + ")\n\n" + message;
  const mailto = "mailto:shortdictations@gmail.com" +
    "?subject=" + encodeURIComponent(subject) +
    "&body=" + encodeURIComponent(body);

  window.location.href = mailto;
}

function escapeHtmlHelp(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : str;
  return div.innerHTML;
}
