'use strict';
const $ = (s, r = document) => r.querySelector(s);
const state = { branch: null, view: 'live', config: null, camTimer: null };

// ---------- helpers ----------
async function api(path) {
  const r = await fetch(path);
  if (r.status === 401) { location.href = '/login'; throw new Error('unauth'); }
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}
async function apiPut(path, body) {
  const r = await fetch(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (r.status === 401) { location.href = '/login'; throw new Error('unauth'); }
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Save failed');
  return d;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function hhmm(iso) { if (!iso) return null; const d = new Date(iso); return d.toTimeString().slice(0, 5); }
function fmtDur(ms) { if (!ms || ms <= 0) return '0h'; const m = Math.round(ms / 60000), h = Math.floor(m / 60); return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`; }
function fmtMins(min) { if (!min) return ''; const h = Math.floor(min / 60), m = min % 60; return h ? `${h}h ${m}m` : `${m}m`; }
function todayLocal() { const d = new Date(); const off = d.getTimezoneOffset(); return new Date(d - off * 60000).toISOString().slice(0, 10); }
function monthLocal() { return todayLocal().slice(0, 7); }
const b = () => `branch=${encodeURIComponent(state.branch)}`;

function setConn(ok, msg) { $('#conn').textContent = ok ? `Connected · ${new Date().toTimeString().slice(0, 5)}` : (msg || 'Offline'); $('#conn').style.color = ok ? 'var(--color-success)' : 'var(--color-danger)'; }
function errBox(msg) { return `<div class="panel"><div class="err"><h3>Can't reach the device</h3><p class="note-inline">${esc(msg)}</p><p class="note-inline">Check the branch is online and reachable at its configured address.</p></div></div>`; }

// ---------- OVERVIEW (command centre) ----------
async function renderOverview() {
  const root = $('#view-overview');
  root.innerHTML = `<div class="hero"><div class="eyebrow">Command centre</div><div class="status-line"><h2>Loading…</h2></div></div>`;
  try {
    const d = await api('/api/overview');
    const openTxt = `${d.branchesOpen} of ${d.branchesTotal} ${d.branchesTotal === 1 ? 'branch' : 'branches'} open`;
    const totalAlerts = d.branches.reduce((s, x) => s + x.alerts, 0);
    root.innerHTML = `
      <div class="hero">
        <div class="eyebrow">Command centre</div>
        <div class="status-line"><h2>${d.staffOnSite} on site now</h2></div>
        <div class="sub">${openTxt} · live across all branches</div>
        <div class="hero-stats">
          <div><div class="hs-k">Branches open</div><div class="hs-v">${d.branchesOpen}/${d.branchesTotal}</div></div>
          <div><div class="hs-k">Staff on site</div><div class="hs-v">${d.staffOnSite}</div></div>
          <div><div class="hs-k">Open alerts</div><div class="hs-v">${totalAlerts}</div></div>
        </div>
      </div>
      <div class="eyebrow" style="margin-bottom:12px">Branches</div>
      <div class="branch-grid">${d.branches.map(branchCard).join('')}</div>`;
    root.querySelectorAll('.branch-card').forEach((c) => c.addEventListener('click', () => {
      state.branch = c.dataset.id;
      $('#branch').value = c.dataset.id;
      $('#page-ctx').textContent = c.dataset.name;
      go('live');
    }));
  } catch (e) { if (e.message !== 'unauth') root.innerHTML = errBox(e.message); }
}
function branchCard(x) {
  const cls = !x.ok ? 'err' : (x.open ? 'open' : (x.alerts ? 'alert' : ''));
  const status = !x.ok
    ? `<span class="status-pill closed"><span class="d"></span>Offline</span>`
    : (x.open ? `<span class="status-pill open"><span class="d"></span>Open</span>` : `<span class="status-pill closed"><span class="d"></span>Closed</span>`);
  return `<button class="branch-card ${cls}" data-id="${esc(x.id)}" data-name="${esc(x.name)}">
    <div class="top"><div class="bname">${esc(x.name)}</div>${status}</div>
    <div class="metrics">
      <div class="m"><div class="k">On site</div><div class="v">${x.onSite}</div></div>
      <div class="m"><div class="k">Today</div><div class="v">${x.peopleToday}</div></div>
      <div class="m"><div class="k">Alerts</div><div class="v">${x.alerts}</div></div>
    </div></button>`;
}

// ---------- LIVE ----------
async function renderLive() {
  const root = $('#view-live');
  root.innerHTML = `<div class="hero"><div class="eyebrow">Live status</div><div class="status-line"><h2>Loading…</h2></div></div>`;
  try {
    const d = await api(`/api/live?${b()}`);
    setConn(true);
    setBranchStatus(d.open);
    const onSite = d.people.filter((p) => p.onSite);
    let html = `<div class="hero ${d.open ? '' : 'closed'}">
      <div class="eyebrow">${esc(currentBranchName())} · live status</div>
      <div class="status-line">
        <h2>${d.open ? 'Open' : 'Closed'}</h2>
        <span class="pill-on-hero"><span class="d"></span>${d.onSite} on site</span>
      </div>
      <div class="sub">${d.open ? `${d.onSite} ${d.onSite === 1 ? 'person is' : 'people are'} on site right now` : 'Nobody is on site right now'}</div>
      <div class="hero-stats">
        <div><div class="hs-k">People today</div><div class="hs-v">${d.peopleToday}</div></div>
        <div><div class="hs-k">Punches today</div><div class="hs-v">${d.punches}</div></div>
        <div><div class="hs-k">Alerts today</div><div class="hs-v">${d.alerts.length}</div></div>
      </div>
    </div>`;

    html += `<div class="panel"><div class="head"><h2>On site now</h2><span class="sub">${onSite.length} present</span></div>`;
    if (!onSite.length) html += `<div class="empty"><h3>Nobody on site</h3><p>Punches will appear here as employees badge in.</p></div>`;
    else {
      html += `<table><thead><tr><th>Employee</th><th>Since</th><th>On site</th><th>Status</th></tr></thead><tbody>`;
      for (const p of onSite) html += `<tr><td class="emp"><div class="name">${esc(p.name)}</div><div class="id mono">${esc(p.id)}</div></td>
        <td class="num">${p.firstIn || "—"}</td><td class="num">${fmtDur(p.totalMs)}</td>
        <td>${p.late ? `<span class="badge late"><span class="dot"></span>Late ${fmtMins(p.lateBy)}</span>` : `<span class="badge on"><span class="dot"></span>On time</span>`}</td></tr>`;
      html += `</tbody></table>`;
    }
    html += `</div>`;

    html += `<div class="panel"><div class="head"><h2>Today's alerts</h2><span class="sub">${d.alerts.length}</span></div>`;
    if (!d.alerts.length) html += `<div class="empty"><h3>No alerts</h3><p>Late arrivals and early exits will show up here.</p></div>`;
    else for (const a of d.alerts) {
      const late = a.type === 'late';
      html += `<div class="alert-row"><div class="ico ${late ? 'late' : 'early'}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg></div>
        <div><span class="who">${esc(a.name)}</span> ${late ? `arrived ${fmtMins(a.minutes)} late` : `left ${fmtMins(a.minutes)} early`} <span class="note-inline">· ${a.at}</span></div></div>`;
    }
    html += `</div>`;
    root.innerHTML = html;
  } catch (e) { if (e.message !== 'unauth') { setConn(false, 'Connection error'); root.innerHTML = errBox(e.message); } }
}

// ---------- HISTORY ----------
async function renderHistory() {
  const root = $('#view-history');
  if (!root.dataset.init) {
    root.innerHTML = `<div class="row-controls"><label class="field">Day<input type="date" id="hist-date" value="${todayLocal()}" max="${todayLocal()}"></label></div><div id="hist-body"></div>`;
    root.dataset.init = '1';
    $('#hist-date').addEventListener('change', loadHistory);
  }
  loadHistory();
}
async function loadHistory() {
  const date = $('#hist-date').value || todayLocal();
  const body = $('#hist-body'); body.innerHTML = `<div class="panel"><div class="empty">Loading…</div></div>`;
  try {
    const d = await api(`/api/history?${b()}&date=${date}`);
    if (!d.people.length) { body.innerHTML = `<div class="panel"><div class="empty"><h3>No punches for this day</h3><p>Pick another day, or check the branch was open.</p></div></div>`; return; }
    let html = `<div class="panel"><div class="head"><h2>${date}</h2><span class="sub">${d.people.length} people · ${d.count} punches</span></div>
      <table><thead><tr><th>Employee</th><th>Status</th><th>Arrived</th><th>Last out</th><th>Hours</th><th>Flags</th><th></th></tr></thead><tbody>`;
    d.people.forEach((p, i) => {
      const status = p.onSite ? `<span class="badge on"><span class="dot"></span>On site</span>` : `<span class="badge off"><span class="dot"></span>Off site</span>`;
      const flags = [p.late ? `<span class="badge late">Late ${fmtMins(p.lateBy)}</span>` : '', p.leftEarly ? `<span class="badge early">Early ${fmtMins(p.earlyBy)}</span>` : ''].filter(Boolean).join(' ') || '<span class="note-inline">—</span>';
      html += `<tr class="clickable" data-i="${i}"><td class="emp"><div class="name">${esc(p.name)}</div><div class="id mono">${esc(p.id)}</div></td>
        <td>${status}</td><td class="num">${p.firstIn || "—"}</td><td class="num">${p.lastOut || "—"}</td><td class="num">${fmtDur(p.totalMs)}</td><td>${flags}</td>
        <td><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></td></tr>
        <tr class="detail" data-d="${i}" style="display:none"><td colspan="7"><div class="punch-seq">${p.punches.map((k) => `<span class="punch"><span class="tag ${k.dir}">${k.dir.toUpperCase()}</span><span class="mono">${k.clock}</span></span>`).join('')}</div></td></tr>`;
    });
    html += `</tbody></table></div>`;
    body.innerHTML = html;
    body.querySelectorAll('tr.clickable').forEach((tr) => tr.addEventListener('click', () => {
      const det = body.querySelector(`tr.detail[data-d="${tr.dataset.i}"]`);
      det.style.display = det.style.display === 'none' ? 'table-row' : 'none';
    }));
  } catch (e) { if (e.message !== 'unauth') body.innerHTML = errBox(e.message); }
}

// ---------- EMPLOYEES (metrics) ----------
async function renderEmployees() {
  const root = $('#view-employees');
  if (!root.dataset.init) {
    root.innerHTML = `<div class="row-controls"><label class="field">Month<input type="month" id="emp-month" value="${monthLocal()}" max="${monthLocal()}"></label>
      <span class="note-inline">First load fetches the month from the device and can take a moment.</span></div><div id="emp-body"></div>`;
    root.dataset.init = '1';
    $('#emp-month').addEventListener('change', loadEmployees);
  }
  loadEmployees();
}
async function loadEmployees() {
  const month = $('#emp-month').value || monthLocal();
  const body = $('#emp-body'); body.innerHTML = `<div class="panel"><div class="empty">Building metrics for ${month}…</div></div>`;
  try {
    const d = await api(`/api/metrics?${b()}&month=${month}`);
    if (!d.employees.length) { body.innerHTML = `<div class="panel"><div class="empty"><h3>No data for ${esc(month)}</h3><p>Pick another month.</p></div></div>`; return; }
    let html = `<div class="panel"><div class="head"><h2>Per-employee metrics</h2><span class="sub">${month} · ${d.employees.length} employees</span></div>
      <table><thead><tr><th>Employee</th><th>Days present</th><th>Avg in</th><th>Avg out</th><th>Avg hrs/day</th><th>Times late</th><th>Left early</th></tr></thead><tbody>`;
    for (const e of d.employees) {
      html += `<tr><td class="emp"><div class="name">${esc(e.name)}</div><div class="id mono">${esc(e.id)}</div></td>
        <td class="num">${e.daysPresent}</td><td class="num">${e.avgIn || '—'}</td><td class="num">${e.avgOut || '—'}</td><td class="num">${e.avgHours}h</td>
        <td>${e.lateCount ? `<span class="badge late">${e.lateCount}</span>` : `<span class="note-inline">0</span>`}</td>
        <td>${e.earlyLeaveCount ? `<span class="badge early">${e.earlyLeaveCount}</span>` : `<span class="note-inline">0</span>`}</td></tr>`;
    }
    html += `</tbody></table></div>`;
    body.innerHTML = html;
  } catch (e) { if (e.message !== 'unauth') body.innerHTML = errBox(e.message); }
}

// ---------- CAMERAS ----------
async function renderCameras() {
  const root = $('#view-cameras');
  root.innerHTML = `<div class="panel"><div class="empty">Finding cameras on this branch…</div></div>`;
  let cams = [];
  try {
    const d = await api(`/api/cameras?${b()}`);
    cams = d.cameras || [];
  } catch (e) { if (e.message === 'unauth') return; root.innerHTML = errBox(e.message); return; }

  if (!cams.length) {
    root.innerHTML = `<div class="panel"><div class="empty"><h3>No cameras found on this branch's device</h3>
      <p>The device didn't return any camera channels. If your CCTV is on a separate recorder, point this branch's camera source at it, and the cameras will list here automatically.</p></div></div>`;
    return;
  }
  root.innerHTML = `<div class="row-controls"><span class="note-inline">${cams.length} camera${cams.length > 1 ? 's' : ''} · refreshing live</span></div>
    <div class="cam-grid">${cams.map((c) => `<div class="cam"><div class="frame" data-ch="${esc(c.channel)}"><span>Loading…</span></div>
    <div class="bar"><b>${esc(c.label)}</b><span class="live"><span class="dot"></span>Live</span></div></div>`).join('')}</div>`;
  refreshCams();
  clearInterval(state.camTimer);
  state.camTimer = setInterval(() => { if (state.view === 'cameras') refreshCams(); }, 3000);
}
function refreshCams() {
  document.querySelectorAll('#view-cameras .frame').forEach((f) => {
    const img = new Image();
    img.onload = () => { f.innerHTML = ''; f.appendChild(img); };
    img.onerror = () => { if (!f.querySelector('img')) f.innerHTML = `<span>No image · check channel ${esc(f.dataset.ch)}</span>`; };
    img.src = `/api/snapshot?${b()}&channel=${encodeURIComponent(f.dataset.ch)}&t=${Date.now()}`;
  });
}

// ---------- SETTINGS ----------
async function renderSettings() {
  const root = $('#view-settings');
  root.innerHTML = `<div class="panel"><div class="empty">Loading settings…</div></div>`;
  try {
    const [sched, notif] = await Promise.all([api(`/api/schedules?${b()}`), api('/api/notifications')]);
    root.innerHTML = `
      <div class="panel"><div class="head"><h2>Working hours</h2><span class="sub">Used to flag late arrivals and early exits</span></div>
        <div style="padding: var(--space-6)">
          <div class="eyebrow" style="margin-bottom:8px">Default (everyone)</div>
          <div class="grid-2" style="max-width:520px">
            <label class="field">Start<input type="time" id="def-start" value="${sched.default.start}"></label>
            <label class="field">End<input type="time" id="def-end" value="${sched.default.end}"></label>
          </div>
          <label class="field" style="max-width:250px;margin-top:var(--space-4)">Grace period (minutes)<input type="number" id="def-grace" min="0" value="${sched.default.graceMinutes}"><span class="hint">Minutes after start before someone counts as late</span></label>

          <div class="eyebrow" style="margin:var(--space-8) 0 8px">Per-employee overrides</div>
          <div class="sched-row"><span class="eyebrow">Employee ID</span><span class="eyebrow">Start</span><span class="eyebrow">End</span><span class="eyebrow">Grace</span><span></span></div>
          <div id="ovr-rows"></div>
          <button class="btn" id="add-ovr" style="margin-top:var(--space-2)">+ Add employee</button>
          <div style="margin-top:var(--space-6)"><button class="btn primary" id="save-sched">Save hours</button> <span class="note-inline" id="sched-msg"></span></div>
        </div>
      </div>

      <div class="panel"><div class="head"><h2>Notifications</h2><span class="sub">Choose what you get told about</span></div>
        <div style="padding: var(--space-6); display:flex; flex-direction:column; gap:var(--space-4); max-width:560px">
          <label class="toggle"><input type="checkbox" id="n-late" ${notif.lateArrival ? 'checked' : ''}> Employee arrives late</label>
          <label class="toggle"><input type="checkbox" id="n-early" ${notif.earlyLeave ? 'checked' : ''}> Employee leaves early</label>
          <label class="toggle"><input type="checkbox" id="n-absent" ${notif.absence ? 'checked' : ''}> Employee is absent (no punch by start)</label>
          <div class="grid-2" style="margin-top:var(--space-2)">
            <label class="field">Send to (channel)<select id="n-channel">
              <option value="whatsapp" ${notif.manager.channel === 'whatsapp' ? 'selected' : ''}>WhatsApp</option>
              <option value="sms" ${notif.manager.channel === 'sms' ? 'selected' : ''}>SMS</option>
              <option value="email" ${notif.manager.channel === 'email' ? 'selected' : ''}>Email</option>
            </select></label>
            <label class="field">Your contact<input type="text" id="n-to" value="${esc(notif.manager.to)}" placeholder="e.g. +9715…"></label>
          </div>
          <p class="note-inline">Detection runs now and shows on the Live tab. Actual sending gets switched on when we connect Respond and message templates.</p>
          <div><button class="btn primary" id="save-notif">Save notifications</button> <span class="note-inline" id="notif-msg"></span></div>
        </div>
      </div>`;

    const ovr = $('#ovr-rows');
    const addRow = (id = '', s = '', e = '', g = '') => {
      const div = document.createElement('div'); div.className = 'sched-row';
      div.innerHTML = `<input placeholder="1001" value="${esc(id)}"><input type="time" value="${s}"><input type="time" value="${e}"><input type="number" min="0" placeholder="${sched.default.graceMinutes}" value="${g}">
        <button class="btn" title="Remove">×</button>`;
      div.querySelector('button').addEventListener('click', () => div.remove());
      ovr.appendChild(div);
    };
    Object.entries(sched.byEmployee || {}).forEach(([id, v]) => addRow(id, v.start || '', v.end || '', v.graceMinutes ?? ''));
    $('#add-ovr').addEventListener('click', () => addRow());

    $('#save-sched').addEventListener('click', async () => {
      const byEmployee = {};
      ovr.querySelectorAll('.sched-row').forEach((r) => {
        const [id, s, e, g] = [...r.querySelectorAll('input')].map((i) => i.value.trim());
        if (id) byEmployee[id] = { start: s || sched.default.start, end: e || sched.default.end, graceMinutes: Number(g || sched.default.graceMinutes) };
      });
      const payload = { default: { start: $('#def-start').value, end: $('#def-end').value, graceMinutes: Number($('#def-grace').value) }, byEmployee };
      try { await apiPut(`/api/schedules?${b()}`, payload); $('#sched-msg').textContent = 'Saved'; $('#sched-msg').style.color = 'var(--color-success)'; }
      catch (err) { $('#sched-msg').textContent = err.message; $('#sched-msg').style.color = 'var(--color-danger)'; }
    });

    $('#save-notif').addEventListener('click', async () => {
      const payload = { lateArrival: $('#n-late').checked, earlyLeave: $('#n-early').checked, absence: $('#n-absent').checked, manager: { channel: $('#n-channel').value, to: $('#n-to').value.trim() } };
      try { await apiPut('/api/notifications', payload); $('#notif-msg').textContent = 'Saved'; $('#notif-msg').style.color = 'var(--color-success)'; }
      catch (err) { $('#notif-msg').textContent = err.message; $('#notif-msg').style.color = 'var(--color-danger)'; }
    });
  } catch (e) { if (e.message !== 'unauth') root.innerHTML = errBox(e.message); }
}

// ---------- helpers for status + clock ----------
function currentBranchName() {
  const br = (state.config?.branches || []).find((x) => x.id === state.branch);
  return br ? br.name : '';
}
function setBranchStatus(open) {
  const pill = $('#branch-status');
  pill.style.display = 'inline-flex';
  pill.className = 'status-pill ' + (open ? 'open' : 'closed');
  $('#branch-status-text').textContent = open ? 'Open' : 'Closed';
}
function tickClock() {
  // Gulf Standard Time (UTC+4), independent of the viewer's device clock
  const now = new Date();
  const gst = new Date(now.getTime() + (now.getTimezoneOffset() + 240) * 60000);
  $('#clock').textContent = gst.toTimeString().slice(0, 8);
}
setInterval(tickClock, 1000); tickClock();

// ---------- routing ----------
const TITLES = { overview: 'Overview', live: 'Live', history: 'History', employees: 'Employees', cameras: 'Cameras', settings: 'Settings' };
const RENDER = { overview: renderOverview, live: renderLive, history: renderHistory, employees: renderEmployees, cameras: renderCameras, settings: renderSettings };
// Views that are about one branch show the Open/Closed pill; company-wide/config views don't.
const BRANCH_VIEWS = new Set(['live', 'history', 'employees', 'cameras']);
function go(view) {
  state.view = view;
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  $('#view-' + view).classList.add('active');
  $('#page-title').textContent = TITLES[view];
  $('#branch-status').style.display = 'none'; // renderLive re-shows it with real state
  if (view !== 'cameras') clearInterval(state.camTimer);
  RENDER[view]();
}

document.querySelectorAll('.nav a').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); go(a.dataset.view); }));
$('#refresh').addEventListener('click', () => { $('#reficon').classList.add('spin'); RENDER[state.view](); setTimeout(() => $('#reficon').classList.remove('spin'), 500); });
$('#branch').addEventListener('change', (e) => { state.branch = e.target.value; $('#page-ctx').textContent = e.target.selectedOptions[0].text; RENDER[state.view](); });

(async function init() {
  try {
    state.config = await api('/api/config');
    const sel = $('#branch');
    sel.innerHTML = state.config.branches.map((br) => `<option value="${esc(br.id)}">${esc(br.name)}</option>`).join('');
    state.branch = state.config.branches[0]?.id;
    $('#page-ctx').textContent = state.config.branches[0]?.name || '';
    go('overview');
  } catch (e) { if (e.message !== 'unauth') $('#view-overview').innerHTML = errBox(e.message); }
})();
