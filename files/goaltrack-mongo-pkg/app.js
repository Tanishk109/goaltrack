// app.js — GoalTrack Pro live data wiring
'use strict';

// ─── State ───────────────────────────────────────────────────────────────────
let currentRole = 'employee';
let currentSheet = null;
let currentSheetId = null;
let goals = [];
let rawGoals = [];
let totalWeightage = 0;
let activeCycle = null;
let currentQuarter = 'Q1';
let achieveId = null;
let editGoalId = null;
let reportData = [];
let auditTrailData = [];
let allUsers = [];
let managerTeamData = [];
let checkinsByEmpId = {};
let viewSheetContext = { sheetId: null, employeeName: '' };

async function loadCheckinsForEmployees(empIds, { force = false } = {}) {
  const ids = [...new Set(empIds.map((id) => String(id)).filter(Boolean))];
  const toFetch = force
    ? ids
    : ids.filter((id) => !Object.prototype.hasOwnProperty.call(checkinsByEmpId, id));
  if (!toFetch.length) return checkinsByEmpId;

  const results = await Promise.allSettled(toFetch.map((id) => Achievements.checkins(id)));
  toFetch.forEach((id, i) => {
    checkinsByEmpId[id] = results[i].status === 'fulfilled'
      ? (results[i].value.checkins || [])
      : [];
  });
  return checkinsByEmpId;
}

function flatCheckinsForEmployees(empIds, users = allUsers) {
  const out = [];
  empIds.forEach((empId) => {
    const id = String(empId);
    const u = users.find((x) => String(x._id || x.id) === id);
    (checkinsByEmpId[id] || []).forEach((c) => {
      out.push({ ...c, employeeName: u?.name || '—' });
    });
  });
  return out;
}

function invalidateCheckinsCache(empId) {
  if (empId != null) delete checkinsByEmpId[String(empId)];
  else checkinsByEmpId = {};
}

const DEMO_CREDS = {
  employee: { email: 'employee@company.com', password: 'password123' },
  manager:  { email: 'manager@company.com',  password: 'password123' },
  admin:    { email: 'admin@company.com',    password: 'password123' },
};

const navConfig = {
  employee: [{ section: 'Main', items: [
    { icon: 'fa-home', label: 'Dashboard', page: 'employee-dashboard' },
    { icon: 'fa-bullseye', label: 'My Goals', page: 'employee-goals' },
    { icon: 'fa-chart-bar', label: 'Analytics', page: 'analytics' },
    { icon: 'fa-file-alt', label: 'Reports', page: 'reports' },
  ]}],
  manager: [{ section: 'Main', items: [
    { icon: 'fa-home', label: 'Dashboard', page: 'manager-dashboard' },
    { icon: 'fa-chart-bar', label: 'Analytics', page: 'analytics' },
    { icon: 'fa-file-alt', label: 'Reports', page: 'reports' },
  ]}],
  admin: [
    { section: 'Main', items: [
      { icon: 'fa-home', label: 'Dashboard', page: 'admin-dashboard' },
      { icon: 'fa-chart-bar', label: 'Analytics', page: 'analytics' },
      { icon: 'fa-file-alt', label: 'Reports', page: 'reports' },
    ]},
    { section: 'Administration', items: [
      { icon: 'fa-users', label: 'Employee Goals', page: 'admin-employee-goals' },
      { icon: 'fa-cog', label: 'Cycle Config', page: 'cycle-config' },
    ]},
  ],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function uomLabel(uom) {
  return { min: 'Numeric (Min)', max: 'Numeric (Max)', percent: '%', timeline: 'Timeline', zero: 'Zero-based' }[uom] || uom;
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const LOADING_HTML = '<p style="color:var(--text-muted);padding:20px">Loading...</p>';

function setContainerLoading(id, cols) {
  const el = document.getElementById(id);
  if (!el) return;
  if (cols != null) {
    el.innerHTML = `<tr><td colspan="${cols}" style="color:var(--text-muted);padding:20px">Loading...</td></tr>`;
  } else {
    el.innerHTML = LOADING_HTML;
  }
}

function setContainersLoading(entries) {
  entries.forEach(({ id, cols }) => setContainerLoading(id, cols));
}

function showPageError(pageId, msg) {
  let el = document.getElementById(`err-${pageId}`);
  if (!el) {
    const pg = document.getElementById(`pg-${pageId}`);
    if (!pg) return;
    el = document.createElement('div');
    el.id = `err-${pageId}`;
    el.className = 'alert alert-danger page-error-banner';
    el.style.display = 'none';
    pg.prepend(el);
  }
  if (msg) { el.innerHTML = `<i class="fa fa-exclamation-circle"></i> ${esc(msg)}`; el.style.display = 'flex'; }
  else el.style.display = 'none';
}

function getAchForQuarter(g, quarter) {
  return (g.achievements || g._raw?.achievements || []).find((a) => a.quarter === quarter) || {};
}

function mapGoalFromApi(g, sheetStatus, quarter = currentQuarter) {
  const ach = getAchForQuarter(g, quarter);
  const locked = g.locked || sheetStatus === 'approved';
  let status = 'draft';
  if (sheetStatus === 'approved' || locked) status = 'approved';
  else if (sheetStatus === 'submitted') status = 'pending';
  else if (sheetStatus === 'returned') status = 'draft';

  return {
    id: g._id,
    _raw: g,
    thrust: g.thrustArea,
    title: g.title,
    description: g.description || '',
    uom: g.uomType,
    target: g.targetValue,
    weightage: g.weightage,
    status,
    locked,
    isShared: g.isShared,
    achievement: ach.actualValue != null && ach.actualValue !== '' ? String(ach.actualValue) : '—',
    achStatus: ach.status || 'not-started',
    score: ach.score || 0,
  };
}

function getScore(g) {
  if (typeof g.score === 'number' && g.achievement !== '—') {
    return Math.min(Math.round(g.score), 150);
  }
  if (g.uom === 'zero') return g.achievement === '0' ? 100 : 0;
  if (g.achievement === '—') return 0;
  const num = parseFloat(String(g.achievement).replace(/[^\d.]/g, '')) || 0;
  const tar = parseFloat(String(g.target).replace(/[^\d.]/g, '')) || 1;
  if (g.uom === 'min' || g.uom === 'percent') return Math.min(Math.round((num / tar) * 100), 100);
  if (g.uom === 'max') return num > 0 ? Math.min(Math.round((tar / num) * 100), 150) : 0;
  return 0;
}

function getProgressClass(g) {
  const s = getScore(g);
  return s >= 80 ? 'high' : s >= 50 ? 'medium' : 'low';
}

function canEditGoals() {
  if (!currentSheet) return false;
  return ['draft', 'returned'].includes(currentSheet.status);
}

// ─── Auth / Nav ──────────────────────────────────────────────────────────────
function selectRole(role, btn) {
  const c = DEMO_CREDS[role];
  if (c) {
    document.getElementById('loginEmail').value = c.email;
    document.getElementById('loginPassword').value = c.password;
  }
  document.querySelectorAll('.role-tab').forEach((t) => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function setupUser() {
  const u = Auth.getUser();
  if (!u) return;
  const initials = u.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  const badgeMap = {
    employee: { cls: 'badge-employee', label: 'Employee' },
    manager:  { cls: 'badge-manager', label: 'Manager (L1)' },
    admin:    { cls: 'badge-admin', label: 'Admin / HR' },
  };
  const b = badgeMap[u.role] || badgeMap.employee;
  document.getElementById('sideAvatar').textContent = initials;
  document.getElementById('sideName').textContent = u.name;
  const el = document.getElementById('sideRoleBadge');
  el.textContent = b.label;
  el.className = 'user-role-badge ' + b.cls;
}

function setupNav() {
  const menu = document.getElementById('navMenu');
  menu.innerHTML = '';
  (navConfig[currentRole] || []).forEach((section) => {
    const s = document.createElement('div');
    s.className = 'nav-section';
    s.textContent = section.section;
    menu.appendChild(s);
    section.items.forEach((item) => {
      const n = document.createElement('div');
      n.className = 'nav-item';
      n.dataset.page = item.page;
      n.innerHTML = `<i class="fa ${item.icon}"></i> ${item.label}`;
      n.onclick = () => navigateTo(item.page, n);
      menu.appendChild(n);
    });
  });
}

async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  if (errEl) {
    errEl.textContent = '';
    errEl.style.display = 'none';
  }

  try {
    const data = await Auth.login(email, password);
    currentRole = data.user.role;
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    setupUser();
    setupNav();
    await navigateTo(currentRole + '-dashboard');
  } catch (err) {
    showToast(err.message, 'danger');
    if (errEl) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  }
}

function doLogout() { Auth.logout(); }

const PAGE_LOADERS = {
  'employee-dashboard': loadEmployeeDashboard,
  'employee-goals': loadMySheet,
  'manager-dashboard': loadManagerDashboard,
  'admin-dashboard': loadAdminDashboard,
  'admin-employee-goals': loadAdminEmployeeGoals,
  'cycle-config': loadCycleConfig,
  reports: loadReports,
  analytics: loadAnalytics,
};

async function navigateTo(pageId, navEl) {
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  const pg = document.getElementById('pg-' + pageId);
  if (pg) pg.classList.add('active');
  document.querySelectorAll('.nav-item').forEach((n) => {
    n.classList.toggle('active', n.dataset.page === pageId);
  });
  const titles = {
    'employee-dashboard': 'Dashboard', 'employee-goals': 'My Goal Sheet',
    'manager-dashboard': 'Manager Dashboard', 'admin-dashboard': 'Admin Dashboard',
    analytics: 'Analytics', reports: 'Reports', 'cycle-config': 'Cycle Configuration',
    'admin-employee-goals': 'Employee Goal Sheets',
  };
  document.getElementById('topbarTitle').textContent = titles[pageId] || pageId;
  showPageError(pageId, null);
  const loader = PAGE_LOADERS[pageId];
  if (loader) await loader();
}

// ─── Employee ────────────────────────────────────────────────────────────────
function applyMySheetResponse({ sheet, goals: serverGoals, totalWeightage: tw }) {
  currentSheet = sheet;
  currentSheetId = sheet._id;
  totalWeightage = tw;
  rawGoals = serverGoals;
  goals = serverGoals.map((g) => mapGoalFromApi(g, sheet.status));
}

async function loadMySheet() {
  showPageError('employee-goals', null);
  setContainerLoading('goalsTable', 8);
  const list = document.getElementById('myGoalsList');
  if (list) list.innerHTML = LOADING_HTML;
  try {
    const data = await Goals.mySheet();
    applyMySheetResponse(data);
    renderSheetStatusBadge();
    renderSheetReturnNote();
    renderGoals();
  } catch (err) {
    showPageError('employee-goals', err.message);
    showToast(err.message, 'danger');
    const table = document.getElementById('goalsTable');
    if (table) table.innerHTML = '<tr><td colspan="8" style="color:var(--text-muted);padding:20px">Unable to load goals</td></tr>';
  }
}

async function loadEmployeeDashboard() {
  showPageError('employee-dashboard', null);
  setContainerLoading('myGoalsList');
  setContainerLoading('achievementTable', 7);
  try {
    const data = await Goals.mySheet();
    applyMySheetResponse(data);
    renderEmployeeStats();
    renderGoals();
    renderAchievements();
  } catch (err) {
    showPageError('employee-dashboard', err.message);
    showToast(err.message, 'danger');
    const list = document.getElementById('myGoalsList');
    if (list) list.innerHTML = '<p style="color:var(--text-muted);padding:20px">Unable to load goals</p>';
    const table = document.getElementById('achievementTable');
    if (table) table.innerHTML = '<tr><td colspan="7" style="color:var(--text-muted);padding:20px">Unable to load achievements</td></tr>';
  }
}

async function loadEmployeeData(pageId) {
  if (pageId === 'employee-goals') return loadMySheet();
  return loadEmployeeDashboard();
}

function renderSheetStatusBadge() {
  const badge = document.getElementById('sheetStatusBadge');
  if (!badge || !currentSheet) return;
  const labels = {
    draft: 'Draft',
    submitted: 'Submitted',
    approved: 'Approved',
    returned: 'Returned',
  };
  const cls = {
    draft: 'status-draft',
    submitted: 'status-pending',
    approved: 'status-approved',
    returned: 'status-rejected',
  };
  badge.textContent = labels[currentSheet.status] || currentSheet.status;
  badge.className = 'status-badge ' + (cls[currentSheet.status] || 'status-draft');
  badge.style.display = 'inline-flex';
}

function renderSheetReturnNote() {
  const box = document.getElementById('sheetReturnNote');
  const text = document.getElementById('sheetReturnNoteText');
  if (!box) return;
  if (currentSheet?.status === 'returned' && currentSheet.returnNote) {
    if (text) text.textContent = currentSheet.returnNote;
    box.style.display = 'flex';
  } else {
    if (text) text.textContent = '';
    box.style.display = 'none';
  }
}

function renderEmployeeStats() {
  const grid = document.querySelector('#pg-employee-dashboard .stats-grid');
  if (!grid) return;
  const avg = goals.length ? Math.round(goals.reduce((s, g) => s + getScore(g), 0) / goals.length) : 0;
  const vals = [goals.length, avg + '%', '—', totalWeightage + '%'];
  const labels = ['Active Goals', 'Avg. Achievement', 'Pending Check-ins', 'Weightage Used'];
  grid.querySelectorAll('.stat-value').forEach((el, i) => { if (vals[i] != null) el.textContent = vals[i]; });
  grid.querySelectorAll('.stat-label').forEach((el, i) => { if (labels[i]) el.textContent = labels[i]; });
}

function renderGoals() {
  const list = document.getElementById('myGoalsList');
  const table = document.getElementById('goalsTable');
  const editable = canEditGoals();

  if (list) {
    list.innerHTML = goals.length ? goals.map((g) => `
      <div class="goal-item">
        <div class="goal-item-header">
          <div>
            <div class="goal-title">${esc(g.title)}${g.isShared ? ' <span class="chip orange">Shared</span>' : ''}</div>
            <div class="goal-meta">${esc(g.thrust)} · ${esc(uomLabel(g.uom))} · Target: ${esc(g.target)} · ${g.weightage}%</div>
          </div>
          <span class="status-badge status-${g.status}">${
      g.status === 'pending' ? 'Awaiting Approval' :
      g.status === 'approved' ? 'Approved' :
      g.status === 'draft' ? 'Draft' : g.status
    }</span>
        </div>
        ${g.status === 'approved' || currentSheet?.status === 'approved' ? `
        <div>
          <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:12px">
            <span style="color:var(--text-muted)">${currentQuarter} Achievement</span>
            <span style="font-weight:700">${esc(g.achievement)}</span>
          </div>
          <div class="progress-bar"><div class="progress-fill ${getProgressClass(g)}" style="width:${Math.min(getScore(g), 100)}%"></div></div>
          <div style="display:flex;justify-content:space-between;margin-top:6px">
            <span class="status-badge status-${g.achStatus}">${g.achStatus.replace('-', ' ')}</span>
            <button class="btn btn-outline btn-sm" onclick="openAchieve('${g.id}')">Update</button>
          </div>
        </div>` : `<div style="font-size:13px;color:var(--text-muted)">${editable ? 'Editable — submit when weightage totals 100%' :
     currentSheet?.status === 'submitted' ? 'Submitted — waiting for manager approval' :
     currentSheet?.status === 'approved' ? 'Approved and locked' :
     'Waiting for manager approval'}</div>`}
      </div>`).join('') : '<div class="empty-state"><i class="fa fa-bullseye"></i><p>No goals yet. Add your first goal!</p></div>';
  }

  if (table) {
    table.innerHTML = goals.map((g, i) => {
      const canEdit = editable && !g.locked;
      const canDel = canEdit && !g.isShared;
      return `<tr>
        <td style="color:var(--text-muted)">${i + 1}</td>
        <td><span class="chip blue">${esc(g.thrust)}</span></td>
        <td><strong>${esc(g.title)}</strong></td>
        <td>${uomLabel(g.uom)}</td>
        <td>${esc(g.target)}</td>
        <td><strong>${g.weightage}%</strong></td>
        <td><span class="status-badge status-${g.status}">${
      g.status === 'pending' ? 'Awaiting Approval' :
      g.status === 'approved' ? 'Approved' :
      g.status === 'draft' ? 'Draft' : g.status
    }</span></td>
        <td><div style="display:flex;gap:6px;flex-wrap:wrap">
          ${canEdit ? `<button class="btn btn-outline btn-sm" onclick="openEditGoal('${g.id}')">Edit</button>` : ''}
          ${canDel ? `<button class="btn btn-danger btn-sm" onclick="deleteGoal('${g.id}')"><i class="fa fa-trash"></i></button>` : ''}
          ${g.locked && currentRole === 'admin'
    ? `<button class="btn btn-warning btn-sm" onclick="unlockGoal('${g.id}')"><i class="fa fa-lock-open"></i> Unlock</button>`
    : g.locked
    ? `<span class="btn btn-outline btn-sm" style="cursor:default;opacity:0.6" title="Locked — contact admin to unlock"><i class="fa fa-lock"></i> Locked</span>`
    : ''}
        </div></td>
      </tr>`;
    }).join('');
  }

  const pct = Math.min(totalWeightage, 100);
  const wt = document.getElementById('weightageText');
  const wb = document.getElementById('weightageBar');
  if (wt) wt.textContent = `${totalWeightage}% / 100%`;
  if (wb) {
    wb.style.width = pct + '%';
    wb.className = 'weightage-fill' + (totalWeightage > 100 ? ' over' : '');
  }
  const remain = document.querySelector('#pg-employee-goals .weightage-display p');
  if (remain) {
    const left = 100 - totalWeightage;
    remain.textContent = left > 0 ? `${left}% remaining — add more goals or adjust weightages` : left < 0 ? 'Over 100% — reduce weightages' : '✓ Weightage balanced at 100%';
  }

  const submitBtn = document.querySelector('#pg-employee-goals .btn-success');
  if (submitBtn) submitBtn.disabled = !editable || goals.length === 0;
}

function renderAchievements() {
  const t = document.getElementById('achievementTable');
  if (!t) return;
  t.innerHTML = goals.map((g) => `
    <tr>
      <td><strong>${esc(g.title)}</strong></td>
      <td><span class="chip blue">${esc(g.thrust)}</span></td>
      <td>${uomLabel(g.uom)}</td>
      <td>${esc(g.target)}</td>
      <td>${esc(g.achievement)}</td>
      <td><div style="display:flex;align-items:center;gap:8px">
        <div class="progress-bar" style="min-width:80px"><div class="progress-fill ${getProgressClass(g)}" style="width:${Math.min(getScore(g), 100)}%"></div></div>
        <span style="font-weight:700">${getScore(g)}%</span>
      </div></td>
      <td><span class="status-badge status-${g.achStatus}">${g.achStatus.replace('-', ' ')}</span></td>
    </tr>`).join('');
}

async function addGoal() {
  const errEl = document.getElementById('addGoalModalError');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

  const thrustArea = document.getElementById('gThrustArea').value.trim();
  const title = document.getElementById('gTitle').value.trim();
  const description = document.getElementById('gDesc').value.trim();
  const uomType = document.getElementById('gUoM').value;
  const targetValue = document.getElementById('gTarget').value.trim();
  const weightage = parseInt(document.getElementById('gWeightage').value, 10);

  if (!title || !thrustArea || !uomType || !targetValue || !weightage) {
    showToast('Please fill in all fields!', 'danger');
    return;
  }
  if (weightage < 10) {
    showToast('Min weightage is 10%', 'danger');
    return;
  }
  if (goals.length >= 8) {
    showToast('Maximum 8 goals allowed.', 'danger');
    return;
  }
  if (!currentSheet?._id) {
    showToast('No goal sheet loaded. Please refresh the page.', 'danger');
    return;
  }

  try {
    await Goals.add({
      sheet_id: currentSheet._id,
      thrustArea,
      title,
      description,
      uomType,
      targetValue,
      weightage,
    });
    closeModal('addGoalModal');
    showToast('Goal added!');
    await loadMySheet();
  } catch (err) {
    const msg = err.message.includes('Maximum 8')
      ? 'You have reached the maximum of 8 goals. Delete a goal to add a new one.'
      : err.message;
    showToast(msg, 'danger');
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
    await loadMySheet();
  }
}

async function submitGoals() {
  const errEl = document.getElementById('submitGoalsError');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

  if (totalWeightage !== 100) {
    const msg = `Weightage is ${totalWeightage}%. Must be exactly 100%.`;
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
    return;
  }
  if (!currentSheet?._id) {
    const msg = 'No goal sheet loaded. Please refresh the page.';
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
    return;
  }

  try {
    await Goals.submit(currentSheet._id);
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    showToast('Goals submitted for manager approval!');
    await loadMySheet();
  } catch (err) {
    showToast(err.message, 'danger');
    if (errEl) {
      errEl.textContent = err.message || 'Failed to submit goals';
      errEl.style.display = 'block';
    }
  }
}

function openAchieve(id) {
  achieveId = id;
  const g = goals.find((x) => x.id === id);
  if (!g) return;
  const errEl = document.getElementById('achieveModalError');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  document.getElementById('achieveGoalName').textContent = g.title;
  document.getElementById('achieveGoalTarget').textContent = g.target;
  document.getElementById('achieveActual').value = g.achievement === '—' ? '' : g.achievement;
  document.getElementById('achieveStatus').value = g.achStatus;
  const notesEl = document.getElementById('achieveNotes');
  if (notesEl) notesEl.value = '';
  const qSel = document.getElementById('achieveQuarter');
  if (qSel) qSel.value = currentQuarter;
  const quarter = qSel?.value || currentQuarter;
  const bannerEl = document.querySelector('#achieveModal .alert-info');
  if (bannerEl) {
    bannerEl.innerHTML = `<i class="fa fa-info-circle"></i> <strong>${quarter}</strong> check-in window. Update your progress for this quarter.`;
  }
  showModal('achieveModal');
}

async function saveAchievement() {
  const errEl = document.getElementById('achieveModalError');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

  const quarter = document.getElementById('achieveQuarter')?.value || currentQuarter;
  const actualValue = document.getElementById('achieveActual').value;
  const status = document.getElementById('achieveStatus').value;
  const notes = document.getElementById('achieveNotes')?.value.trim() || '';

  try {
    const data = await Achievements.save({
      goal_id: achieveId,
      quarter,
      actualValue,
      status,
      notes,
    });
    closeModal('achieveModal');
    showToast(`Achievement saved! Score: ${data.score}%`);
    await loadMySheet();
  } catch (err) {
    showToast(err.message, 'danger');
    if (errEl) {
      errEl.textContent = err.message || 'Failed to save achievement';
      errEl.style.display = 'block';
    }
  }
}

function openEditGoal(id) {
  editGoalId = id;
  const g = goals.find((x) => x.id === id);
  if (!g) return;
  document.getElementById('editGoalTitle').textContent = g.title;
  const shared = g.isShared;
  document.getElementById('editGoalTitleInput').value = g.title;
  document.getElementById('editGoalTitleInput').disabled = shared;
  document.getElementById('editThrustArea').value = g.thrust;
  document.getElementById('editUoM').value = g.uom;
  document.getElementById('editTarget').value = g.target;
  document.getElementById('editWeightage').value = g.weightage;
  document.getElementById('editDesc').value = g.description || '';
  ['editThrustArea', 'editUoM', 'editTarget', 'editDesc'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = shared;
  });
  document.getElementById('editWeightage').disabled = false;
  showModal('editGoalModal');
}

async function saveEditGoal() {
  const g = goals.find((x) => x.id === editGoalId);
  const payload = { weightage: parseInt(document.getElementById('editWeightage').value, 10) };
  if (!g?.isShared) {
    payload.thrustArea = document.getElementById('editThrustArea').value.trim();
    payload.uomType = document.getElementById('editUoM').value;
    payload.targetValue = document.getElementById('editTarget').value.trim();
    payload.description = document.getElementById('editDesc').value.trim();
    payload.title = document.getElementById('editGoalTitleInput').value.trim();
  }
  try {
    await Goals.update(editGoalId, payload);
    closeModal('editGoalModal');
    showToast('Goal updated!');
    await loadEmployeeData('employee-goals');
  } catch (err) { showToast(err.message, 'danger'); }
}

async function deleteGoal(id) {
  if (!confirm('Delete this goal?')) return;
  try {
    await Goals.delete(id);
    showToast('Goal deleted.');
    await loadEmployeeData('employee-goals');
  } catch (err) { showToast(err.message, 'danger'); }
}

async function unlockGoal(id) {
  const reason = prompt('Reason for unlocking this goal:');
  if (!reason) return;
  try {
    await Goals.unlock(id, reason);
    showToast('Goal unlocked.');
    await loadEmployeeData('employee-goals');
  } catch (err) { showToast(err.message, 'danger'); }
}

async function unlockGoalAndRefresh(goalId) {
  const reason = prompt('Reason for unlocking:');
  if (reason === null) return;
  try {
    await Goals.unlock(goalId, reason || 'Admin unlock');
    showToast('Goal unlocked.');
    await viewSheetGoals(viewSheetContext.sheetId, viewSheetContext.employeeName);
    const page = getActivePageId();
    if (page === 'admin-employee-goals') await loadAdminEmployeeGoals();
  } catch (err) { showToast(err.message, 'danger'); }
}

// ─── Manager ─────────────────────────────────────────────────────────────────
function setManagerQuarter(q) {
  currentQuarter = q || 'Q1';
  const sel = document.getElementById('managerQuarter');
  if (sel) sel.value = currentQuarter;
  const label = document.getElementById('teamQuarterLabel');
  if (label) label.textContent = currentQuarter;
  if (currentRole === 'manager') loadManagerTeamProgress();
}

async function loadManagerTeamProgress() {
  setContainerLoading('teamProgressTable', 7);
  try {
    const teamRes = await Achievements.team({ quarter: currentQuarter });
    managerTeamData = teamRes.data || [];
    renderTeamProgress(managerTeamData);
  } catch (err) {
    showToast(err.message, 'danger');
    const tbody = document.getElementById('teamProgressTable');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="color:var(--text-muted);padding:20px">Unable to load team progress</td></tr>';
  }
}

async function loadManagerDashboard() {
  showPageError('manager-dashboard', null);
  const sel = document.getElementById('managerQuarter');
  if (sel) sel.value = currentQuarter;
  const label = document.getElementById('teamQuarterLabel');
  if (label) label.textContent = currentQuarter;
  setContainersLoading([
    { id: 'pendingApprovalTable', cols: 6 },
    { id: 'teamProgressTable', cols: 7 },
    { id: 'checkinCommentsTable', cols: 4 },
  ]);
  try {
    const [dash, teamRes, usersRes] = await Promise.all([
      Admin.dashboard(),
      Achievements.team({ quarter: currentQuarter }),
      Auth.listUsers(),
    ]);
    allUsers = usersRes.users || usersRes;
    managerTeamData = teamRes.data || [];
    renderManagerStats(dash);
    renderPendingApprovals(dash.pendingApproval || []);
    renderTeamProgress(managerTeamData);

    // Get employee IDs directly from the users list (not dependent on approved sheets)
    const empIds = allUsers
      .filter((u) => u.role === 'employee')
      .map((u) => String(u._id || u.id))
      .filter(Boolean);
    if (empIds.length) await loadCheckinsForEmployees(empIds);
    const allCheckins = flatCheckinsForEmployees(empIds);
    allCheckins.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    renderCheckinComments(allCheckins.slice(0, 10));
  } catch (err) {
    showPageError('manager-dashboard', err.message);
    showToast(err.message, 'danger');
    const pending = document.getElementById('pendingApprovalTable');
    const team = document.getElementById('teamProgressTable');
    const checkins = document.getElementById('checkinCommentsTable');
    if (pending) pending.innerHTML = '<tr><td colspan="6" style="color:var(--text-muted);padding:20px">Unable to load</td></tr>';
    if (team) team.innerHTML = '<tr><td colspan="7" style="color:var(--text-muted);padding:20px">Unable to load</td></tr>';
    if (checkins) checkins.innerHTML = '<tr><td colspan="4" style="color:var(--text-muted);padding:20px">Unable to load</td></tr>';
  }
}

function renderManagerStats(dash) {
  const s = dash.summary || {};
  const pending = (dash.pendingApproval || []).length;
  const grid = document.querySelector('#pg-manager-dashboard .stats-grid');
  if (!grid) return;
  const vals = [s.totalEmployees, s.submitted, s.approved, pending];
  grid.querySelectorAll('.stat-value').forEach((el, i) => {
    if (vals[i] != null) el.textContent = vals[i];
  });
}

function renderPendingApprovals(list) {
  let tbody = document.getElementById('pendingApprovalTable');
  if (!tbody) {
    const card = document.querySelector('#pg-manager-dashboard .card .card-body table tbody');
    if (card?.closest('table')?.querySelector('th')?.textContent?.includes('Employee')) {
      card.id = 'pendingApprovalTable';
      tbody = card;
    }
  }
  if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No pending approvals</td></tr>';
    return;
  }
  tbody.innerHTML = list.map((p) => `
    <tr>
      <td><strong>${esc(p.employeeName)}</strong></td>
      <td>${esc(p.department || '—')}</td>
      <td>${p.goalCount}</td>
      <td><span style="color:${p.totalWeightage === 100 ? 'var(--success)' : 'var(--danger)'};font-weight:700">${p.totalWeightage}%</span></td>
      <td>${fmtDate(p.submittedAt)}</td>
      <td><div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-outline btn-sm" onclick="viewSheetGoals('${p.sheetId}', ${JSON.stringify(p.employeeName)})">View</button>
        <button class="btn btn-success btn-sm" onclick="approveSheet('${p.sheetId}')"><i class="fa fa-check"></i> Approve</button>
        <button class="btn btn-warning btn-sm" onclick="returnSheet('${p.sheetId}')"><i class="fa fa-undo"></i> Return</button>
      </div></td>
    </tr>`).join('');
}

function achStatusClass(status) {
  const s = (status || 'not-started').replace(/\s+/g, '-');
  if (s === 'not-started') return 'notstarted';
  if (s === 'on-track') return 'ontrack';
  return s;
}

function getEmployeeIdByName(name) {
  const u = allUsers.find((x) => x.name === name && x.role === 'employee');
  return u ? String(u._id || u.id) : '';
}

function renderCheckinComments(list) {
  const tbody = document.getElementById('checkinCommentsTable');
  if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No check-in comments yet.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map((c) => `
    <tr>
      <td><strong>${esc(c.employeeName)}</strong></td>
      <td>${esc(c.goal?.title || '—')}</td>
      <td style="max-width:200px;font-size:13px">${esc(c.comment)}</td>
      <td>${fmtDate(c.createdAt)}</td>
    </tr>`).join('');
}

function renderTeamProgress(data) {
  const tbody = document.getElementById('teamProgressTable');
  if (!tbody) return;
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">No team data for ${esc(currentQuarter)}</td></tr>`;
    return;
  }
  const seenEmployees = new Set();
  tbody.innerHTML = data.map((r) => {
    const st = r.status || 'not-started';
    const stCls = achStatusClass(st);
    const actual = r.actualValue != null && r.actualValue !== '' ? esc(String(r.actualValue)) : '—';
    const empId = getEmployeeIdByName(r.employeeName);
    const showCheckins = r.employeeName && !seenEmployees.has(r.employeeName);
    if (showCheckins) seenEmployees.add(r.employeeName);
    const checkinBtn = showCheckins && empId
      ? `<button type="button" class="btn btn-outline btn-sm" onclick="viewEmployeeCheckins('${empId}')">View Check-ins</button>`
      : '';
    return `<tr>
      <td><strong>${esc(r.employeeName)}</strong></td>
      <td>${esc(r.title)}</td>
      <td>${esc(r.targetValue)}</td>
      <td>${actual}</td>
      <td><strong>${r.score || 0}%</strong></td>
      <td><span class="status-badge status-${stCls}">${esc(st.replace(/-/g, ' '))}</span></td>
      <td>${checkinBtn}</td>
    </tr>`;
  }).join('');
}

function getActivePageId() {
  const pg = document.querySelector('.page.active');
  return pg?.id?.replace(/^pg-/, '') || '';
}

async function refreshAfterSheetAction({ keepModalOpen = false } = {}) {
  const page = getActivePageId();
  if (currentRole === 'manager') await loadManagerDashboard();
  if (currentRole === 'admin') {
    if (page === 'admin-employee-goals') await loadAdminEmployeeGoals();
    if (page === 'admin-dashboard') await loadAdminDashboard();
  }
  if (!keepModalOpen) closeModal('viewSheetModal');
}

async function approveSheet(sheetId) {
  try {
    await Goals.approve(sheetId);
    showToast('Sheet approved!');
    await refreshAfterSheetAction();
  } catch (err) { showToast(err.message, 'danger'); }
}

async function returnSheet(sheetId) {
  const note = prompt('Return note for employee:');
  if (note === null) return;
  try {
    await Goals.return(sheetId, note || 'Returned for rework.');
    showToast('Sheet returned for rework.');
    await refreshAfterSheetAction();
  } catch (err) { showToast(err.message, 'danger'); }
}

async function viewSheetGoals(sheetId, employeeName) {
  viewSheetContext = { sheetId, employeeName };
  const body = document.getElementById('viewSheetBody');
  if (body) body.innerHTML = LOADING_HTML;
  try {
    const { goals: gs, totalWeightage: tw, sheet } = await Goals.getSheet(sheetId);
    const canInlineEdit = currentRole === 'manager'
      ? sheet?.status === 'submitted'
      : currentRole === 'admin';
    document.getElementById('viewSheetTitle').textContent = `Goals — ${employeeName} (${tw}% total)`;
    const sheetIdStr = String(sheetId);
    let sheetActionsHtml = '';
    if (currentRole === 'admin' && sheet?.status === 'submitted') {
      sheetActionsHtml = `<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
        <button type="button" class="btn btn-success btn-sm" onclick="approveSheet('${sheetIdStr}')">
          <i class="fa fa-check"></i> Approve Sheet
        </button>
        <button type="button" class="btn btn-warning btn-sm" onclick="returnSheet('${sheetIdStr}')">
          <i class="fa fa-undo"></i> Return for Rework
        </button>
      </div>`;
    } else if (currentRole === 'admin' && sheet?.status === 'approved') {
      sheetActionsHtml = `<p style="font-size:13px;color:var(--text-muted);margin:0 0 12px">
        <i class="fa fa-info-circle"></i> Use <strong>Unlock</strong> on locked goals below to allow edits (logged to audit trail).
      </p>`;
    }
    const goalsHTML = (gs || []).map((g) => {
      const goalId = String(g._id || g.id);
      const editBtn = canInlineEdit
        ? `<button type="button" class="btn btn-outline btn-sm" style="margin-top:8px" onclick="toggleInlineEdit(this, '${goalId}', ${g.weightage}, ${JSON.stringify(String(g.targetValue ?? ''))})"><i class="fa fa-pencil"></i> Edit</button>`
        : '';
      const unlockBtn = (currentRole === 'admin' && g.locked)
        ? `<button type="button" class="btn btn-warning btn-sm" style="margin-top:8px;margin-left:4px" onclick="unlockGoalAndRefresh('${goalId}')"><i class="fa fa-lock-open"></i> Unlock</button>`
        : '';
      return `
      <div class="view-sheet-goal-row" data-goal-id="${esc(goalId)}" style="padding:10px 0;border-bottom:1px solid var(--border)">
        <strong>${esc(g.title)}</strong> · ${g.weightage}% · ${esc(g.thrustArea)}<br>
        <span style="font-size:12px;color:var(--text-muted)">${uomLabel(g.uomType)} · Target: ${esc(g.targetValue)}</span>
        ${editBtn}${unlockBtn}
      </div>`;
    }).join('') || '<p>No goals</p>';
    document.getElementById('viewSheetBody').innerHTML = sheetActionsHtml + goalsHTML;
    showModal('viewSheetModal');
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

function toggleInlineEdit(btn, goalId, currentWeightage, currentTarget) {
  const row = btn.closest('[data-goal-id]') || btn.parentElement;
  if (!row) return;

  const existing = row.querySelector('.inline-edit-form');
  if (existing) {
    existing.remove();
    return;
  }

  const form = document.createElement('div');
  form.className = 'inline-edit-form';
  form.style.marginTop = '10px';
  form.style.padding = '12px';
  form.style.background = 'var(--surface2)';
  form.style.borderRadius = '8px';

  const errEl = document.createElement('p');
  errEl.className = 'inline-edit-error';
  errEl.style.cssText = 'color:var(--danger);font-size:12px;margin:8px 0 0;display:none';

  const targetInput = document.createElement('input');
  targetInput.type = 'text';
  targetInput.name = 'targetValue';
  targetInput.value = currentTarget ?? '';
  targetInput.className = 'form-input';
  targetInput.style.flex = '1';
  targetInput.style.minWidth = '120px';

  const weightInput = document.createElement('input');
  weightInput.type = 'number';
  weightInput.name = 'weightage';
  weightInput.min = '10';
  weightInput.max = '100';
  weightInput.value = currentWeightage ?? 10;
  weightInput.className = 'form-input';
  weightInput.style.width = '80px';

  const fields = document.createElement('div');
  fields.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end';
  [['Target', targetInput], ['Weightage %', weightInput]].forEach(([label, input]) => {
    const wrap = document.createElement('label');
    wrap.style.fontSize = '12px';
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '4px';
    wrap.append(document.createTextNode(label), input);
    fields.appendChild(wrap);
  });

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:8px;margin-top:10px';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn btn-primary btn-sm';
  saveBtn.textContent = 'Save';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-outline btn-sm';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => form.remove());

  saveBtn.addEventListener('click', async () => {
    errEl.style.display = 'none';
    errEl.textContent = '';
    const targetValue = targetInput.value.trim();
    const weightage = parseInt(weightInput.value, 10);
    if (!targetValue) {
      errEl.textContent = 'Target value is required.';
      errEl.style.display = 'block';
      return;
    }
    if (!Number.isFinite(weightage) || weightage < 10) {
      errEl.textContent = 'Minimum weightage is 10%.';
      errEl.style.display = 'block';
      return;
    }
    try {
      await Goals.update(goalId, { targetValue, weightage });
      showToast('Goal updated');
      await viewSheetGoals(viewSheetContext.sheetId, viewSheetContext.employeeName);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  });

  actions.append(saveBtn, cancelBtn);
  form.append(fields, actions, errEl);
  row.appendChild(form);
}

async function populateCheckinModal() {
  const errEl = document.getElementById('checkinModalError');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  try {
    const res = await Auth.listUsers();
    allUsers = res.users || res;
    const empSel = document.getElementById('checkinEmployee');
    if (!empSel) return;
    const employees = allUsers.filter((u) => u.role === 'employee');
    empSel.innerHTML = '<option value="">-- Select employee --</option>' +
      employees.map((u) => `<option value="${u._id || u.id}">${esc(u.name)}</option>`).join('');
    const goalSel = document.getElementById('checkinGoal');
    if (goalSel) goalSel.innerHTML = '<option value="">-- Select goal --</option>';
    const qSel = document.getElementById('checkinQuarter');
    if (qSel) qSel.value = currentQuarter;
    const commentEl = document.getElementById('checkinComment');
    if (commentEl) commentEl.value = '';
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function updateCheckinGoals() {
  const empSel = document.getElementById('checkinEmployee');
  const goalSel = document.getElementById('checkinGoal');
  if (!goalSel || !empSel) return;
  if (!empSel.value) {
    goalSel.innerHTML = '<option value="">-- Select goal --</option>';
    return;
  }
  const empId = empSel.value;
  if (!managerTeamData.length) {
    try {
      const teamRes = await Achievements.team({ quarter: currentQuarter });
      managerTeamData = teamRes.data || [];
    } catch (err) {
      showToast(err.message, 'danger');
      goalSel.innerHTML = '<option value="">Unable to load goals</option>';
      return;
    }
  }
  const empGoals = managerTeamData.filter((g) => String(g.employeeId) === String(empId));
  goalSel.innerHTML = empGoals.length
    ? empGoals.map((g) => `<option value="${g.goalId}">${esc(g.title)}</option>`).join('')
    : '<option value="">No approved goals for this quarter</option>';
}

async function saveCheckin() {
  const errEl = document.getElementById('checkinModalError');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

  const employee_id = document.getElementById('checkinEmployee')?.value;
  const goal_id = document.getElementById('checkinGoal')?.value;
  const quarter = document.getElementById('checkinQuarter')?.value || currentQuarter;
  const comment = document.getElementById('checkinComment')?.value?.trim();

  if (!employee_id || !goal_id || !comment) {
    showToast('Please select an employee, a goal, and enter a comment.', 'danger');
    return;
  }

  try {
    await Achievements.checkin({ goal_id, employee_id, quarter, comment });
    invalidateCheckinsCache(employee_id);
    closeModal('checkinModal');
    showToast('Check-in saved!');
  } catch (err) {
    showToast(err.message, 'danger');
    if (errEl) {
      errEl.textContent = err.message || 'Failed to save check-in';
      errEl.style.display = 'block';
    }
  }
}

async function viewEmployeeCheckins(employeeId) {
  if (!employeeId) {
    showToast('Employee not found', 'danger');
    return;
  }
  const body = document.getElementById('checkinsListBody');
  if (body) body.innerHTML = LOADING_HTML;
  try {
    let u = allUsers.find((x) => String(x._id || x.id) === String(employeeId));
    if (!u && !allUsers.length) {
      const res = await Auth.listUsers();
      allUsers = res.users || res;
      u = allUsers.find((x) => String(x._id || x.id) === String(employeeId));
    }
    await loadCheckinsForEmployees([employeeId]);
    const checkins = checkinsByEmpId[String(employeeId)] || [];
    const titleEl = document.querySelector('#checkinsListModal .modal-title');
    if (titleEl) titleEl.textContent = `Check-ins — ${u?.name || 'Employee'}`;
    document.getElementById('checkinsListBody').innerHTML = checkins.length ? checkins.map((c) => `
      <div style="padding:12px 0;border-bottom:1px solid var(--border)">
        <div style="font-weight:700;margin-bottom:4px">${esc(c.goal?.title || 'Goal')} · ${esc(c.quarter || '')}</div>
        <p style="font-size:13px;margin:0 0 6px">${esc(c.comment)}</p>
        <div style="font-size:12px;color:var(--text-muted)">${fmtDate(c.createdAt)} · ${esc(c.manager?.name || 'Manager')}</div>
      </div>`).join('') : '<p style="color:var(--text-muted)">No check-ins yet.</p>';
    showModal('checkinsListModal');
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

// ─── Admin ───────────────────────────────────────────────────────────────────
async function loadAdminDashboard() {
  showPageError('admin-dashboard', null);
  setContainersLoading([
    { id: 'escalationsTable', cols: 4 },
    { id: 'auditTrailTable', cols: 4 },
    { id: 'completionTable', cols: 6 },
  ]);
  let dash = { summary: {} };
  let escalations = [];
  let teamCheckins = [];
  try {
    const [dashRes, escRes, teamRes, usersRes] = await Promise.all([
      Admin.dashboard(),
      Admin.escalations({ all: true }),
      Achievements.team({ quarter: currentQuarter }).catch(() => ({ data: [] })),
      allUsers.length ? Promise.resolve({ users: allUsers }) : Auth.listUsers(),
    ]);
    dash = dashRes;
    escalations = escRes.escalations || [];
    teamCheckins = teamRes.data || [];
    allUsers = usersRes.users || usersRes;
  } catch (err) {
    showPageError('admin-dashboard', err.message);
    showToast(err.message, 'danger');
    const esc = document.getElementById('escalationsTable');
    if (esc) esc.innerHTML = '<tr><td colspan="4" style="color:var(--text-muted);padding:20px">Unable to load</td></tr>';
    const completion = document.getElementById('completionTable');
    if (completion) completion.innerHTML = '<tr><td colspan="6" style="color:var(--text-muted);padding:20px">Unable to load</td></tr>';
  }
  const activeEsc = escalations.filter((e) => !e.resolved).length;
  renderAdminStats(dash, activeEsc, teamCheckins);
  await renderCompletionTable(dash, teamCheckins);
  renderEscalations(escalations);
  try {
    const auditRes = await Admin.auditLog({ limit: 50 });
    renderAuditTrail(auditRes.logs || []);
  } catch (err) {
    showToast(err.message, 'danger');
    renderAuditTrail([]);
    const audit = document.getElementById('auditTrailTable');
    if (audit) audit.innerHTML = '<tr><td colspan="4" style="color:var(--text-muted);padding:20px">Unable to load audit trail</td></tr>';
  }
}

async function loadAdminEmployeeGoals() {
  setContainerLoading('adminEmployeeSheetsTable', 6);
  try {
    const dash = await Admin.dashboard();
    const allSheets = [
      ...(dash.pendingApproval || []).map((p) => ({ ...p, _status: 'submitted' })),
      ...(dash.approvedSheets || []).map((p) => ({ ...p, _status: 'approved' })),
      ...(dash.notSubmitted || []).map((u) => ({
        sheetId: null,
        employeeName: u.name,
        department: u.department,
        goalCount: 0,
        totalWeightage: 0,
        submittedAt: null,
        _status: 'not-submitted',
      })),
    ];
    const tbody = document.getElementById('adminEmployeeSheetsTable');
    if (!tbody) return;
    if (!allSheets.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No sheets found</td></tr>';
      return;
    }
    const statusCssMap = {
      submitted:     'status-pending',
      approved:      'status-approved',
      'not-submitted': 'status-draft',
      returned:      'status-rejected',
    };
    tbody.innerHTML = allSheets.map((p) => {
      const status = p._status || 'submitted';
      const cssClass = statusCssMap[status] || 'status-draft';
      const nameJson = JSON.stringify(p.employeeName);
      const sid = p.sheetId;
      let actionBtns = [];
      if (sid) {
        actionBtns.push(
          `<button class="btn btn-outline btn-sm" onclick="viewSheetGoals('${sid}', ${nameJson})"><i class="fa fa-eye"></i> View & Edit</button>`,
        );
        if (currentRole === 'admin' && status === 'approved') {
          actionBtns.push(
            `<button class="btn btn-warning btn-sm" onclick="viewSheetGoals('${sid}', ${nameJson})"><i class="fa fa-lock-open"></i> Unlock Goals</button>`,
          );
        }
        if (currentRole === 'admin' && status === 'submitted') {
          actionBtns.push(
            `<button class="btn btn-success btn-sm" onclick="approveSheet('${sid}')"><i class="fa fa-check"></i> Approve</button>`,
            `<button class="btn btn-warning btn-sm" onclick="returnSheet('${sid}')"><i class="fa fa-undo"></i> Return</button>`,
          );
        }
      }
      const actions = sid
        ? `<div style="display:flex;gap:6px;flex-wrap:wrap">${actionBtns.join('')}</div>`
        : '<span style="color:var(--text-muted);font-size:12px">Not submitted</span>';
      return `<tr>
        <td><strong>${esc(p.employeeName)}</strong></td>
        <td>${esc(p.department || '—')}</td>
        <td>${p.goalCount ?? '—'}</td>
        <td>${p.totalWeightage != null ? p.totalWeightage + '%' : '—'}</td>
        <td><span class="status-badge ${cssClass}">${esc(status.replace(/-/g, ' '))}</span></td>
        <td>${actions}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    showToast(err.message, 'danger');
    const tbody = document.getElementById('adminEmployeeSheetsTable');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="color:var(--text-muted);padding:20px">Unable to load</td></tr>';
  }
}

function renderAdminStats(dash, activeEscalations = 0, teamCheckins = []) {
  const s = dash.summary || {};
  const grid = document.querySelector('#pg-admin-dashboard .stats-grid');
  if (grid) {
    const vals = [
      s.totalEmployees,
      s.submitted,
      (dash.pendingApproval || []).length,
      activeEscalations,
    ];
    grid.querySelectorAll('.stat-value').forEach((el, i) => {
      if (vals[i] != null) el.textContent = vals[i];
    });
  }

  document.getElementById('submissionRateFill').style.width = (s.submissionRate || 0) + '%';
  document.getElementById('submissionRateLabel').textContent = (s.submissionRate || 0) + '%';
  document.getElementById('approvalRateFill').style.width = (s.approvalRate || 0) + '%';
  document.getElementById('approvalRateLabel').textContent = (s.approvalRate || 0) + '%';

  const checkinDoneCount = new Set(
    (teamCheckins || [])
      .filter((r) => r.actualValue != null && r.actualValue !== '')
      .map((r) => r.employeeName),
  ).size;
  const totalEmp = s.totalEmployees || 1;
  const checkinRate = Math.round((checkinDoneCount / totalEmp) * 100);
  document.getElementById('checkinRateFill').style.width = checkinRate + '%';
  document.getElementById('checkinRateLabel').textContent = checkinRate + '%';

  const alert = document.getElementById('adminNotSubmittedAlert');
  if (alert) {
    const n = s.notSubmitted ?? 0;
    alert.innerHTML = `<strong>${n} employee(s)</strong> have not submitted goals yet.`;
  }

  const chip = document.getElementById('adminEscalationChip');
  if (chip) chip.textContent = `${activeEscalations} Active`;
}

async function renderCompletionTable(dash, teamCheckins) {
  const tbody = document.getElementById('completionTable');
  if (!tbody) return;

  let employees = allUsers.filter((u) => u.role === 'employee');
  if (!employees.length) {
    try {
      const res = await Auth.listUsers();
      allUsers = res.users || res;
      employees = allUsers.filter((u) => u.role === 'employee');
    } catch (_) { /* keep empty */ }
  }

  if (!employees.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No employee data available</td></tr>';
    return;
  }

  const notSubmittedIds = new Set((dash.notSubmitted || []).map((u) => String(u.id || u._id)));
  const normEmail = (e) => (e || '').toLowerCase().trim();
  const pendingUserEmails = new Set(
    (dash.pendingApproval || []).map((p) => normEmail(p.email)).filter(Boolean),
  );
  const checkinDoneNames = new Set();
  (teamCheckins || []).forEach((row) => {
    if (row.actualValue != null && row.actualValue !== '') {
      checkinDoneNames.add(row.employeeName);
    }
  });

  const yn = (ok) => (ok
    ? '<span style="color:var(--success);font-weight:700">Yes</span>'
    : '<span style="color:var(--text-muted)">No</span>');

  tbody.innerHTML = employees.map((emp) => {
    const id = String(emp._id || emp.id);
    const name = emp.name;
    const email = normEmail(emp.email);
    const submitted = !notSubmittedIds.has(id);
    const approved = submitted && email && !pendingUserEmails.has(email);
    const checkinDone = checkinDoneNames.has(name);
    const doneCount = [submitted, approved, checkinDone].filter(Boolean).length;

    let statusChip;
    if (doneCount === 3) {
      statusChip = '<span class="chip green">Complete</span>';
    } else if (doneCount > 0) {
      statusChip = '<span class="chip orange">In Progress</span>';
    } else {
      statusChip = '<span class="chip" style="background:rgba(239,68,68,0.15);color:var(--danger)">Not Started</span>';
    }

    return `<tr>
      <td><strong>${esc(name)}</strong></td>
      <td>${esc(emp.department || '—')}</td>
      <td>${yn(submitted)}</td>
      <td>${yn(approved)}</td>
      <td>${yn(checkinDone)}</td>
      <td>${statusChip}</td>
    </tr>`;
  }).join('');
}

function renderEscalations(list) {
  const tbody = document.getElementById('escalationsTable');
  if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No escalations</td></tr>';
    return;
  }
  tbody.innerHTML = list.map((e) => {
    const resolved = !!e.resolved;
    const statusCls = resolved ? 'status-approved' : 'status-pending';
    const statusLabel = resolved ? 'Resolved' : 'Open';
    return `<tr>
      <td><strong>${esc(e.user?.name || '—')}</strong></td>
      <td><span class="status-badge status-pending">${esc((e.type || '').replace(/_/g, ' '))}</span></td>
      <td><span class="status-badge ${statusCls}">${statusLabel}</span></td>
      <td>${resolved ? '—' : `<div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-outline btn-sm" onclick="remindEscalation('${e._id}')">Remind</button>
        <button class="btn btn-outline btn-sm" onclick="resolveEscalation('${e._id}')">Resolve</button>
      </div>`}</td>
    </tr>`;
  }).join('');
}

function renderAuditTrail(logs) {
  auditTrailData = logs || [];
  const tbody = document.getElementById('auditTrailTable');
  if (!tbody) return;
  if (!auditTrailData.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No audit entries</td></tr>';
    return;
  }
  tbody.innerHTML = auditTrailData.map((l) => `
    <tr>
      <td>${fmtDate(l.createdAt)}</td>
      <td><strong>${esc(l.actor?.name || 'System')}</strong></td>
      <td>${esc(l.action)}</td>
      <td>${esc(l.entityType || '—')}</td>
    </tr>`).join('');
}

function exportAuditTrail() {
  if (!auditTrailData.length) {
    showToast('No audit data to export', 'danger');
    return;
  }
  const headers = ['Timestamp', 'Actor', 'Action', 'Entity Type'];
  const rows = auditTrailData.map((l) => [
    l.createdAt ? fmtDate(l.createdAt) : '',
    l.actor?.name || 'System',
    l.action || '',
    l.entityType || '',
  ]);
  const csv = [headers, ...rows].map((r) => r.join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv,' + encodeURIComponent(csv);
  a.download = 'audit-trail.csv';
  a.click();
  showToast('Audit trail exported');
}

async function resolveEscalation(id) {
  try {
    await Admin.resolveEscalation(id);
    showToast('Escalation resolved.');
    await loadAdminDashboard();
  } catch (err) { showToast(err.message, 'danger'); }
}

async function triggerEscalationScan() {
  try {
    const res = await Admin.triggerScan();
    showToast(res.message || 'Scan complete');
    await loadAdminDashboard();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function remindEscalation(id) {
  try {
    const res = await Admin.notifyEscalation(id);
    showToast('Reminder sent. Notified ' + (res.notifiedCount ?? 0) + ' time(s).');
    await loadAdminDashboard();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

// ─── Cycle config ────────────────────────────────────────────────────────────
function toDateInput(d) {
  if (!d) return '';
  return new Date(d).toISOString().slice(0, 10);
}

function populateCycleForm(cycle) {
  if (!cycle) return;
  activeCycle = cycle;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
  set('cycleName', cycle.name);
  set('cycleStatus', cycle.status || 'active');
  set('cycleGoalOpen', toDateInput(cycle.goalOpenDate));
  set('cycleGoalClose', toDateInput(cycle.goalCloseDate));
  set('cycleQ1Open', toDateInput(cycle.q1Open));
  set('cycleQ2Open', toDateInput(cycle.q2Open));
  set('cycleQ3Open', toDateInput(cycle.q3Open));
  set('cycleQ4Open', toDateInput(cycle.q4Open));
  set('cycleEscalation', cycle.escalationDays ?? 5);
  set('cycleIdHidden', cycle._id);
  const alert = document.getElementById('cycleActiveAlert');
  if (alert) {
    alert.innerHTML = `<i class="fa fa-info-circle"></i> Currently active cycle: <strong>${esc(cycle.name)}</strong> (${esc(cycle.status)})`;
  }
}

async function loadSharedRecipients() {
  const sel = document.getElementById('sharedRecipients');
  if (!sel) return;
  sel.innerHTML = LOADING_HTML;
  try {
    const res = await Auth.listUsers();
    allUsers = res.users || res;
    sel.innerHTML = allUsers
      .filter((u) => u.role === 'employee')
      .map((u) => `<option value="${u._id || u.id}">${esc(u.name)} (${esc(u.department || '—')})</option>`)
      .join('');
  } catch (err) {
    showToast(err.message, 'danger');
    sel.innerHTML = '<option value="">Unable to load recipients</option>';
  }
}

async function loadCycleConfig() {
  showPageError('cycle-config', null);
  const status = document.getElementById('cycleConfigStatus');
  if (status) status.innerHTML = LOADING_HTML;
  try {
    const { cycle } = await Admin.activeCycle();
    populateCycleForm(cycle);
    if (status) status.innerHTML = '';
  } catch (err) {
    showPageError('cycle-config', err.message);
    showToast(err.message, 'danger');
    if (status) status.innerHTML = '<p style="color:var(--text-muted);padding:20px">Unable to load cycle configuration</p>';
  }
  await loadSharedRecipients();
}

async function saveCycleConfig() {
  const id = document.getElementById('cycleIdHidden')?.value;
  if (!id) {
    showToast('No active cycle loaded.', 'danger');
    return;
  }
  const payload = {
    name: document.getElementById('cycleName').value.trim(),
    status: document.getElementById('cycleStatus').value,
    goalOpenDate: document.getElementById('cycleGoalOpen').value,
    goalCloseDate: document.getElementById('cycleGoalClose').value,
    q1Open: document.getElementById('cycleQ1Open').value || null,
    q2Open: document.getElementById('cycleQ2Open').value || null,
    q3Open: document.getElementById('cycleQ3Open').value || null,
    q4Open: document.getElementById('cycleQ4Open').value || null,
    escalationDays: parseInt(document.getElementById('cycleEscalation').value, 10),
  };
  try {
    const { cycle } = await Admin.updateCycle(id, payload);
    populateCycleForm(cycle);
    showToast('Cycle configuration saved!');
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

function openNewCycleModal() {
  const errEl = document.getElementById('newCycleModalError');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  const today = new Date().toISOString().slice(0, 10);
  const close = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
  document.getElementById('newCycleName').value = '';
  document.getElementById('newCycleGoalOpen').value = today;
  document.getElementById('newCycleGoalClose').value = close;
  document.getElementById('newCycleQ1Open').value = '';
  document.getElementById('newCycleQ2Open').value = '';
  document.getElementById('newCycleQ3Open').value = '';
  document.getElementById('newCycleQ4Open').value = '';
  document.getElementById('newCycleEscalation').value = '5';
  document.getElementById('newCycleStatus').value = 'draft';
  showModal('newCycleModal');
}

async function submitNewCycle() {
  const errEl = document.getElementById('newCycleModalError');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

  const name = document.getElementById('newCycleName')?.value?.trim();
  const goalOpenDate = document.getElementById('newCycleGoalOpen')?.value;
  const goalCloseDate = document.getElementById('newCycleGoalClose')?.value;
  if (!name || !goalOpenDate || !goalCloseDate) {
    showToast('Name and goal dates are required.', 'danger');
    return;
  }

  const payload = {
    name,
    goalOpenDate,
    goalCloseDate,
    q1Open: document.getElementById('newCycleQ1Open')?.value || undefined,
    q2Open: document.getElementById('newCycleQ2Open')?.value || undefined,
    q3Open: document.getElementById('newCycleQ3Open')?.value || undefined,
    q4Open: document.getElementById('newCycleQ4Open')?.value || undefined,
    escalationDays: parseInt(document.getElementById('newCycleEscalation')?.value, 10) || 5,
    status: document.getElementById('newCycleStatus')?.value || 'draft',
  };

  try {
    const { cycle } = await Admin.createCycle(payload);
    closeModal('newCycleModal');
    showToast('Cycle created!');
    populateCycleForm(cycle);
    await loadSharedRecipients();
  } catch (err) {
    showToast(err.message, 'danger');
    if (errEl) {
      errEl.textContent = err.message || 'Failed to create cycle';
      errEl.style.display = 'block';
    }
  }
}

async function pushSharedGoal() {
  const sel = document.getElementById('sharedRecipients');
  const recipientUserIds = Array.from(sel?.selectedOptions || []).map((o) => o.value);
  if (!recipientUserIds.length) {
    showToast('Select at least one recipient', 'danger');
    return;
  }

  const thrustArea = document.getElementById('sharedThrust')?.value.trim();
  const title = document.getElementById('sharedTitle')?.value?.trim();
  const description = document.getElementById('sharedDesc')?.value?.trim() || '';
  const uomType = document.getElementById('sharedUoM')?.value;
  const targetValue = document.getElementById('sharedTarget')?.value?.trim();
  const cycleId = activeCycle?._id || document.getElementById('cycleIdHidden')?.value;

  if (!thrustArea || !title || !uomType || !targetValue) {
    showToast('Fill in thrust area, title, UoM, and target.', 'danger');
    return;
  }
  if (!cycleId) {
    showToast('No active cycle loaded.', 'danger');
    return;
  }

  try {
    const res = await Goals.pushShared({
      thrustArea,
      title,
      description,
      uomType,
      targetValue,
      recipientUserIds,
      cycleId,
    });
    const n = res.results?.length ?? recipientUserIds.length;
    showToast(res.message || `Shared goal pushed to ${n} employees.`);
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

// ─── Reports ─────────────────────────────────────────────────────────────────
function updateReportTitle(quarter) {
  const titleEl = document.getElementById('reportCardTitle');
  if (titleEl) titleEl.textContent = `Achievement Report — ${quarter}`;
}

function buildEmployeeReportRows(goals, quarter, managerName = '—', employeeName) {
  const name = employeeName ?? Auth.getUser()?.name;
  return (goals || []).map((g) => {
    const ach = getAchForQuarter(g, quarter);
    return {
      employeeName: name,
      managerName,
      goalTitle: g.title,
      title: g.title,
      thrustArea: g.thrustArea,
      uomType: g.uomType,
      targetValue: g.targetValue,
      actualValue: ach?.actualValue ?? null,
      score: ach?.score ?? 0,
      achievementStatus: ach?.status,
      status: ach?.status || 'not-started',
    };
  });
}

function normalizeReportRow(r) {
  return {
    employeeName: r.employeeName ?? '',
    managerName: r.managerName ?? '—',
    goalTitle: r.goalTitle || r.title || '',
    thrustArea: r.thrustArea ?? '',
    uomType: r.uomType ?? '',
    targetValue: r.targetValue ?? '',
    actualValue: r.actualValue != null && r.actualValue !== '' ? r.actualValue : '—',
    score: r.score ?? 0,
    status: r.achievementStatus || r.status || 'not-started',
  };
}

function getReportExportRows() {
  return reportData.map(normalizeReportRow);
}

async function populateReportFilters() {
  const deptSel = document.getElementById('reportDepartment');
  const mgrSel = document.getElementById('reportManagerId');
  if (!deptSel || !mgrSel) return;

  if (currentRole === 'employee') {
    deptSel.style.display = 'none';
    mgrSel.style.display = 'none';
    return;
  }

  deptSel.style.display = '';
  try {
    const res = await Auth.listUsers();
    const users = res.users || res;
    allUsers = users;

    const departments = [...new Set(
      users.filter((u) => u.role === 'employee' && u.department).map((u) => u.department),
    )].sort();
    const managers = users.filter((u) => u.role === 'manager').sort((a, b) => a.name.localeCompare(b.name));

    const deptVal = deptSel.value;
    deptSel.innerHTML = '<option value="">All Departments</option>'
      + departments.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('');
    if (deptVal) deptSel.value = deptVal;

    const mgrVal = mgrSel.value;
    if (currentRole === 'admin') {
      mgrSel.style.display = '';
      mgrSel.innerHTML = '<option value="">All Managers</option>'
        + managers.map((m) => `<option value="${esc(String(m._id || m.id))}">${esc(m.name)}</option>`).join('');
      if (mgrVal) mgrSel.value = mgrVal;
    } else {
      mgrSel.style.display = 'none';
    }
  } catch (_) { /* keep placeholder options */ }
}

async function loadReports() {
  const quarter = document.getElementById('reportQuarter')?.value || 'Q1';
  showPageError('reports', null);
  setContainerLoading('reportTableBody', 9);
  try {
    await populateReportFilters();

    const department = document.getElementById('reportDepartment')?.value || '';
    const manager_id = document.getElementById('reportManagerId')?.value || '';

    if (currentRole === 'employee') {
      const [sheet, meRes] = await Promise.all([
        Goals.mySheet(),
        Auth.me().catch(() => ({ user: Auth.getUser() })),
      ]);
      const meUser = meRes.user;
      const managerName = meUser?.manager?.name || '—';
      reportData = buildEmployeeReportRows(
        sheet.goals,
        quarter,
        managerName,
        meUser?.name,
      );
    } else {
      try {
        const reportOpts = { quarter };
        if (department) reportOpts.department = department;
        if (manager_id && currentRole === 'admin') reportOpts.manager_id = manager_id;
        const { report } = await Admin.report(reportOpts);
        reportData = (report || []).map((r) => ({
          employeeName: r.employeeName || '—',
          managerName: r.managerName || '—',
          goalTitle: r.goalTitle || r.title || '',
          thrustArea: r.thrustArea || '',
          uomType: r.uomType || '',
          targetValue: r.targetValue || '',
          actualValue: r.actualValue != null && r.actualValue !== '' ? r.actualValue : '—',
          score: r.score ?? 0,
          achievementStatus: r.achievementStatus || r.status || 'not-started',
          status: r.achievementStatus || r.status || 'not-started',
        }));
      } catch (reportErr) {
        const teamRes = await Achievements.team({ quarter });
        reportData = (teamRes.data || []).map((r) => ({
          employeeName: r.employeeName || '—',
          managerName: '—',
          goalTitle: r.title || '',
          thrustArea: r.thrustArea || '',
          uomType: r.uomType || '',
          targetValue: r.targetValue || '',
          actualValue: r.actualValue != null && r.actualValue !== '' ? r.actualValue : '—',
          score: r.score ?? 0,
          achievementStatus: r.status || 'not-started',
          status: r.status || 'not-started',
        }));
      }
    }
    renderReportTable();
    updateReportTitle(quarter);
  } catch (err) {
    reportData = [];
    showPageError('reports', err.message);
    showToast(err.message, 'danger');
    const tbody = document.getElementById('reportTableBody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:20px">Unable to load report</td></tr>';
    }
  }
}

function renderReportTable() {
  const tbody = document.getElementById('reportTableBody');
  if (!tbody) return;
  if (!reportData.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-muted)">No report data for this quarter</td></tr>';
    return;
  }
  tbody.innerHTML = reportData.map((r) => {
    const row = normalizeReportRow(r);
    const stCls = achStatusClass(row.status);
    const actual = row.actualValue === '—' ? '—' : esc(String(row.actualValue));
    return `<tr>
      <td><strong>${esc(row.employeeName)}</strong></td>
      <td>${esc(row.managerName)}</td>
      <td>${esc(row.goalTitle)}</td>
      <td><span class="chip blue">${esc(row.thrustArea)}</span></td>
      <td>${uomLabel(row.uomType)}</td>
      <td>${esc(row.targetValue)}</td>
      <td>${actual}</td>
      <td><span style="font-weight:700">${row.score}%</span></td>
      <td><span class="status-badge status-${stCls}">${esc(row.status.replace(/-/g, ' '))}</span></td>
    </tr>`;
  }).join('');
}

function exportReportCSV() {
  if (!reportData.length) { showToast('No data to export', 'danger'); return; }
  const headers = ['Employee', 'Manager', 'Goal', 'Thrust Area', 'UoM', 'Target', 'Actual', 'Score', 'Status'];
  const rows = getReportExportRows().map((r) => [
    r.employeeName,
    r.managerName,
    r.goalTitle,
    r.thrustArea,
    r.uomType,
    r.targetValue,
    r.actualValue,
    r.score,
    r.status,
  ]);
  const csv = [headers, ...rows].map((r) => r.join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv,' + encodeURIComponent(csv);
  a.download = 'achievement-report.csv';
  a.click();
}

function exportReportExcel() {
  if (!reportData.length) { showToast('No data to export', 'danger'); return; }
  if (typeof XLSX === 'undefined') { showToast('Excel library not loaded', 'danger'); return; }
  const data = getReportExportRows().map((r) => ({
    Employee: r.employeeName,
    Manager: r.managerName,
    Goal: r.goalTitle,
    'Thrust Area': r.thrustArea,
    UoM: r.uomType,
    Target: r.targetValue,
    Actual: r.actualValue,
    Score: r.score,
    Status: r.status,
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  XLSX.writeFile(wb, 'achievement-report.xlsx');
}

// ─── Analytics ───────────────────────────────────────────────────────────────
function renderManagerEffectivenessPlaceholder() {
  const tbody = document.getElementById('managerEffectivenessTable');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:20px">Manager metrics are available to managers and admins</td></tr>';
}

async function renderEmployeeQoqTrend(goals) {
  const container = document.getElementById('qoqTrend');
  if (!container) return;
  setContainerLoading('qoqTrend');
  try {
    const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
    const avgs = quarters.map((q) => {
      const scored = (goals || []).map((g) => getAchForQuarter(g, q).score || 0);
      if (!scored.length) return { q, avg: 0 };
      const avg = Math.round(scored.reduce((s, n) => s + n, 0) / scored.length);
      return { q, avg };
    });
    container.innerHTML = avgs.map(({ q, avg }) => `
    <div style="display:flex;align-items:center;gap:12px">
      <span style="min-width:24px;font-size:12px;color:var(--text-muted)">${q}</span>
      <div class="progress-bar" style="flex:1"><div class="progress-fill ${avg >= 70 ? 'high' : avg >= 40 ? 'medium' : 'low'}" style="width:${Math.min(avg, 100)}%"></div></div>
      <span style="font-weight:700;min-width:40px;font-size:13px">${avg ? avg + '%' : 'TBD'}</span>
    </div>`).join('');
  } catch (err) {
    showToast(err.message, 'danger');
    container.innerHTML = '<p style="color:var(--text-muted);padding:20px">Unable to load trend</p>';
  }
}

async function loadAnalytics() {
  showPageError('analytics', null);
  setContainerLoading('managerEffectivenessTable', 6);
  try {
    if (currentRole === 'employee') {
      const sheet = await Goals.mySheet();
      const sheetGoals = sheet.goals || [];
      const distributionGoals = rawGoals.length ? rawGoals : sheetGoals;
      renderGoalDistribution(distributionGoals);
      const uomData = sheetGoals.map((g) => ({ uomType: g.uomType }));
      renderUomBreakdown(uomData);
      await renderEmployeeQoqTrend(sheetGoals);
      renderManagerEffectivenessPlaceholder();
    } else {
      const { data } = await Achievements.team({ quarter: currentQuarter });
      managerTeamData = data || [];
      renderGoalDistribution(managerTeamData);
      renderUomBreakdown(managerTeamData);
      await renderQoqTrend();
      await renderManagerEffectiveness();
    }
  } catch (err) {
    showPageError('analytics', err.message);
    showToast(err.message, 'danger');
    const donut = document.getElementById('goalDistributionCard');
    if (donut) donut.innerHTML = '<p style="color:var(--text-muted);padding:20px">Unable to load analytics</p>';
    const uom = document.getElementById('uomBreakdown');
    if (uom) uom.innerHTML = '<p style="color:var(--text-muted);padding:20px">Unable to load analytics</p>';
    const qoq = document.getElementById('qoqTrend');
    if (qoq) qoq.innerHTML = '<p style="color:var(--text-muted);padding:20px">Unable to load trend</p>';
    const mgr = document.getElementById('managerEffectivenessTable');
    if (mgr) mgr.innerHTML = '<tr><td colspan="6" style="color:var(--text-muted);padding:20px">Unable to load</td></tr>';
  }
}

const DONUT_COLORS = ['#2563eb', '#10b981', '#f59e0b', '#f97316', '#8b5cf6', '#ef4444'];

function renderGoalDistribution(goalList) {
  const card = document.getElementById('goalDistributionCard');
  if (!card) return;
  if (!goalList?.length) {
    card.innerHTML = '<p style="color:var(--text-muted);padding:20px;text-align:center">No goal data available.</p>';
    return;
  }

  const counts = {};
  goalList.forEach((g) => {
    const area = g.thrustArea || 'Other';
    counts[area] = (counts[area] || 0) + 1;
  });

  const total = goalList.length;
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  let startPct = 0;
  const gradientParts = [];
  const legendItems = [];

  entries.forEach(([area, count], i) => {
    const color = DONUT_COLORS[i % DONUT_COLORS.length];
    const slicePct = (count / total) * 100;
    const endPct = i === entries.length - 1 ? 100 : startPct + slicePct;
    gradientParts.push(`${color} ${startPct}% ${endPct}%`);
    const labelPct = Math.round((count / total) * 100);
    legendItems.push(
      `<div class="legend-item"><div class="legend-dot" style="background:${color}"></div> ${esc(area)} (${labelPct}%)</div>`
    );
    startPct = endPct;
  });

  card.innerHTML = `
    <div class="donut-wrap">
      <div class="donut" style="background:conic-gradient(${gradientParts.join(', ')});border-radius:50%">
        <div style="width:70px;height:70px;background:var(--surface);border-radius:50%;position:absolute"></div>
        <div class="donut-center">
          <div class="val">${total}</div>
          <div class="lbl">Goals</div>
        </div>
      </div>
      <div class="donut-legend">${legendItems.join('')}</div>
    </div>`;
}

function renderUomBreakdown(data) {
  const container = document.getElementById('uomBreakdown');
  if (!container) return;
  const counts = {};
  data.forEach((g) => { counts[g.uomType] = (counts[g.uomType] || 0) + 1; });
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const labels = { min: 'Numeric (Min)', max: 'Numeric (Max)', percent: 'Percentage', timeline: 'Timeline', zero: 'Zero-based' };
  container.innerHTML = Object.entries(counts).map(([k, n]) => {
    const pct = Math.round((n / total) * 100);
    return `<div><div style="display:flex;justify-content:space-between;margin-bottom:4px">
      <span style="font-size:13px;font-weight:600">${labels[k] || k}</span><span style="font-weight:700">${pct}%</span></div>
      <div class="progress-bar"><div class="progress-fill high" style="width:${pct}%"></div></div></div>`;
  }).join('') || '<p>No data</p>';
}

async function renderQoqTrend() {
  const container = document.getElementById('qoqTrend');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--text-muted);padding:12px">Loading...</p>';
  try {
    const { qoqTrend } = await Admin.analytics();
    const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
    const map = {};
    (qoqTrend || []).forEach((t) => { map[t._id] = Math.round(t.avgScore || 0); });
    container.innerHTML = quarters.map((q) => {
      const avg = map[q] ?? null;
      const display = avg !== null ? avg + '%' : 'TBD';
      const cls = avg >= 70 ? 'high' : avg >= 40 ? 'medium' : 'low';
      return `<div style="display:flex;align-items:center;gap:12px">
        <span style="min-width:24px;font-size:12px;color:var(--text-muted)">${q}</span>
        <div class="progress-bar" style="flex:1"><div class="progress-fill ${cls}" style="width:${Math.min(avg || 0, 100)}%"></div></div>
        <span style="font-weight:700;min-width:40px;font-size:13px">${display}</span>
      </div>`;
    }).join('');
  } catch (err) {
    container.innerHTML = '<p style="color:var(--text-muted);padding:20px">Unable to load trend</p>';
  }
}

async function renderManagerEffectiveness() {
  const tbody = document.getElementById('managerEffectivenessTable');
  if (!tbody) return;
  setContainerLoading('managerEffectivenessTable', 6);
  const orgNote = ' <span style="font-size:11px;color:var(--text-muted)">(org avg)</span>';

  try {
    const [dash, teamRes, escRes, usersRes] = await Promise.all([
      Admin.dashboard(),
      Achievements.team({ quarter: currentQuarter }),
      Admin.escalations(),
      allUsers.length ? Promise.resolve({ users: allUsers }) : Auth.listUsers(),
    ]);

    allUsers = usersRes.users || usersRes;
    const teamData = teamRes.data || [];
    managerTeamData = teamData;
    const stats = dash.managerStats || [];
    const summary = dash.summary || {};
    const notSubmitted = dash.notSubmitted || [];
    const pendingApproval = dash.pendingApproval || [];
    const escalations = escRes.escalations || [];

    const orgApprovalRate = summary.approvalRate ?? (
      summary.submitted ? Math.round((summary.approved / summary.submitted) * 100) : 0
    );
    const orgAvgScore = teamData.length
      ? Math.round(teamData.reduce((s, r) => s + (r.score || 0), 0) / teamData.length)
      : 0;

    const allTeamEmpIds = [...new Set(
      stats.flatMap((m) => (m.teamIds || []).map((id) => String(id))),
    )];
    const hasCheckinByEmp = {};
    if (allTeamEmpIds.length) {
      await loadCheckinsForEmployees(allTeamEmpIds);
      allTeamEmpIds.forEach((empId) => {
        hasCheckinByEmp[empId] = (checkinsByEmpId[String(empId)] || []).length > 0;
      });
    }
    const orgCheckinDenom = allTeamEmpIds.length;
    const orgCheckinRate = orgCheckinDenom
      ? Math.round(
        allTeamEmpIds.filter((id) => hasCheckinByEmp[id]).length / orgCheckinDenom * 100,
      )
      : 0;

    if (!stats.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No manager data</td></tr>';
      return;
    }

    tbody.innerHTML = stats.map((m) => {
      const mgrId = String(m._id || m.id || '');
      const teamIdSet = new Set((m.teamIds || []).map((id) => String(id)));
      const teamNames = new Set();
      allUsers.forEach((u) => {
        if (u.role !== 'employee') return;
        const uid = String(u._id || u.id);
        const reportsTo = String(u.manager?._id || u.manager || '');
        if (teamIdSet.has(uid) || reportsTo === mgrId) teamNames.add(u.name);
      });

      const teamSize = m.teamSize || teamIdSet.size || 0;
      const empIds = [...teamIdSet];

      const teamNotSubmitted = notSubmitted.filter(
        (u) => teamIdSet.has(String(u.id || u._id)) || u.managerName === m.name,
      ).length;
      const teamPending = pendingApproval.filter((p) => teamNames.has(p.employeeName)).length;
      const teamSubmitted = Math.max(0, teamSize - teamNotSubmitted);
      const teamApproved = Math.max(0, teamSubmitted - teamPending);

      let approvalRate = teamSubmitted
        ? Math.round((teamApproved / teamSubmitted) * 100)
        : null;
      let approvalHtml = approvalRate != null
        ? `<span style="color:var(--success);font-weight:700">${approvalRate}%</span>`
        : `<span style="color:var(--success);font-weight:700">${orgApprovalRate}%</span>${orgNote}`;

      const withCheckin = empIds.filter((id) => hasCheckinByEmp[id]).length;
      let checkinRate = empIds.length ? Math.round((withCheckin / empIds.length) * 100) : null;
      let checkinHtml = checkinRate != null
        ? `${checkinRate}%`
        : `${orgCheckinRate}%${orgNote}`;

      const teamRows = teamData.filter((r) => teamNames.has(r.employeeName));
      const teamAvgScore = teamRows.length
        ? Math.round(teamRows.reduce((s, r) => s + (r.score || 0), 0) / teamRows.length)
        : null;
      const scoreHtml = teamAvgScore != null
        ? `<span style="font-weight:700">${teamAvgScore}%</span>`
        : `<span style="font-weight:700">${orgAvgScore}%</span>${orgNote}`;

      const escCount = escalations.filter((e) => {
        if (e.resolved) return false;
        const uid = String(e.user?._id || e.user || '');
        return teamIdSet.has(uid);
      }).length;
      const escCls = escCount ? 'orange' : 'green';

      return `
      <tr>
        <td><strong>${esc(m.name)}</strong></td>
        <td>${teamSize}</td>
        <td>${approvalHtml}</td>
        <td>${checkinHtml}</td>
        <td>${scoreHtml}</td>
        <td><span class="chip ${escCls}">${escCount}</span></td>
      </tr>`;
    }).join('');
  } catch (err) {
    showToast(err.message, 'danger');
    tbody.innerHTML = '<tr><td colspan="6" style="color:var(--text-muted);padding:20px">Unable to load</td></tr>';
  }
}

// ─── Modals / Toast ────────────────────────────────────────────────────────────
function showModal(id) {
  if (id === 'checkinModal') populateCheckinModal();
  document.getElementById(id)?.classList.add('show');
}
function closeModal(id) { document.getElementById(id)?.classList.remove('show'); }

document.querySelectorAll('.modal-overlay').forEach((m) => {
  m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('show'); });
});

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  t.style.background = type === 'danger' ? 'var(--danger)' : 'var(--success)';
  t.style.display = 'flex';
  setTimeout(() => { t.style.display = 'none'; }, 3000);
}

// ─── Init ────────────────────────────────────────────────────────────────────
function initThemes() {
  if (typeof setTheme === 'function') {
    const saved = localStorage.getItem('gt_theme') || 'dark';
    setTheme(saved);
  }
}

async function initApp() {
  initThemes();
  const checkinEmp = document.getElementById('checkinEmployee');
  if (checkinEmp) checkinEmp.addEventListener('change', updateCheckinGoals);

  if (Auth.isLoggedIn()) {
    try {
      const user = Auth.getUser();
      if (user) {
        currentRole = user.role;
        document.getElementById('loginPage').style.display = 'none';
        document.getElementById('app').style.display = 'block';
        setupUser();
        setupNav();
        await navigateTo(currentRole + '-dashboard');
      }
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }
}

// Global exports
window.selectRole = selectRole;
window.doLogin = doLogin;
window.loadMySheet = loadMySheet;
window.doLogout = doLogout;
window.navigateTo = navigateTo;
window.addGoal = addGoal;
window.submitGoals = submitGoals;
window.saveAchievement = saveAchievement;
window.openAchieve = openAchieve;
window.openEditGoal = openEditGoal;
window.saveEditGoal = saveEditGoal;
window.deleteGoal = deleteGoal;
window.unlockGoal = unlockGoal;
window.approveSheet = approveSheet;
window.returnSheet = returnSheet;
window.viewSheetGoals = viewSheetGoals;
window.toggleInlineEdit = toggleInlineEdit;
window.saveCheckin = saveCheckin;
window.updateCheckinGoals = updateCheckinGoals;
window.viewEmployeeCheckins = viewEmployeeCheckins;
window.resolveEscalation = resolveEscalation;
window.triggerEscalationScan = triggerEscalationScan;
window.remindEscalation = remindEscalation;
window.saveCycleConfig = saveCycleConfig;
window.openNewCycleModal = openNewCycleModal;
window.submitNewCycle = submitNewCycle;
window.pushSharedGoal = pushSharedGoal;
window.exportReportCSV = exportReportCSV;
window.exportReportExcel = exportReportExcel;
window.exportAuditTrail = exportAuditTrail;
window.loadReports = loadReports;
window.showModal = showModal;
window.closeModal = closeModal;
window.showToast = showToast;
window.setManagerQuarter = setManagerQuarter;
window.loadManagerDashboard = loadManagerDashboard;
window.loadAdminEmployeeGoals = loadAdminEmployeeGoals;
window.unlockGoalAndRefresh = unlockGoalAndRefresh;

initApp();
