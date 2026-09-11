'use strict';
const crypto = require('crypto');

function parseJSON(s, fallback) { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } }

const env = process.env;

// Branches: either a JSON list in BRANCHES, or a single branch from DEVICE_* vars.
function loadBranches() {
  const list = parseJSON(env.BRANCHES, null);
  if (Array.isArray(list) && list.length) {
    return list.map((b, i) => normaliseBranch(b, i));
  }
  // Fallback: one branch from the simple DEVICE_* variables.
  return [normaliseBranch({
    id: 'main',
    name: env.BRANCH_NAME || 'Main branch',
    city: env.CITY || 'Dubai',
    host: env.DEVICE_HOST || '',
    port: Number(env.DEVICE_PORT || 50443),
    user: env.DEVICE_USER || 'admin',
    pass: env.DEVICE_PASS || '',
    tzOffset: env.TZ_OFFSET || '+04:00',
    cameras: parseJSON(env.CAMERAS, []),
    doors: parseJSON(env.DOORS, []),
    cameraHost: env.CAMERA_HOST,
    cameraPort: env.CAMERA_PORT,
    cameraUser: env.CAMERA_USER,
    cameraPass: env.CAMERA_PASS,
  }, 0)];
}

function normaliseBranch(b, i) {
  const host = b.host || '';
  const port = Number(b.port || 50443);
  const user = b.user || 'admin';
  const pass = b.pass || '';
  return {
    id: b.id || `branch-${i + 1}`,
    name: b.name || b.id || `Branch ${i + 1}`,
    city: b.city || 'Dubai',
    host, port, user, pass,
    tzOffset: b.tzOffset || '+04:00',
    cameras: Array.isArray(b.cameras) ? b.cameras : [], // optional manual override
    doors: Array.isArray(b.doors) ? b.doors : [],
    // Where the cameras live. Defaults to the same device as attendance;
    // set camera* only if your CCTV is on a separate recorder/NVR.
    camera: {
      host: b.cameraHost || host,
      port: Number(b.cameraPort || port),
      user: b.cameraUser || user,
      pass: b.cameraPass || pass,
      tzOffset: b.tzOffset || '+04:00',
    },
  };
}

const settings = {
  branches: loadBranches(),
  dashboardPassword: env.DASHBOARD_PASSWORD || '',
  sessionSecret: env.SESSION_SECRET || crypto.randomBytes(24).toString('hex'),
  enableDoors: String(env.ENABLE_DOORS).toLowerCase() === 'true',
  pageSize: Number(env.PAGE_SIZE || 30),
  maxTimeSeconds: Number(env.MAX_TIME_SECONDS || 30),
  dataDir: env.DATA_DIR || require('path').join(__dirname, '..', 'data'),
  port: Number(env.PORT || 3000),
};

settings.getBranch = (id) => settings.branches.find((b) => b.id === id) || settings.branches[0];

// Public (non-secret) view of a branch for the browser.
settings.publicBranch = (b) => ({ id: b.id, name: b.name, city: b.city, cameras: b.cameras, tzOffset: b.tzOffset });

settings.missing = (() => {
  const m = [];
  if (!settings.branches.length || !settings.branches[0].host) m.push('DEVICE_HOST (or BRANCHES)');
  if (!settings.branches.length || !settings.branches[0].pass) m.push('DEVICE_PASS');
  if (!settings.dashboardPassword) m.push('DASHBOARD_PASSWORD');
  return m;
})();

module.exports = settings;
