'use strict';
const fs = require('fs');
const path = require('path');
const settings = require('./config');

const dir = settings.dataDir;
try { fs.mkdirSync(dir, { recursive: true }); } catch {}

function read(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); }
  catch { return fallback; }
}
function write(file, obj) {
  fs.writeFileSync(path.join(dir, file), JSON.stringify(obj, null, 2));
  return obj;
}

const DEFAULT_SCHEDULE = { start: '09:00', end: '18:00', graceMinutes: 10 };

// Schedules are per branch: { default: {...}, byEmployee: { "1001": {...} } }
function getSchedules(branchId) {
  const all = read('schedules.json', {});
  const b = all[branchId] || {};
  return { default: { ...DEFAULT_SCHEDULE, ...(b.default || {}) }, byEmployee: b.byEmployee || {} };
}
function saveSchedules(branchId, data) {
  const all = read('schedules.json', {});
  all[branchId] = {
    default: { ...DEFAULT_SCHEDULE, ...(data.default || {}) },
    byEmployee: data.byEmployee || {},
  };
  write('schedules.json', all);
  return all[branchId];
}
function scheduleFor(branchId, employeeNo) {
  const s = getSchedules(branchId);
  return { ...s.default, ...(s.byEmployee[employeeNo] || {}) };
}

const DEFAULT_NOTIFICATIONS = {
  lateArrival: true,
  earlyLeave: true,
  absence: false,
  manager: { channel: 'whatsapp', to: '' }, // sending wired later via Respond
};
function getNotifications() {
  return { ...DEFAULT_NOTIFICATIONS, ...read('notifications.json', {}) };
}
function saveNotifications(data) {
  return write('notifications.json', { ...DEFAULT_NOTIFICATIONS, ...data });
}

module.exports = {
  DEFAULT_SCHEDULE,
  getSchedules, saveSchedules, scheduleFor,
  getNotifications, saveNotifications,
};
