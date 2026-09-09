'use strict';
const https = require('https');
const crypto = require('crypto');
const settings = require('./config');

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

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

function rawRequest(branch, { method, pathname, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: branch.host, port: branch.port, path: pathname, method, headers,
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

async function digestRequest(branch, method, pathname, bodyObj = null, accept = 'application/json') {
  const body = bodyObj ? Buffer.from(JSON.stringify(bodyObj)) : null;
  const headers = { Accept: accept };
  if (body) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = body.length; }
  let res = await rawRequest(branch, { method, pathname, headers, body });
  if (res.statusCode === 401 && res.headers['www-authenticate']) {
    const ch = parseChallenge(res.headers['www-authenticate']);
    const auth = buildAuthHeader(ch, { username: branch.user, password: branch.pass, method, uri: pathname });
    res = await rawRequest(branch, { method, pathname, headers: { ...headers, Authorization: auth }, body });
  }
  return res;
}

function normalize(ev) {
  return {
    time: ev.time || ev.dateTime || null,
    name: ev.name || ev.employeeName || '',
    employeeNo: ev.employeeNoString || (ev.employeeNo != null ? String(ev.employeeNo) : ''),
    cardNo: ev.cardNo || '',
    doorNo: ev.doorNo != null ? ev.doorNo : ev.doorNumber,
    major: ev.major, minor: ev.minor,
    attendanceStatus: ev.attendanceStatus || null,
  };
}

// --- per (branch, date) event cache -----------------------------------------
// Past days never change, so cache them long. Today changes, so short TTL.
const cache = new Map(); // key -> { events, ts }
const TODAY_TTL = 45 * 1000;

function todayInTz(tzOffset) {
  // crude: apply the offset to now, take the date portion
  const sign = tzOffset[0] === '-' ? -1 : 1;
  const [h, m] = tzOffset.slice(1).split(':').map(Number);
  const shifted = new Date(Date.now() + sign * ((h * 60 + m) * 60000));
  return shifted.toISOString().slice(0, 10);
}

async function getEventsForDay(branch, date) {
  const key = `${branch.id}|${date}`;
  const isToday = date === todayInTz(branch.tzOffset);
  const hit = cache.get(key);
  if (hit && (!isToday || Date.now() - hit.ts < TODAY_TTL)) return hit.events;

  const tz = branch.tzOffset;
  const cond = {
    searchID: 'wms-' + Date.now(), searchResultPosition: 0, maxResults: settings.pageSize,
    major: 0, minor: 0, startTime: `${date}T00:00:00${tz}`, endTime: `${date}T23:59:59${tz}`,
  };
  const all = []; let pages = 0;
  while (pages++ < 10000) {
    const res = await digestRequest(branch, 'POST', '/ISAPI/AccessControl/AcsEvent?format=json', { AcsEventCond: cond });
    if (res.statusCode !== 200) throw new Error(`Device HTTP ${res.statusCode}: ${res.buffer.toString('utf8').slice(0, 160)}`);
    let data; try { data = JSON.parse(res.buffer.toString('utf8')); } catch { throw new Error('Device response was not valid JSON'); }
    const info = data.AcsEvent || {}; const list = info.InfoList || [];
    all.push(...list.map(normalize));
    const got = info.numOfMatches != null ? info.numOfMatches : list.length;
    cond.searchResultPosition += got;
    if ((info.responseStatusStrg || '').toUpperCase() !== 'MORE' || got === 0 || list.length === 0) break;
  }
  cache.set(key, { events: all, ts: Date.now() });
  return all;
}

async function snapshot(branch, channel) {
  return digestRequest(branch, 'GET', `/ISAPI/Streaming/channels/${channel}/picture`, null, 'image/jpeg');
}

async function controlDoor(branch, doorNo, cmd) {
  return digestRequest(branch, 'PUT', `/ISAPI/AccessControl/RemoteControl/door/${doorNo}?format=json`, { RemoteControlDoor: { cmd } });
}

module.exports = { getEventsForDay, snapshot, controlDoor, todayInTz };
