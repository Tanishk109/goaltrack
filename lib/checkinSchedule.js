// lib/checkinSchedule.js — Schedule from cycle config + real-time phase detection (no fixed calendar months)

const PHASE_META = [
  {
    phase: 'goal_setting',
    label: 'Phase 1 — Goal Setting',
    action: 'Goal Creation, Submission & Approval',
    openKey: 'goalOpenDate',
    closeKey: 'goalCloseDate',
  },
  {
    phase: 'Q1',
    label: 'Q1 Check-in',
    action: 'Progress Update — Planned vs. Actual',
    openKey: 'q1Open',
  },
  {
    phase: 'Q2',
    label: 'Q2 Check-in',
    action: 'Progress Update — Planned vs. Actual',
    openKey: 'q2Open',
  },
  {
    phase: 'Q3',
    label: 'Q3 Check-in',
    action: 'Progress Update — Planned vs. Actual',
    openKey: 'q3Open',
  },
  {
    phase: 'Q4',
    label: 'Q4 / Annual',
    action: 'Final Achievement Capture',
    openKey: 'q4Open',
  },
];

const QUARTER_PHASES = ['Q1', 'Q2', 'Q3', 'Q4'];

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** End of phase: explicit close on cycle, or day before next phase opens, or +30 days after open. */
function resolveWindowClose(cycle, meta, index, windowOpens) {
  if (meta.closeKey && cycle?.[meta.closeKey]) {
    return parseDate(cycle[meta.closeKey]);
  }
  const next = PHASE_META[index + 1];
  if (next?.openKey && cycle?.[next.openKey]) {
    const nextOpen = parseDate(cycle[next.openKey]);
    if (nextOpen) {
      const end = new Date(nextOpen);
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
      return end;
    }
  }
  if (!windowOpens) return null;
  const end = new Date(windowOpens);
  end.setDate(end.getDate() + (meta.phase === 'goal_setting' ? 60 : 30));
  return end;
}

function resolveWindowOpen(cycle, meta) {
  if (meta.openKey && cycle?.[meta.openKey]) {
    return parseDate(cycle[meta.openKey]);
  }
  return null;
}

function defaultSuggestedDeadline(windowOpens, windowCloses, phase) {
  if (windowCloses) return new Date(windowCloses);
  if (!windowOpens) return null;
  const d = new Date(windowOpens);
  d.setDate(d.getDate() + (phase === 'goal_setting' ? 45 : 30));
  return d;
}

function getCalendarStatus(windowOpens, windowCloses, now = new Date()) {
  if (!windowOpens) return 'unconfigured';
  const t = now.getTime();
  const start = windowOpens.getTime();
  const end = windowCloses ? windowCloses.getTime() : null;
  if (t < start) return 'upcoming';
  if (end != null && t > end) return 'past';
  return 'open';
}

/**
 * Which phase the calendar says is active right now (ignores manager launch).
 */
function inferCurrentPhase(phases, now = new Date()) {
  if (!phases?.length) return { phase: null, quarter: null };

  for (const p of phases) {
    if (!p.windowOpens) continue;
    const start = new Date(p.windowOpens).getTime();
    const end = p.windowCloses ? new Date(p.windowCloses).getTime() : null;
    const t = now.getTime();
    if (t >= start && (end == null || t <= end)) {
      const quarter = QUARTER_PHASES.includes(p.phase) ? p.phase : null;
      return { phase: p.phase, quarter: quarter || inferQuarterFallback(phases, now) };
    }
  }

  const withDates = phases.filter((p) => p.windowOpens);
  if (!withDates.length) return { phase: null, quarter: null };

  const t = now.getTime();
  if (t < new Date(withDates[0].windowOpens).getTime()) {
    return { phase: 'goal_setting', quarter: null };
  }

  const lastStarted = [...withDates].reverse().find((p) => new Date(p.windowOpens).getTime() <= t);
  if (lastStarted) {
    const quarter = QUARTER_PHASES.includes(lastStarted.phase) ? lastStarted.phase : null;
    return { phase: lastStarted.phase, quarter };
  }

  return { phase: null, quarter: null };
}

function inferQuarterFallback(phases, now) {
  const quarters = phases.filter((p) => QUARTER_PHASES.includes(p.phase) && p.windowOpens);
  for (let i = quarters.length - 1; i >= 0; i--) {
    if (new Date(quarters[i].windowOpens) <= now) return quarters[i].phase;
  }
  return quarters[0]?.phase || null;
}

/** Prefer an active launched check-in period over calendar-only state. */
function resolveRuntimeContext(phases, activePeriods, now = new Date()) {
  const calendar = inferCurrentPhase(phases, now);
  const launched = (activePeriods || []).filter((p) => p.status === 'active');
  const activeLaunch = launched.sort(
    (a, b) => new Date(b.launchedAt || 0) - new Date(a.launchedAt || 0),
  )[0];

  if (activeLaunch) {
    const quarter = QUARTER_PHASES.includes(activeLaunch.phase) ? activeLaunch.phase : null;
    return {
      phase: activeLaunch.phase,
      quarter,
      source: 'launch',
      activePeriod: activeLaunch,
      calendar,
    };
  }

  return {
    phase: calendar.phase,
    quarter: calendar.quarter,
    source: 'calendar',
    activePeriod: null,
    calendar,
  };
}

function getScheduleForCycle(cycle, now = new Date()) {
  const phases = PHASE_META.map((meta, index) => {
    const windowOpens = resolveWindowOpen(cycle, meta);
    const windowCloses = resolveWindowClose(cycle, meta, index, windowOpens);
    const calendarStatus = getCalendarStatus(windowOpens, windowCloses, now);

    return {
      phase: meta.phase,
      label: meta.label,
      action: meta.action,
      openKey: meta.openKey,
      windowOpens,
      windowCloses,
      suggestedDeadline: defaultSuggestedDeadline(windowOpens, windowCloses, meta.phase),
      configured: !!windowOpens,
      calendarStatus,
    };
  });

  return phases;
}

function getPhaseMeta(phase) {
  return PHASE_META.find((p) => p.phase === phase);
}

function canLaunchPhase(phases, phase, now = new Date()) {
  const row = phases.find((p) => p.phase === phase);
  if (!row) return { ok: false, error: 'Unknown phase.' };
  if (!row.configured || !row.windowOpens) {
    return { ok: false, error: 'This phase is not configured on the cycle. Set dates in Cycle Configuration.' };
  }
  if (row.calendarStatus === 'upcoming') {
    return {
      ok: false,
      error: `Calendar window opens ${row.windowOpens.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}.`,
    };
  }
  if (row.calendarStatus === 'past' && phase !== 'Q4') {
    return { ok: false, error: 'Calendar window for this phase has ended.' };
  }
  return { ok: true, row };
}

module.exports = {
  PHASE_META,
  QUARTER_PHASES,
  getScheduleForCycle,
  getPhaseMeta,
  getCalendarStatus,
  inferCurrentPhase,
  resolveRuntimeContext,
  canLaunchPhase,
  defaultSuggestedDeadline: defaultSuggestedDeadline,
  resolveWindowOpen,
};
