// api.js — GoalTrack Pro API client
const API_BASE = (() => {
  if (typeof location === 'undefined') return 'https://goaltrack-36ze.onrender.com/api';
  const { hostname, port } = location;
  if (port === '3000' || hostname === 'goaltrack-36ze.onrender.com') return '/api';
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'http://localhost:3000/api';
  return 'https://goaltrack-36ze.onrender.com/api';
})();

async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('gt_token');
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const Auth = {
  login: (email, password) =>
    apiFetch('/auth/login', { method: 'POST', body: { email, password } }).then((data) => {
      localStorage.setItem('gt_token', data.token);
      localStorage.setItem('gt_user', JSON.stringify(data.user));
      return data;
    }),
  logout() {
    localStorage.removeItem('gt_token');
    localStorage.removeItem('gt_user');
    window.location.reload();
  },
  getUser: () => {
    const u = localStorage.getItem('gt_user');
    return u ? JSON.parse(u) : null;
  },
  isLoggedIn: () => !!localStorage.getItem('gt_token'),
  me: () => apiFetch('/auth/me'),
  listUsers: () => apiFetch('/auth/users'),
};

const Goals = {
  mySheet: (cycleId) => apiFetch('/goals/my-sheet' + (cycleId ? `?cycle_id=${cycleId}` : '')),
  getSheet: (sheetId) => apiFetch(`/goals/sheet/${sheetId}`),
  add: (payload) => apiFetch('/goals', { method: 'POST', body: payload }),
  update: (id, payload) => apiFetch(`/goals/${id}`, { method: 'PATCH', body: payload }),
  edit: (id, payload) => Goals.update(id, payload),
  delete: (id) => apiFetch(`/goals/${id}`, { method: 'DELETE' }),
  remove: (id) => Goals.delete(id),
  submit: (sheetId) => apiFetch(`/goals/submit/${sheetId}`, { method: 'POST' }),
  approve: (sheetId) => apiFetch(`/goals/approve/${sheetId}`, { method: 'POST' }),
  return: (sheetId, note) => apiFetch(`/goals/return/${sheetId}`, { method: 'POST', body: { note } }),
  returnForRework: (sheetId, note) => Goals.return(sheetId, note),
  unlock: (id, reason) => apiFetch(`/goals/unlock/${id}`, { method: 'POST', body: { reason } }),
  lock: (id, reason) => apiFetch(`/goals/lock/${id}`, { method: 'POST', body: { reason } }),
  requestUnlock: (goalId, reason) =>
    apiFetch(`/goals/unlock-request/${goalId}`, { method: 'POST', body: { reason } }),
  myUnlockRequests: () => apiFetch('/goals/my-unlock-requests'),
  unlockRequests: (all = false) =>
    apiFetch('/goals/unlock-requests' + (all ? '?all=1' : '')),
  approveUnlockRequest: (id, adminNote) =>
    apiFetch(`/goals/unlock-requests/${id}/approve`, { method: 'PATCH', body: { adminNote } }),
  rejectUnlockRequest: (id, adminNote) =>
    apiFetch(`/goals/unlock-requests/${id}/reject`, { method: 'PATCH', body: { adminNote } }),
  pushShared: (payload) => apiFetch('/goals/push-shared', { method: 'POST', body: payload }),
};

const CheckIns = {
  schedule: (cycleId) =>
    apiFetch('/checkins/schedule' + (cycleId ? `?cycle_id=${cycleId}` : '')),
  periods: (cycleId) =>
    apiFetch('/checkins/periods' + (cycleId ? `?cycle_id=${cycleId}` : '')),
  launch: (payload) => apiFetch('/checkins/launch', { method: 'POST', body: payload }),
  closePeriod: (id) => apiFetch(`/checkins/periods/${id}/close`, { method: 'PATCH' }),
  myAssignments: () => apiFetch('/checkins/my-assignments'),
  activeForMe: (phase, cycleId) => {
    const q = new URLSearchParams({ phase });
    if (cycleId) q.set('cycle_id', cycleId);
    return apiFetch(`/checkins/active-for-me?${q}`);
  },
};

const Achievements = {
  save: (payload) => apiFetch('/achievements', { method: 'POST', body: payload }),
  forGoal: (goalId) => apiFetch(`/achievements/goal/${goalId}`),
  team: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v) q.set(k, v); });
    return apiFetch(`/achievements/team?${q}`);
  },
  checkin: (payload) => apiFetch('/achievements/checkin', { method: 'POST', body: payload }),
  addCheckin: (payload) => Achievements.checkin(payload),
  checkins: (empId) => apiFetch(`/achievements/checkins/${empId}`),
};

const Admin = {
  dashboard: (cycleId) => apiFetch('/admin/dashboard' + (cycleId ? `?cycle_id=${cycleId}` : '')),
  listCycles: () => apiFetch('/admin/cycles'),
  activeCycle: () => apiFetch('/admin/cycles/active'),
  createCycle: (payload) => apiFetch('/admin/cycles', { method: 'POST', body: payload }),
  updateCycle: (id, payload) => apiFetch(`/admin/cycles/${id}`, { method: 'PATCH', body: payload }),
  escalations: (opts = {}) => {
    const q = new URLSearchParams();
    if (opts.cycle_id) q.set('cycle_id', opts.cycle_id);
    if (opts.all) q.set('all', '1');
    const qs = q.toString();
    return apiFetch('/admin/escalations' + (qs ? `?${qs}` : ''));
  },
  resolveEscalation: (id) => apiFetch(`/admin/escalations/${id}/resolve`, { method: 'PATCH' }),
  triggerScan: () => apiFetch('/admin/escalations/trigger', { method: 'POST' }),
  notifyEscalation: (id) => apiFetch(`/admin/escalations/${id}/notify`, { method: 'PATCH' }),
  auditLog: (opts = {}) => {
    const params = new URLSearchParams({ limit: opts.limit || 50 });
    if (opts.offset) params.set('offset', opts.offset);
    if (opts.action) params.set('action', opts.action);
    if (opts.entity_type) params.set('entity_type', opts.entity_type);
    return apiFetch(`/admin/audit?${params}`);
  },
  analytics: (cycleId, quarter) => {
    const p = new URLSearchParams();
    if (cycleId) p.set('cycle_id', cycleId);
    if (quarter) p.set('quarter', quarter);
    return apiFetch(`/admin/analytics?${p}`);
  },
  report: (opts = {}) => {
    const p = new URLSearchParams();
    Object.entries(opts).forEach(([k, v]) => { if (v) p.set(k, v); });
    return apiFetch(`/admin/report?${p}`);
  },
};

if (typeof module !== 'undefined') module.exports = { Auth, Goals, Achievements, CheckIns, Admin };
