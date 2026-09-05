let rtUser = null;
let rtResult = null;
let rtSelectedDuration = 5;

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}

function formatLastAttempt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: '—', time: '—' };
  return {
    date: date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    time: date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  };
}

function selectDuration(duration) {
  rtSelectedDuration = duration;
  $('rtFive').classList.toggle('selected', duration === 5);
  $('rtTen').classList.toggle('selected', duration === 10);
  $('rtFive').setAttribute('aria-pressed', duration === 5 ? 'true' : 'false');
  $('rtTen').setAttribute('aria-pressed', duration === 10 ? 'true' : 'false');
}

function showError(message) {
  const el = $('rtError');
  el.hidden = false;
  el.textContent = message;
}

async function loadReattempt() {
  rtUser = await requireLogin();
  if (!rtUser) return;

  const params = new URLSearchParams(window.location.search);
  const resultId = params.get('result');
  const mockTestId = params.get('mock_test_id');

  if (!resultId && !mockTestId) {
    showError('This re-attempt link is not valid.');
    $('rtStartBtn').disabled = true;
    return;
  }

  let query = supabaseClient.from('mock_test_results').select('*').eq('user_id', rtUser.id).limit(1);
  query = resultId ? query.eq('id', resultId) : query.eq('mock_test_id', mockTestId).order('created_at', { ascending: false });
  const { data, error } = await query;

  if (error || !data || !data.length) {
    console.error('Could not load re-attempt result:', error);
    showError('Could not load this re-attempt. Please return to Recent Test History and try again.');
    $('rtStartBtn').disabled = true;
    return;
  }

  rtResult = data[0];
  const category = String(rtResult.category || '—').toUpperCase();
  $('rtCategory').textContent = category;
  const attemptTime = formatLastAttempt(rtResult.created_at);
  $('rtLastAttemptDate').textContent = attemptTime.date;
  $('rtLastAttemptTime').textContent = attemptTime.time;

  const passed = !!rtResult.is_passed;
  $('rtResult').textContent = passed ? 'Passed' : 'Not Passed';
  $('rtResult').className = passed ? 'rt-result-passed' : 'rt-result-failed';
  $('rtSpeed').textContent = `${Number(rtResult.gross_wpm ?? rtResult.net_wpm ?? 0)} WPM`;
  $('rtWords').textContent = `(${Number(rtResult.words_typed ?? rtResult.total_words ?? 0)} words)`;

  // A re-attempt is only offered by the history page while its server-side
  // window is open. We still keep the RPC authoritative when Start is clicked.
}

async function startReattempt() {
  if (!rtResult || !rtResult.mock_test_id) return;

  const btn = $('rtStartBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span>Starting…</span>';
  $('rtError').hidden = true;

  try {
    const { data, error } = await supabaseClient.rpc('start_reattempt', {
      p_mock_test_id: rtResult.mock_test_id,
      p_duration: rtSelectedDuration
    });

    if (error) {
      console.error('start_reattempt RPC error:', error);
      showError('Something went wrong starting the re-attempt. Please try again.');
      return;
    }

    const result = Array.isArray(data) ? data[0] : data;
    if (!result || !result.session_id) {
      const messages = {
        NOT_YET_ATTEMPTED: 'This mock has not been completed yet, so there is nothing to re-attempt.',
        REATTEMPT_WINDOW_EXPIRED: 'This re-attempt is no longer available.',
        LOCKED: 'This re-attempt is no longer available.',
        ACTIVE_SESSION_EXISTS: 'Complete the current test before starting a re-attempt.'
      };
      showError(messages[result?.access_reason] || 'Could not start the re-attempt. Please try again.');
      return;
    }

    const target = `mock-test-attempt.html?session=${encodeURIComponent(result.session_id)}&duration=${encodeURIComponent(rtSelectedDuration)}${result.is_resumed ? '&resume=1' : ''}`;
    window.location.href = target;
  } catch (err) {
    console.error('startReattempt failed:', err);
    showError('Something went wrong starting the re-attempt. Please try again.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  $('rtFive').addEventListener('click', () => selectDuration(5));
  $('rtTen').addEventListener('click', () => selectDuration(10));
  $('rtStartBtn').addEventListener('click', startReattempt);
  await loadReattempt();
});
