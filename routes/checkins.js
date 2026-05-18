// routes/checkins.js — Manager/admin launches check-ins; employees complete by deadline
const express = require('express');
const User = require('../models/User');
const Cycle = require('../models/Cycle');
const { Goal, GoalSheet } = require('../models/Goal');
const { CheckInPeriod, CheckInAssignment } = require('../models/CheckInPeriod');
const { authenticate, authorize, logAudit } = require('../middleware/auth');
const {
  getScheduleForCycle,
  getPhaseMeta,
  resolveRuntimeContext,
  canLaunchPhase,
  defaultSuggestedDeadline,
  resolveWindowOpen,
} = require('../lib/checkinSchedule');
const {
  isEmployeeAssignmentComplete,
  refreshAssignmentStatuses,
} = require('../lib/checkinAssignments');

const router = express.Router();

async function getTeamEmployeeIds(user) {
  if (user.role === 'admin') {
    const emps = await User.find({ role: 'employee' }).select('_id');
    return emps.map((e) => e._id);
  }
  const emps = await User.find({ role: 'employee', manager: user._id }).select('_id');
  return emps.map((e) => e._id);
}

async function employeesForPhase(cycleId, phase, employeeIds) {
  if (phase === 'goal_setting') {
    const submitted = await GoalSheet.find({
      cycle: cycleId,
      user: { $in: employeeIds },
      status: { $in: ['submitted', 'approved'] },
    }).select('user');
    const done = new Set(submitted.map((s) => String(s.user)));
    return employeeIds.filter((id) => !done.has(String(id)));
  }
  const approved = await GoalSheet.find({
    cycle: cycleId,
    user: { $in: employeeIds },
    status: 'approved',
  }).select('user');
  return approved.map((s) => s.user);
}

// ─── GET /api/checkins/schedule ─────────────────────────────────────────────
router.get('/schedule', authenticate, async (req, res) => {
  try {
    let cycleId = req.query.cycle_id;
    if (!cycleId) {
      const active = await Cycle.getActive();
      if (!active) return res.status(404).json({ error: 'No active cycle.' });
      cycleId = active._id;
    }
    const cycle = await Cycle.findById(cycleId);
    if (!cycle) return res.status(404).json({ error: 'Cycle not found.' });

    const now = new Date();
    const schedule = getScheduleForCycle(cycle, now);
    const periodDocs = await CheckInPeriod.find({ cycle: cycleId }).populate('launchedBy', 'name role');
    const periodMap = {};
    periodDocs.forEach((p) => { periodMap[p.phase] = p; });

    const phases = await Promise.all(schedule.map(async (s) => {
      const period = periodMap[s.phase];
      let stats = null;
      if (period) {
        await refreshAssignmentStatuses(period._id);
        const assignments = await CheckInAssignment.find({ period: period._id });
        stats = {
          total: assignments.length,
          submitted: assignments.filter((a) => a.status === 'submitted').length,
          pending: assignments.filter((a) => a.status === 'pending').length,
          overdue: assignments.filter((a) => a.status === 'overdue').length,
        };
      }

      let runtimeStatus = s.calendarStatus;
      if (period?.status === 'active') runtimeStatus = 'launched_active';
      else if (period?.status === 'closed') runtimeStatus = 'launched_closed';

      return {
        ...s,
        windowOpens: s.windowOpens || null,
        windowCloses: s.windowCloses || null,
        suggestedDeadline: s.suggestedDeadline || null,
        runtimeStatus,
        launched: !!period && period.status === 'active',
        period: period
          ? {
              _id: period._id,
              status: period.status,
              deadline: period.deadline,
              launchedAt: period.launchedAt,
              launchedBy: period.launchedBy,
              scope: period.scope,
            }
          : null,
        stats,
      };
    }));

    const activePeriods = periodDocs.filter((p) => p.status === 'active');
    const runtime = resolveRuntimeContext(schedule, activePeriods, now);

    res.json({
      cycle,
      phases,
      serverNow: now.toISOString(),
      currentPhase: runtime.phase,
      currentQuarter: runtime.quarter,
      runtimeSource: runtime.source,
      activeLaunchedPeriod: runtime.activePeriod
        ? {
            _id: runtime.activePeriod._id,
            phase: runtime.activePeriod.phase,
            title: runtime.activePeriod.title,
            deadline: runtime.activePeriod.deadline,
          }
        : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/checkins/periods — manager/admin ──────────────────────────────
router.get('/periods', authenticate, authorize('manager', 'admin'), async (req, res) => {
  try {
    let cycleId = req.query.cycle_id;
    if (!cycleId) {
      const active = await Cycle.getActive();
      cycleId = active?._id;
    }
    const filter = cycleId ? { cycle: cycleId } : {};
    const periods = await CheckInPeriod.find(filter)
      .populate('launchedBy', 'name email role')
      .sort({ launchedAt: -1 });

    const enriched = await Promise.all(periods.map(async (p) => {
      await refreshAssignmentStatuses(p._id);
      const assignments = await CheckInAssignment.find({ period: p._id })
        .populate('employee', 'name email department');
      return {
        period: p,
        assignments,
        stats: {
          total: assignments.length,
          submitted: assignments.filter((a) => a.status === 'submitted').length,
          pending: assignments.filter((a) => a.status === 'pending').length,
          overdue: assignments.filter((a) => a.status === 'overdue').length,
        },
      };
    }));

    res.json({ periods: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/checkins/launch — manager/admin triggers employee tasks ──────
router.post('/launch', authenticate, authorize('manager', 'admin'), async (req, res) => {
  try {
    const { cycle_id, phase, deadline } = req.body;
    if (!cycle_id || !phase) {
      return res.status(400).json({ error: 'cycle_id and phase are required.' });
    }

    const meta = getPhaseMeta(phase);
    if (!meta) return res.status(400).json({ error: 'Invalid phase.' });

    const cycle = await Cycle.findById(cycle_id);
    if (!cycle) return res.status(404).json({ error: 'Cycle not found.' });

    const now = new Date();
    const schedule = getScheduleForCycle(cycle, now);
    const launchCheck = canLaunchPhase(schedule, phase, now);
    if (!launchCheck.ok) return res.status(400).json({ error: launchCheck.error });

    const existing = await CheckInPeriod.findOne({ cycle: cycle_id, phase, status: 'active' });
    if (existing) {
      return res.status(409).json({
        error: `An active ${meta.label} is already running. Close it or wait until employees complete it.`,
        period: existing,
      });
    }

    const windowOpens = launchCheck.row.windowOpens || resolveWindowOpen(cycle, meta);
    const deadlineDate = deadline
      ? new Date(deadline)
      : defaultSuggestedDeadline(windowOpens, launchCheck.row.windowCloses, phase);
    if (deadlineDate <= new Date()) {
      return res.status(400).json({ error: 'Deadline must be in the future.' });
    }

    const empIds = await getTeamEmployeeIds(req.user);
    const targetIds = await employeesForPhase(cycle_id, phase, empIds);
    if (!targetIds.length) {
      return res.status(400).json({
        error: phase === 'goal_setting'
          ? 'All employees in scope have already submitted goal sheets.'
          : 'No employees with approved goal sheets in scope.',
      });
    }

    const period = await CheckInPeriod.create({
      cycle: cycle_id,
      phase,
      title: meta.label,
      action: meta.action,
      windowOpens,
      deadline: deadlineDate,
      launchedBy: req.user._id,
      scope: req.user.role === 'manager' ? 'team' : 'all',
    });

    const assignments = await Promise.all(
      targetIds.map((employeeId) => CheckInAssignment.create({
        period: period._id,
        employee: employeeId,
        notifiedAt: new Date(),
      })),
    );

    logAudit(
      req.user._id,
      'CHECKIN_LAUNCHED',
      'cycle',
      cycle_id,
      null,
      { phase, title: meta.label, employees: assignments.length, deadline: deadlineDate },
      req.ip,
    );

    res.status(201).json({
      message: `${meta.label} launched for ${assignments.length} employee(s). They have been notified to complete by ${deadlineDate.toLocaleDateString()}.`,
      period,
      assignmentCount: assignments.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /api/checkins/periods/:id/close ──────────────────────────────────
router.patch('/periods/:id/close', authenticate, authorize('manager', 'admin'), async (req, res) => {
  try {
    const period = await CheckInPeriod.findById(req.params.id);
    if (!period) return res.status(404).json({ error: 'Check-in period not found.' });
    period.status = 'closed';
    await period.save();
    res.json({ message: 'Check-in period closed.', period });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/checkins/my-assignments — employee tasks ──────────────────────
router.get('/my-assignments', authenticate, authorize('employee'), async (req, res) => {
  try {
    const assignments = await CheckInAssignment.find({
      employee: req.user._id,
      status: { $in: ['pending', 'overdue'] },
    })
      .populate({
        path: 'period',
        populate: { path: 'launchedBy', select: 'name role' },
      })
      .sort({ createdAt: -1 });

    const now = new Date();
    const active = [];
    for (const a of assignments) {
      const period = a.period;
      if (!period || period.status !== 'active') continue;
      if (now > period.deadline) {
        a.status = 'overdue';
        await a.save();
      }
      const complete = await isEmployeeAssignmentComplete(req.user._id, period);
      if (complete) {
        a.status = 'submitted';
        a.submittedAt = new Date();
        await a.save();
        continue;
      }
      active.push(a);
    }

    res.json({ assignments: active });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/checkins/active-for-me?phase=Q1 — can employee submit now? ───
router.get('/active-for-me', authenticate, authorize('employee'), async (req, res) => {
  try {
    const { phase, cycle_id } = req.query;
    if (!phase) return res.status(400).json({ error: 'phase is required.' });

    let cycleId = cycle_id;
    if (!cycleId) {
      const active = await Cycle.getActive();
      cycleId = active?._id;
    }

    const period = await CheckInPeriod.findOne({
      cycle: cycleId,
      phase,
      status: 'active',
    });
    if (!period) {
      return res.json({ allowed: false, reason: 'Check-in has not been launched by your manager or HR yet.' });
    }

    const assignment = await CheckInAssignment.findOne({
      period: period._id,
      employee: req.user._id,
    });
    if (!assignment) {
      return res.json({ allowed: false, reason: 'You are not on the list for this check-in round.' });
    }
    if (assignment.status === 'submitted') {
      return res.json({ allowed: false, reason: 'You have already completed this check-in.', assignment, period });
    }
    if (new Date() > period.deadline) {
      return res.json({ allowed: false, reason: 'The deadline for this check-in has passed.', assignment, period });
    }

    res.json({ allowed: true, assignment, period });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.isEmployeeAssignmentComplete = isEmployeeAssignmentComplete;
module.exports.refreshAssignmentStatuses = refreshAssignmentStatuses;
