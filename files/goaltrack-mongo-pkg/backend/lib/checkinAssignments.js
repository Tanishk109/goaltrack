// lib/checkinAssignments.js — Shared check-in assignment logic (no route circular deps)
const { Goal, GoalSheet } = require('../models/Goal');
const { CheckInPeriod, CheckInAssignment } = require('../models/CheckInPeriod');

async function isEmployeeAssignmentComplete(employeeId, period) {
  if (period.phase === 'goal_setting') {
    const sheet = await GoalSheet.findOne({ user: employeeId, cycle: period.cycle });
    return sheet && ['submitted', 'approved'].includes(sheet.status);
  }
  const quarter = period.phase;
  const sheet = await GoalSheet.findOne({ user: employeeId, cycle: period.cycle, status: 'approved' });
  if (!sheet) return false;
  const goals = await Goal.find({ sheet: sheet._id });
  if (!goals.length) return false;
  return goals.every((g) => {
    const ach = g.achievements.find((a) => a.quarter === quarter);
    if (!ach) return false;
    if (ach.status && ach.status !== 'not-started') return true;
    return ach.actualValue != null && ach.actualValue !== '';
  });
}

async function refreshAssignmentStatuses(periodId) {
  const period = await CheckInPeriod.findById(periodId);
  if (!period) return;
  const now = new Date();
  const assignments = await CheckInAssignment.find({ period: periodId });
  for (const a of assignments) {
    if (a.status === 'submitted') continue;
    const complete = await isEmployeeAssignmentComplete(a.employee, period);
    if (complete) {
      a.status = 'submitted';
      a.submittedAt = new Date();
      await a.save();
    } else if (now > period.deadline) {
      a.status = 'overdue';
      await a.save();
    }
  }
}

function calendarWindowError(cycle, quarter) {
  const now = new Date();
  const windowMap = { Q1: cycle.q1Open, Q2: cycle.q2Open, Q3: cycle.q3Open, Q4: cycle.q4Open };
  const windowOpen = windowMap[quarter];
  if (windowOpen && now < new Date(windowOpen)) {
    return `${quarter} check-in window is not open yet. Opens: ${windowOpen}`;
  }
  return null;
}

async function validateAchievementCheckinAccess(employeeId, cycle, quarter, sheetStatus) {
  if (!cycle) return { ok: true };

  if (sheetStatus !== 'approved') {
    return {
      ok: false,
      error: 'Your goal sheet must be approved before updating achievements.',
    };
  }

  const period = await CheckInPeriod.findOne({
    cycle: cycle._id,
    phase: quarter,
    status: 'active',
  });

  if (!period) {
    const calErr = calendarWindowError(cycle, quarter);
    return calErr ? { ok: false, error: calErr } : { ok: true, mode: 'calendar' };
  }

  const assignment = await CheckInAssignment.findOne({
    period: period._id,
    employee: employeeId,
  });
  if (!assignment) {
    return { ok: false, error: 'You are not included in this check-in round.' };
  }
  if (assignment.status === 'submitted') {
    return { ok: false, error: 'You have already completed this check-in.' };
  }
  if (new Date() > period.deadline) {
    return {
      ok: false,
      error: `Check-in deadline was ${period.deadline.toLocaleDateString()}.`,
    };
  }
  return { ok: true, mode: 'campaign', period, assignment };
}

module.exports = {
  isEmployeeAssignmentComplete,
  refreshAssignmentStatuses,
  validateAchievementCheckinAccess,
};
