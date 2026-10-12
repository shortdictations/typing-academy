/* ============================================================
   mock-history.js
   ------------------------------------------------------------
   Mock Test History + 6-hour per-result re-attempt window.
   The server/RPC remains authoritative for re-attempt access.
   This file only renders the history and provides presentation.
   ============================================================ */

let currentUser = null;
let countdownTimerId = null;
let allHistoryResults = [];
let sessionByResultId = new Map();
let currentHistoryPage = 1;
let historyPageSize = 10;

document.addEventListener("DOMContentLoaded", async () => {
  currentUser = await requireLogin();
  if (!currentUser) return;

  const { data: results, error: resultsError } = await supabaseClient
    .from("mock_test_results")
    .select("*")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false });

  if (resultsError) {
    console.error("Could not load mock test results:", resultsError);
    document.getElementById("historyBody").innerHTML =
      '<div class="empty-state">Could not load your mock test history. Please refresh the page.</div>';
    return;
  }

  allHistoryResults = results || [];
  const resultIds = allHistoryResults.map(r => r.id).filter(Boolean);

  // Fetch per-attempt key analysis by result id. Do not use lifetime
  // typing_key_stats here, because that would misattribute keys from other tests.
  if (resultIds.length) {
    const { data: keyRows, error: keyError } = await supabaseClient
      .from("mock_test_result_key_analysis")
      .select("result_id, weak_keys, key_analysis")
      .in("result_id", resultIds);
    if (keyError) {
      console.error("Could not load per-attempt key analysis:", keyError);
    } else {
      const keyByResult = new Map((keyRows || []).map(row => [row.result_id, row]));
      allHistoryResults = allHistoryResults.map(row => {
        const analysis = keyByResult.get(row.id);
        return analysis ? { ...row, weak_key_analysis: analysis.weak_keys, key_analysis: analysis.key_analysis } : row;
      });
    }
  }

  sessionByResultId = new Map();
  if (resultIds.length) {
    const { data: sessions, error: sessionsError } = await supabaseClient
      .from("mock_test_sessions")
      .select("result_id, reattempt_window_expires_at")
      .in("result_id", resultIds);

    if (sessionsError) {
      console.error("Could not load re-attempt windows:", sessionsError);
    } else {
      (sessions || []).forEach(session => {
        if (session.result_id) sessionByResultId.set(session.result_id, session);
      });
    }
  }

  renderHistory();
  startCountdownTicker();
});

function renderHistory() {
  const container = document.getElementById("historyBody");

  if (allHistoryResults.length === 0) {
    container.innerHTML =
      '<div class="empty-state">No mock tests completed yet. Take your first one from the Mock Test page.</div>';
    return;
  }

  const totalPages = Math.max(1, Math.ceil(allHistoryResults.length / historyPageSize));
  currentHistoryPage = Math.min(Math.max(currentHistoryPage, 1), totalPages);

  const start = (currentHistoryPage - 1) * historyPageSize;
  const pageResults = allHistoryResults.slice(start, start + historyPageSize);

  const rows = pageResults.map((r, pageIndex) => {
    const absoluteIndex = start + pageIndex;
    const rowId = "mockrow-" + absoluteIndex;
    const date = new Date(r.created_at);
    const dateStr = date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const timeStr = date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    const category = (r.category || "").toLowerCase();
    const isLegal = category === "legal";
    const categoryLabel = (r.category || "-").toUpperCase();
    const sessionForResult = sessionByResultId.get(r.id);
    // The re-attempt window is authoritative on the server
    // (start_reattempt() treats a null/missing expiry as always
    // expired, with no fallback calculation of its own — confirmed
    // directly against the live RPC). A client-side fallback here
    // that invents its own 6-hour window from the result's timestamp
    // would show "Re-attempt available" for rows the server will
    // then reject outright — confirmed this exact mismatch happens
    // for a real, non-zero number of existing completed attempts,
    // whose session rows predate this column and have no expiry
    // stored at all. No expiry stored means no re-attempt shown, full
    // stop, matching the server's own rule exactly.
    const expiresAt = sessionForResult?.reattempt_window_expires_at || null;
    const windowStillOpen = !!expiresAt && new Date(expiresAt).getTime() > Date.now() && !!r.mock_test_id;
    const accuracy = Number(r.accuracy || 0);
    const accuracyClass = accuracy >= 90 ? "mh-accuracy-good" : accuracy < 70 ? "mh-accuracy-low" : "";

    const categoryIcon = isLegal
      ? '<span class="mh-category-logo mh-category-logo-legal"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v17M5 7h14M7 7l-3 6a3 3 0 0 0 6 0L7 7Zm10 0-3 6a3 3 0 0 0 6 0l-3-6ZM8 21h8"/></svg></span>'
      : '<span class="mh-category-logo mh-category-logo-ssc"><img src="assets/ssc-logo.png" alt="SSC"></span>';

    const reattemptHtml = windowStillOpen
      ? `<span class="mh-reattempt-wrap" data-expires-at="${escapeHtml(expiresAt)}" data-result-id="${escapeHtml(r.id)}">` +
          `<button type="button" class="mh-action mh-action-reattempt" onclick="showReattemptDurationPicker(this)">` +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0 2 5"/><path d="M20 4v7h-7"/></svg>' +
            '<span>Re-attempt</span>' +
          '</button>' +
          '<span class="mh-reattempt-countdown"></span>' +
        '</span>'
      : `<span class="mh-action mh-action-unavailable" aria-label="Not available">` +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="m8.5 8.5 7 7"/></svg>' +
          '<span>Not available</span>' +
        '</span>';

    return `
      <tr>
        <td class="mh-row-number">${absoluteIndex + 1}</td>
        <td data-label="Category">
          <span class="mh-category ${isLegal ? "mh-category-legal" : "mh-category-ssc"}">${categoryIcon}<span>${escapeHtml(categoryLabel)}</span></span>
        </td>
        <td data-label="Date & Time">
          <span class="mh-date-main">${dateStr}</span>
          <span class="mh-date-time">${timeStr}</span>
        </td>
        <td data-label="Gross WPM" class="mh-number">${escapeHtml(String(r.gross_wpm ?? "-"))}</td>
        <td data-label="Net WPM" class="mh-number">${escapeHtml(String(r.net_wpm ?? "-"))}</td>
        <td data-label="Accuracy" class="mh-number ${accuracyClass}">${escapeHtml(String(r.accuracy ?? 0))}%</td>
        <td data-label="Errors" class="mh-number">${escapeHtml(String(r.errors ?? 0))}</td>
        <td data-label="Words Typed" class="mh-number">${escapeHtml(String(r.words_typed ?? r.total_words ?? 0))}</td>
        <td data-label="Status">
          <span class="mh-pass-status ${r.is_passed ? "mh-pass" : "mh-not-passed"}">${r.is_passed ? "Passed" : "Not Passed"}</span>
        </td>
        <td data-label="Actions">
          <button type="button" class="mh-action mh-action-result" onclick="downloadHistoryResult(${absoluteIndex})" aria-label="Download result as PDF">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5Z"/><circle cx="12" cy="12" r="2.5"/></svg>
            <span>View Result</span>
          </button>
        </td>
        <td data-label="Re-attempt">${reattemptHtml}</td>
      </tr>
`;
  }).join("");

  container.innerHTML = `
    <div class="mh-table-wrap">
      <table class="mh-history-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Category</th>
            <th>Date &amp; Time <span class="mh-sort-arrow">↓</span></th>
            <th>Gross WPM</th>
            <th>Net WPM</th>
            <th>Accuracy</th>
            <th>Errors</th>
            <th>Words Typed</th>
            <th>Status</th>
            <th>Actions</th>
            <th>Re-attempt</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${renderHistoryFooter(totalPages, start, pageResults.length)}`;

  updateAllCountdowns();
}

function renderHistoryFooter(totalPages, startIndex, visibleCount) {
  const firstShown = allHistoryResults.length ? startIndex + 1 : 0;
  const lastShown = startIndex + visibleCount;
  return `<div class="mh-history-footer">
    <div class="mh-entry-summary">
      <label for="mhEntriesPerPage">Show</label>
      <select class="mh-entry-select" id="mhEntriesPerPage" aria-label="Entries per page" onchange="changeHistoryPageSize(this.value)">
        ${[10,25,50,100].map(size => `<option value="${size}" ${historyPageSize === size ? "selected" : ""}>${size}</option>`).join("")}
      </select>
      <span>entries per page</span>
    </div>
    <div class="mh-footer-right">
      <span class="mh-showing-count">Showing ${firstShown}–${lastShown} of ${allHistoryResults.length} tests</span>
      ${renderPagination(totalPages)}
    </div>
  </div>`;
}

function renderPagination(totalPages) {
  if (totalPages <= 1) return "";

  const pages = [];
  for (let p = 1; p <= totalPages; p++) {
    // Keep the control compact when there are many pages.
    if (totalPages <= 7 || p === 1 || p === totalPages || Math.abs(p - currentHistoryPage) <= 1) {
      pages.push(`<button type="button" class="mh-page-number ${p === currentHistoryPage ? "active" : ""}" onclick="goToHistoryPage(${p})" aria-current="${p === currentHistoryPage ? "page" : "false"}">${p}</button>`);
    } else if (pages[pages.length - 1] !== "ellipsis") {
      pages.push("ellipsis");
    }
  }

  return `<nav class="mh-pagination" aria-label="Mock test history pages">
    <button type="button" class="mh-page-control" onclick="goToHistoryPage(1)" ${currentHistoryPage === 1 ? "disabled" : ""} aria-label="First page">|&lt;</button>
    <button type="button" class="mh-page-control" onclick="goToHistoryPage(${currentHistoryPage - 1})" ${currentHistoryPage === 1 ? "disabled" : ""} aria-label="Previous page">&lsaquo;</button>
    ${pages.map(p => p === "ellipsis" ? '<span class="mh-page-ellipsis">…</span>' : p).join("")}
    <button type="button" class="mh-page-control" onclick="goToHistoryPage(${currentHistoryPage + 1})" ${currentHistoryPage === totalPages ? "disabled" : ""} aria-label="Next page">&rsaquo;</button>
    <button type="button" class="mh-page-control" onclick="goToHistoryPage(${totalPages})" ${currentHistoryPage === totalPages ? "disabled" : ""} aria-label="Last page">&gt;|</button>
  </nav>`;
}

function changeHistoryPageSize(value) {
  const nextSize = Number(value);
  if (![10, 25, 50, 100].includes(nextSize)) return;
  historyPageSize = nextSize;
  currentHistoryPage = 1;
  renderHistory();
}

function goToHistoryPage(page) {
  const totalPages = Math.max(1, Math.ceil(allHistoryResults.length / historyPageSize));
  if (page < 1 || page > totalPages || page === currentHistoryPage) return;
  currentHistoryPage = page;
  renderHistory();
  document.querySelector(".mh-history-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateAllCountdowns() {
  document.querySelectorAll(".mh-reattempt-wrap").forEach(wrap => {
    const expiresAt = new Date(wrap.dataset.expiresAt).getTime();
    const remainingMs = expiresAt - Date.now();

    if (remainingMs <= 0) {
      wrap.remove();
      return;
    }

    const countdownEl = wrap.querySelector(".mh-reattempt-countdown");
    if (countdownEl) countdownEl.textContent = formatCountdown(remainingMs);
  });
}

function formatCountdown(remainingMs) {
  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours >= 1) return `${hours}h ${minutes}m left`;
  if (minutes >= 1) return `${minutes}m ${seconds}s left`;
  return `${seconds}s left`;
}

function startCountdownTicker() {
  if (countdownTimerId) clearInterval(countdownTimerId);
  countdownTimerId = setInterval(updateAllCountdowns, 1000);
}

function showReattemptDurationPicker(btn) {
  const wrap = btn.closest(".mh-reattempt-wrap");
  if (!wrap) return;
  const resultId = wrap.dataset.resultId;
  if (!resultId) return;
  window.location.href = "reattempt-test.html?result=" + encodeURIComponent(resultId);
}

function toggleDetail(rowId) {
  const row = document.getElementById(rowId);
  if (row) row.style.display = row.style.display === "none" ? "table-row" : "none";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}


// Sample-inspired, theme-independent report. Saved attempt time and metrics remain unchanged.
function downloadHistoryResult(index) {
  const r = allHistoryResults[index]; if (!r) return;
  const date = r.created_at ? new Date(r.created_at) : null;
  const dateText = date && !Number.isNaN(date.getTime()) ? date.toLocaleString("en-IN", {day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "Not recorded";
  const generatedText = new Date().toLocaleString("en-IN", {day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});
  const safe = value => escapeHtml(String(value ?? "—"));
  const num = value => value === null || value === undefined || value === "" ? "—" : safe(value);
  const category = String(r.category || "Typing").toUpperCase(); const passed = r.is_passed === true;
  const words = r.words_typed ?? r.total_words ?? r.words ?? null; const errors = r.errors ?? r.total_errors ?? r.mistakes ?? null;
  const duration = r.duration ?? r.duration_minutes ?? "—";
  const candidate = currentUser?.user_metadata?.full_name || currentUser?.user_metadata?.name || currentUser?.email || "Candidate";
  let weak = r.weak_key_analysis ?? r.weak_keys ?? null;
  let keyAnalysis = r.key_analysis ?? r.key_errors ?? r.weak_key_stats ?? null;
  if (typeof weak === "string") { try { weak = JSON.parse(weak); } catch (_) { weak = null; } }
  if (typeof keyAnalysis === "string") { try { keyAnalysis = JSON.parse(keyAnalysis); } catch (_) { keyAnalysis = null; } }
  if (weak && !Array.isArray(weak) && typeof weak === "object") weak = weak.keys ?? weak.items ?? weak.analysis ?? Object.entries(weak).map(([key,value]) => typeof value === "object" ? Object.assign({key},value) : {key,misses:value});
  if (!Array.isArray(weak)) weak = [];

  // Some attempts have a valid per-character key_analysis object but an
  // empty weak_keys array (meaning no key crossed the weak-key threshold).
  // Derive the report's weak list from those saved per-attempt stats instead
  // of incorrectly labelling the analysis as unavailable.
  const hasKeyStats = !!keyAnalysis && typeof keyAnalysis === "object" && Object.keys(keyAnalysis).length > 0;
  if (!weak.length && hasKeyStats) {
    weak = Object.entries(keyAnalysis).map(([key, stat]) => {
      stat = stat && typeof stat === "object" ? stat : {};
      const attempts = Number(stat.attempts ?? stat.total ?? 0);
      const errorsCount = Number(stat.errors ?? stat.error_count ?? stat.misses ?? 0);
      const correct = Number(stat.correct ?? stat.correct_count ?? Math.max(0, attempts - errorsCount));
      const accuracy = stat.accuracy != null ? Number(stat.accuracy) : (attempts > 0 ? correct / attempts * 100 : 100);
      return { key, attempts, errors: errorsCount, accuracy };
    }).filter(item => item.attempts >= 5 && item.errors >= 2 && item.accuracy < 90)
      .sort((x,y) => x.accuracy-y.accuracy).slice(0,5);
  }

  const weakRows = weak.map(item => { item = typeof item === "string" ? {key:item} : (item || {}); const key = item.key ?? item.character ?? item.stroke ?? item.key_name ?? item.name ?? "—"; const misses = item.misses ?? item.errors ?? item.error_count ?? item.count ?? item.total_errors ?? "—"; const acc = item.accuracy ?? item.accuracy_percent ?? item.precision; const impact = item.impact_level ?? item.impact ?? (Number(misses)>=3 ? "HIGH" : Number(misses)===2 ? "MEDIUM" : Number(misses)===1 ? "LOW" : "—"); const pattern = item.finger_pattern ?? item.finger ?? item.recommendation ?? item.note ?? "—"; return "<tr><td><span class=\"history-print-keycap\">"+safe(key)+"</span></td><td>"+num(misses)+"</td><td>"+(acc == null || acc === "" ? "—" : safe(String(acc).includes("%") ? acc : acc+"%"))+"</td><td><b>"+safe(impact)+"</b></td><td>"+safe(pattern)+"</td></tr>"; }).join("");
  const emptyWeakMessage = hasKeyStats ? "No significant weak keys detected in this attempt. Per-key statistics were recorded, but no key met the weak-key threshold." : "Key-level analysis is not available for this attempt. No key-level statistics have been inferred.";
  const weakSection = weakRows ? '<section class="history-print-section"><h2>3. WEAK KEY ANALYSIS</h2><p class="history-print-section-note">Recorded keys and strokes requiring additional practice.</p><table class="history-print-weak-table"><thead><tr><th>KEY / STROKE</th><th>MISSES</th><th>ACCURACY</th><th>IMPACT</th><th>FINGER PATTERN / NOTE</th></tr></thead><tbody>'+weakRows+"</tbody></table></section>" : '<section class="history-print-section"><h2>3. WEAK KEY ANALYSIS</h2><div class="history-print-empty-weak">'+safe(emptyWeakMessage)+'</div></section>';
  // Build evidence-based feedback only from metrics recorded for this attempt.
  const net = Number(r.net_wpm), gross = Number(r.gross_wpm), accuracy = Number(r.accuracy);
  const errorCount = Number(errors), typedWords = Number(words);
  const hasNet = r.net_wpm != null && r.net_wpm !== "" && Number.isFinite(net);
  const hasGross = r.gross_wpm != null && r.gross_wpm !== "" && Number.isFinite(gross);
  const hasAccuracy = r.accuracy != null && r.accuracy !== "" && Number.isFinite(accuracy);
  const hasErrors = errors != null && errors !== "" && Number.isFinite(errorCount);
  const hasWords = words != null && words !== "" && Number.isFinite(typedWords);
  const observations = [], actions = [];
  if (hasAccuracy && accuracy < 90) {
    observations.push("Accuracy is below 90%, so mistakes may be reducing your effective speed.");
    actions.push("Slow down slightly and prioritise correct keystrokes before increasing speed.");
  } else if (hasAccuracy && accuracy >= 97) {
    observations.push("Accuracy is strong; speed may be the next area to develop.");
    actions.push("Keep your current accuracy while gradually increasing your pace.");
  } else if (hasAccuracy) {
    observations.push("Accuracy is moderate; aim to make typing more consistent.");
    actions.push("Practise short passages at a controlled pace and review recurring mistakes.");
  }
  if (hasNet && hasGross && gross > 0) {
    const speedGap = gross - net;
    const gapPercent = speedGap / gross * 100;
    if (gapPercent >= 15) {
      observations.push("There is a notable gap between gross and net speed, suggesting errors are costing effective speed.");
      actions.push("Focus on error-prone words and avoid rushing through difficult phrases.");
    } else if (gapPercent < 7 && hasAccuracy && accuracy >= 90) {
      observations.push("Net speed is close to gross speed, indicating relatively efficient typing.");
      actions.push("Build speed in small increments without sacrificing accuracy.");
    }
  }
  if (hasErrors && errorCount > 0) {
    observations.push("The attempt recorded " + errorCount + " error(s).");
    actions.push("Review the weak-key/stroke table above, if available, and drill those patterns in focused repetitions.");
  } else if (hasErrors && errorCount === 0) {
    observations.push("No errors were recorded in the saved result.");
  }
  if (hasNet && net > 0) {
    observations.push("Recorded net speed: " + net + " WPM.");
    actions.push("Use timed practice rounds and compare net WPM across several attempts to confirm progress.");
  }
  if (hasWords && typedWords > 0 && duration !== "—" && Number(duration) > 0) {
    const expectedWordsPerMinute = typedWords / Number(duration);
    if (hasNet && expectedWordsPerMinute > net * 1.5) {
      observations.push("Words typed and net speed may use different counting rules; interpret them as separate indicators.");
    }
  }
  if (!observations.length) observations.push("There is not enough recorded performance data to identify a reliable reason for the result.");
  if (!actions.length) actions.push("Complete another timed mock with speed, accuracy and error tracking enabled, then compare the results.");
  const listItems = items => items.map(item => "<li>"+safe(item)+"</li>").join("");
  const analysisSection = '<section class="history-print-section history-print-analysis"><h2>4. PERFORMANCE ANALYSIS &amp; IMPROVEMENT PLAN</h2><div class="history-print-analysis-grid"><div class="history-print-analysis-card"><h3>WHY PROGRESS MAY BE LIMITED</h3><ul>'+listItems(observations)+'</ul></div><div class="history-print-analysis-card history-print-analysis-actions"><h3>WHAT TO IMPROVE NEXT</h3><ul>'+listItems(actions)+'</ul></div></div><p class="history-print-analysis-note">This guidance is based only on metrics saved for this attempt. It is a practice guide, not a diagnosis or a guarantee of exam performance.</p></section>';
  let view = document.getElementById("historyPrintResultView"); if (!view) { view = document.createElement("div"); view.id = "historyPrintResultView"; view.setAttribute("aria-hidden","true"); document.body.appendChild(view); }
  view.innerHTML = '<article class="history-print-sheet"><header class="history-print-brand"><a href="https://typeshala.vercel.app/" target="_blank" rel="noopener noreferrer" aria-label="Visit TypeShala website"><span class="history-print-brand-left"><img src="favicon.png" alt="" class="history-print-logo"><strong class="history-print-wordmark">TypeShala</strong></span></a></header><h1 class="history-print-title">TYPING PERFORMANCE REPORT</h1>'+
  '<section class="history-print-section"><h2>1. CANDIDATE &amp; EXAMINATION DETAILS</h2><table class="history-print-details"><tbody><tr><th>CANDIDATE NAME</th><td>'+safe(candidate)+'</td><th>TEST TYPE</th><td>'+safe(category)+'</td></tr><tr><th>TEST NAME</th><td>'+safe(r.mock_name || "Typing Mock Test")+'</td><th>TEST DATE &amp; TIME</th><td>'+safe(dateText)+'</td></tr><tr><th>DURATION</th><td>'+safe(duration)+' minutes</td><th>REPORT GENERATED ON</th><td>'+safe(generatedText)+'</td></tr></tbody></table></section>'+
  '<section class="history-print-section"><h2>2. PERFORMANCE SUMMARY</h2><div class="history-print-metrics"><div class="metric-speed"><span>NET SPEED</span><strong>'+num(r.net_wpm)+'</strong><small>WPM</small></div><div class="metric-accuracy"><span>ACCURACY</span><strong>'+(r.accuracy == null || r.accuracy === "" ? "—" : safe(r.accuracy)+"%")+'</strong><small>PRECISION</small></div><div class="metric-speed-secondary"><span>GROSS SPEED</span><strong>'+num(r.gross_wpm)+'</strong><small>WPM</small></div><div class="metric-errors"><span>TOTAL ERRORS</span><strong>'+num(errors)+'</strong><small>ERROR COUNT</small></div><div class="metric-words"><span>WORDS TYPED</span><strong>'+num(words)+'</strong><small>WORD COUNT</small></div><div class="metric-duration"><span>TEST RESULT</span><strong class="history-print-metric-result">'+(passed ? "PASSED" : "NOT PASSED")+'</strong><small>FINAL STATUS</small></div></div></section>'+weakSection+analysisSection+'<footer class="history-print-footer"><span>TypeShala · typeshala.vercel.app</span><span>Keep practising. Improve every attempt.</span></footer></article>';
  document.body.classList.add("printing-history-result"); let cleaned = false;
  const cleanup = () => { if (cleaned) return; cleaned = true; document.body.classList.remove("printing-history-result"); window.removeEventListener("afterprint",cleanup); };
  window.addEventListener("afterprint",cleanup,{once:true}); const logo = view.querySelector(".history-print-logo");
  const printNow = () => setTimeout(() => window.print(),120);
  if (logo && !logo.complete) { logo.addEventListener("load",printNow,{once:true}); logo.addEventListener("error",printNow,{once:true}); setTimeout(printNow,900); } else printNow();
  setTimeout(cleanup,30000);
}
