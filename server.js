/*
 * Team Attendance dashboard — deployable on Render.
 * -------------------------------------------------
 * No dependencies. Reads all secrets from environment variables so nothing
 * sensitive lives in the code you push to GitHub.
 *
 * Required env vars (set these in Render):
 *   DEVICE_HOST         e.g. 800storage90.mynetgear.com
 *   DEVICE_PORT         e.g. 50443
 *   DEVICE_USER         e.g. admin
 *   DEVICE_PASS         the device password
 *   DASHBOARD_PASSWORD  the password YOU pick for logging into this site
 *
 * Optional:
 *   SESSION_SECRET      long random string for signing logins (recommended)
 *   TZ_OFFSET           timezone offset for the day window (default +04:00)
 *   ENABLE_DOORS        "true" to expose door-unlock (default off)
 *   CAMERAS             JSON, e.g. [{"label":"Entrance","channel":"101"}]
 *   DOORS               JSON, e.g. [{"label":"Front","doorNo":1}]
 *   PORT                set automatically by Render
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const env = process.env;
function parseJSON(s, fallback) { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } }

const settings = {
  deviceHost: env.DEVICE_HOST || '',
  devicePort: Number(env.DEVICE_PORT || 50443),
  deviceUser: env.DEVICE_USER || 'admin',
  devicePass: env.DEVICE_PASS || '',
  tzOffset: env.TZ_OFFSET || '+04:00',
  maxTimeSeconds: Number(env.MAX_TIME_SECONDS || 30),
  dashboardPassword: env.DASHBOARD_PASSWORD || '',
  sessionSecret: env.SESSION_SECRET || crypto.randomBytes(24).toString('hex'),
  enableDoors: String(env.ENABLE_DOORS).toLowerCase() === 'true',
  cameras: parseJSON(env.CAMERAS, []),
  doors: parseJSON(env.DOORS, []),
  port: Number(env.PORT || 3000),
};

// Warn loudly (but don't crash) if the essentials are missing.
const missing = [];
if (!settings.deviceHost) missing.push('DEVICE_HOST');
if (!settings.devicePass) missing.push('DEVICE_PASS');
if (!settings.dashboardPassword) missing.push('DASHBOARD_PASSWORD');
if (missing.length) console.warn('WARNING — missing env vars: ' + missing.join(', '));

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const hmac = (s) => crypto.createHmac('sha256', settings.sessionSecret).update(String(s)).digest('hex');

// ---- login sessions (signed cookie, no dependencies) -----------------------

const SESSION_HOURS = 12;
function makeToken() {
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  return `${exp}.${hmac(exp)}`;
}
function validToken(tok) {
  if (!tok) return false;
  const i = tok.lastIndexOf('.');
  if (i < 0) return false;
  const exp = tok.slice(0, i), sig = tok.slice(i + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const good = hmac(exp);
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}
function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
function isAuthed(req) { return validToken(getCookie(req, 'session')); }
function safeEqual(a, b) {
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// ---- HTTP Digest auth to the device ----------------------------------------

function parseChallenge(header) {
  const h = header.replace(/^Digest\s+/i, '');
  const out = {}; const re = /(\w+)=(?:"([^"]*)"|([^,]+))/g; let m;
  while ((m = re.exec(h))) out[m[1]] = m[2] !== undefined ? m[2] : m[3].trim();
  return out;
}
function buildAuthHeader(ch, { username, password, method, uri }) {
  const nc = '00000001';
  const cnonce = crypto.randomBytes(8).toString('hex');
  const qop = ch.qop ? ch.qop.split(',')[0].trim() : undefined;
  const algorithm = ch.algorithm || 'MD5';
  let ha1 = md5(`${username}:${ch.realm}:${password}`);
  if (/sess/i.test(algorithm)) ha1 = md5(`${ha1}:${ch.nonce}:${cnonce}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = qop
    ? md5(`${ha1}:${ch.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${ch.nonce}:${ha2}`);
  let auth = `Digest username="${username}", realm="${ch.realm}", nonce="${ch.nonce}", uri="${uri}", response="${response}"`;
  if (ch.opaque) auth += `, opaque="${ch.opaque}"`;
  if (qop) auth += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  if (ch.algorithm) auth += `, algorithm=${ch.algorithm}`;
  return auth;
}
function rawRequest({ method, pathname, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: settings.deviceHost, port: settings.devicePort, path: pathname, method, headers,
      rejectUnauthorized: false, timeout: settings.maxTimeSeconds * 1000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Connection to device timed out')));
    if (body) req.write(body);
    req.end();
  });
}
async function digestRequest(method, pathname, bodyObj = null, accept = 'application/json') {
  const body = bodyObj ? Buffer.from(JSON.stringify(bodyObj)) : null;
  const headers = { Accept: accept };
  if (body) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = body.length; }
  let res = await rawRequest({ method, pathname, headers, body });
  if (res.statusCode === 401 && res.headers['www-authenticate']) {
    const ch = parseChallenge(res.headers['www-authenticate']);
    const auth = buildAuthHeader(ch, { username: settings.deviceUser, password: settings.devicePass, method, uri: pathname });
    res = await rawRequest({ method, pathname, headers: { ...headers, Authorization: auth }, body });
  }
  return res;
}

// ---- device operations -----------------------------------------------------

async function fetchAllEvents(date) {
  const tz = settings.tzOffset;
  const cond = {
    searchID: 'dashboard-' + Date.now(), searchResultPosition: 0, maxResults: 30,
    major: 0, minor: 0, startTime: `${date}T00:00:00${tz}`, endTime: `${date}T23:59:59${tz}`,
  };
  const all = []; let pages = 0;
  while (pages++ < 5000) {
    const res = await digestRequest('POST', '/ISAPI/AccessControl/AcsEvent?format=json', { AcsEventCond: cond });
    if (res.statusCode !== 200) throw new Error(`Device returned HTTP ${res.statusCode}: ${res.buffer.toString('utf8').slice(0, 200)}`);
    let data; try { data = JSON.parse(res.buffer.toString('utf8')); } catch { throw new Error('Device response was not valid JSON'); }
    const info = data.AcsEvent || {}; const list = info.InfoList || [];
    all.push(...list);
    const got = info.numOfMatches != null ? info.numOfMatches : list.length;
    cond.searchResultPosition += got;
    if ((info.responseStatusStrg || '').toUpperCase() !== 'MORE' || got === 0 || list.length === 0) break;
  }
  return all;
}
function normalize(ev) {
  return {
    time: ev.time || ev.dateTime || null,
    name: ev.name || ev.employeeName || '',
    employeeNo: ev.employeeNoString || (ev.employeeNo != null ? String(ev.employeeNo) : ''),
    cardNo: ev.cardNo || '', doorNo: ev.doorNo != null ? ev.doorNo : ev.doorNumber,
    major: ev.major, minor: ev.minor, attendanceStatus: ev.attendanceStatus || null,
  };
}

// ---- HTTP server -----------------------------------------------------------

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
function sendJSON(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s) });
  res.end(s);
}
async function readBody(req) {
  const chunks = []; for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString('utf8'); return s ? JSON.parse(s) : {};
}
function serveFile(res, file) {
  const full = path.join(__dirname, 'public', file);
  if (full.startsWith(path.join(__dirname, 'public')) && fs.existsSync(full) && fs.statSync(full).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res); return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const route = u.pathname;

  try {
    // ---- public routes (no login needed) ----
    if (route === '/login') { serveFile(res, 'login.html'); return; }

    if (route === '/api/login' && req.method === 'POST') {
      const { password } = await readBody(req);
      if (settings.dashboardPassword && safeEqual(password || '', settings.dashboardPassword)) {
        res.writeHead(200, {
          'Set-Cookie': `session=${encodeURIComponent(makeToken())}; HttpOnly; Path=/; SameSite=Lax; Secure; Max-Age=${SESSION_HOURS * 3600}`,
          'Content-Type': 'application/json',
        });
        return res.end('{"ok":true}');
      }
      return sendJSON(res, 401, { error: 'Wrong password' });
    }

    if (route === '/api/logout') {
      res.writeHead(302, { 'Set-Cookie': 'session=; HttpOnly; Path=/; Max-Age=0', Location: '/login' });
      return res.end();
    }

    // ---- everything below requires login ----
    if (!isAuthed(req)) {
      if (route.startsWith('/api/')) return sendJSON(res, 401, { error: 'Not logged in' });
      res.writeHead(302, { Location: '/login' }); return res.end();
    }

    if (route === '/api/health') {
      return sendJSON(res, 200, {
        host: settings.deviceHost, tzOffset: settings.tzOffset,
        cameras: settings.cameras, doors: settings.enableDoors ? settings.doors : [],
        doorsEnabled: settings.enableDoors,
      });
    }
    if (route === '/api/events') {
      const date = u.searchParams.get('date') || new Date().toISOString().slice(0, 10);
      const events = await fetchAllEvents(date);
      return sendJSON(res, 200, { date, count: events.length, events: events.map(normalize) });
    }
    if (route === '/api/snapshot') {
      const channel = u.searchParams.get('channel') || '101';
      const r = await digestRequest('GET', `/ISAPI/Streaming/channels/${channel}/picture`, null, 'image/jpeg');
      if (r.statusCode !== 200) return sendJSON(res, r.statusCode, { error: `Device returned HTTP ${r.statusCode}` });
      res.writeHead(200, { 'Content-Type': r.headers['content-type'] || 'image/jpeg', 'Cache-Control': 'no-store' });
      return res.end(r.buffer);
    }
    if (route === '/api/door' && req.method === 'POST') {
      if (!settings.enableDoors) return sendJSON(res, 403, { error: 'Door control is disabled' });
      const { doorNo, cmd } = await readBody(req);
      if (doorNo == null || !cmd) return sendJSON(res, 400, { error: 'doorNo and cmd are required' });
      const r = await digestRequest('PUT', `/ISAPI/AccessControl/RemoteControl/door/${doorNo}?format=json`, { RemoteControlDoor: { cmd } });
      return sendJSON(res, r.statusCode === 200 ? 200 : 502, { statusCode: r.statusCode, body: r.buffer.toString('utf8') });
    }

    // ---- static (dashboard) ----
    let file = route === '/' ? '/index.html' : route;
    file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
    if (serveFile(res, file)) return;
    sendJSON(res, 404, { error: 'Not found' });
  } catch (err) {
    sendJSON(res, 500, { error: err.message });
  }
});

server.listen(settings.port, () => {
  console.log(`Attendance dashboard listening on port ${settings.port}`);
  console.log(`Device: ${settings.deviceHost || '(DEVICE_HOST not set)'}:${settings.devicePort}`);
  console.log(`Door control: ${settings.enableDoors ? 'ENABLED' : 'disabled'}`);
});
