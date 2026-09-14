'use strict';
const $ = id => document.getElementById(id);
let token = '', ready = false;
const labels = {safe: 'Reachable', risky: 'Risky', invalid: 'Invalid', unknown: 'Inconclusive'};
function boolean(value, yes, no) { return value === true ? yes : value === false ? no : 'Not confirmed'; }
function render(data) {
  const status = Object.hasOwn(labels, data.status) ? data.status : 'unknown';
  $('result-email').textContent = data.email;
  $('verdict').textContent = labels[status];
  $('verdict').className = `badge ${status}`;
  $('reason').textContent = data.reason;
  $('timing').textContent = data.elapsed != null ? `${data.elapsed}s` : '';
  const d = data.details || {}, syntax = d.syntax || {}, mx = d.mx || {}, smtp = d.smtp || {}, misc = d.misc || {};
  const rows = [
    ['Address format', boolean(syntax.is_valid_syntax, 'Valid', 'Invalid')],
    ['Domain accepts mail', boolean(mx.accepts_mail, 'Yes', 'No')],
    ['Mail server connection', boolean(smtp.can_connect_smtp, 'Connected', 'Not connected')],
    ['Mailbox deliverability', boolean(smtp.is_deliverable, 'Reported deliverable', 'Not deliverable')],
    ['Accepts any address', boolean(smtp.is_catch_all, 'Yes · catch-all', 'No')],
    ['Disposable address', boolean(misc.is_disposable, 'Yes', 'No')]
  ];
  $('checks').replaceChildren(...rows.map(([label, value]) => {
    const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = label; dd.textContent = value; row.append(dt, dd); return row;
  }));
  $('raw').textContent = JSON.stringify(data.details, null, 2);
  $('raw-details').hidden = !data.details;
  $('raw-details').open = false;
  $('result').hidden = false;
}
async function readResponse(response) {
  const type = response.headers.get('Content-Type') || '';
  if (!type.includes('application/json')) {
    throw new Error(`The forwarded app returned HTTP ${response.status}. Open port 8765 in a new browser tab and sign in to GitHub if prompted.`);
  }
  return response.json();
}
async function refreshSession() {
  const response = await fetch('/api/status', {cache: 'no-store', credentials: 'same-origin'});
  const data = await readResponse(response);
  if (!response.ok) throw new Error(data.error || 'Could not reconnect to the app.');
  token = data.token;
  return data;
}
async function submitCheck(email) {
  // Refresh before every check so a server restart cannot leave this tab stuck.
  await refreshSession();
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch('/api/check', {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json', 'X-Mailcheck-Token': token}, body: JSON.stringify({email})});
    const data = await readResponse(response);
    if (response.status === 403 && data.code === 'session_expired' && attempt === 0) {
      await refreshSession();
      continue;
    }
    if (!response.ok) throw new Error(data.error || `The check failed (HTTP ${response.status}).`);
    return data;
  }
}
async function boot() {
  try {
    const data = await refreshSession();
    token = data.token; ready = data.ready;
    if (data.codespaces) {
      $('runtime-label').textContent = 'Runs in your Codespace';
      document.querySelector('.local').textContent = 'CODESPACE';
    }
    $('engine').textContent = ready ? 'Reacher ready' : 'Reacher needs installation';
    $('engine').className = `engine ${ready ? 'ready' : 'missing'}`;
    $('check-button').disabled = !ready;
    if (!ready) { $('error').textContent = 'Run python3 setup_reacher.py in the app folder, then refresh this page. Windows users: use Start-Windows.bat. See README.md for setup.'; $('error').hidden = false; }
  } catch {
    $('engine').textContent = 'App server unavailable';
    $('error').textContent = 'Start the app with python3 app.py and open http://127.0.0.1:8765. Keep the terminal window open.';
    $('error').hidden = false;
  }
}
$('check-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!ready || $('check-button').disabled) return;
  const email = $('email').value.trim();
  $('error').hidden = true;
  if (!email || !$('email').checkValidity()) {
    $('error').textContent = 'Enter one email address, such as name@company.com.';
    $('error').hidden = false; $('email').focus(); return;
  }
  $('empty').hidden = true; $('result').hidden = true; $('loading').hidden = false;
  $('timing').textContent = ''; $('check-button').disabled = true; $('email').readOnly = true;
  document.querySelector('.result-panel').setAttribute('aria-busy', 'true');
  try {
    render(await submitCheck(email));
  } catch (error) {
    $('error').textContent = error.message === 'Failed to fetch' ? 'The local app disconnected. Restart it and refresh this page.' : error.message;
    $('error').hidden = false; $('empty').hidden = false;
  } finally {
    $('loading').hidden = true; $('check-button').disabled = false; $('email').readOnly = false;
    document.querySelector('.result-panel').setAttribute('aria-busy', 'false');
  }
});
boot();
