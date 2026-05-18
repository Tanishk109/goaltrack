// lib/checkinSchedule.js — Schedule aligned with HR check-in calendar
const PHASE_META = [
  {
    phase: 'goal_setting',
    label: 'Phase 1 — Goal Setting',
    action: 'Goal Creation, Submission & Approval',
    openKey: 'goalOpenDate',
    closeKey: 'goalCloseDate',
    defaultMonth: 5,
    defaultDay: 1,
  },
  {
    phase: 'Q1',
    label: 'Q1 Check-in',
    action: 'Progress Update — Planned vs. Actual',
    openKey: 'q1Open',
    defaultMonth: 7,
    defaultDay: 1,
  },
  {
    phase: 'Q2',
    label: 'Q2 Check-in',
    action: 'Progress Update — Planned vs. Actual',
    openKey: 'q2Open',
    defaultMonth: 10,
    defaultDay: 1,
  },
  {
    phase: 'Q3',
    label: 'Q3 Check-in',
    action: 'Progress Update — Planned vs. Actual',
    openKey: 'q3Open',
    defaultMonth: 1,
    defaultDay: 1,
  },
  {
    phase: 'Q4',
    label: 'Q4 / Annual',
    action: 'Final Achievement Capture',
    openKey: 'q4Open',
    defaultMonth: 3,
    defaultDay: 1,
  },
];

function fyYearFromCycle(cycle) {
  if (cycle?.goalOpenDate) return new Date(cycle.goalOpenDate).getFullYear();
  return new Date().getFullYear();
}

function defaultOpenDate(cycle, meta) {
  const y = fyYearFromCycle(cycle);
  let year = y;
  if (meta.phase === 'Q3' || meta.phase === 'Q4') year = y + 1;
  return new Date(year, meta.defaultMonth - 1, meta.defaultDay);
}

function resolveWindowOpen(cycle, meta) {
  const stored = meta.openKey && cycle?.[meta.openKey];
  if (stored) return new Date(stored);
  return defaultOpenDate(cycle, meta);
}

function defaultDeadline(openDate, phase) {
  const d = new Date(openDate);
  if (phase === 'goal_setting') {
    d.setMonth(d.getMonth() + 1);
    d.setDate(30);
  } else if (phase === 'Q4') {
    d.setMonth(d.getMonth() + 1);
    d.setDate(30);
  } else {
    d.setDate(d.getDate() + 30);
  }
  return d;
}

function getScheduleForCycle(cycle) {
  return PHASE_META.map((meta) => {
    const windowOpens = resolveWindowOpen(cycle, meta);
    const windowCloses = meta.closeKey && cycle?.[meta.closeKey]
      ? new Date(cycle[meta.closeKey])
      : defaultDeadline(windowOpens, meta.phase);
    return {
      phase: meta.phase,
      label: meta.label,
      action: meta.action,
      windowOpens,
      windowCloses,
      suggestedDeadline: defaultDeadline(windowOpens, meta.phase),
    };
  });
}

function getPhaseMeta(phase) {
  return PHASE_META.find((p) => p.phase === phase);
}

module.exports = {
  PHASE_META,
  getScheduleForCycle,
  getPhaseMeta,
  defaultDeadline,
  resolveWindowOpen,
};
