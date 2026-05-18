// routes/admin.js
const express  = require('express');
const Cycle    = require('../models/Cycle');
const User     = require('../models/User');
const { Goal, GoalSheet } = require('../models/Goal');
const AuditLog = require('../models/AuditLog');
const { Escalation } = require('../models/AuditLog');
const { authenticate, authorize, logAudit } = require('../middleware/auth');

const router = express.Router();

// ════════════════════════════════════════════════
// CYCLES
// ════════════════════════════════════════════════

router.get('/cycles', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const cycles = await Cycle.find().populate('createdBy', 'name').sort({ createdAt: -1 });
    res.json({ cycles });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/cycles/active', authenticate, async (req, res) => {
  try {
    const cycle = await Cycle.getActive();
    if (!cycle) return res.status(404).json({ error: 'No active cycle.' });
    res.json({ cycle });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/cycles', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { name, goalOpenDate, goalCloseDate, q1Open, q2Open, q3Open, q4Open, escalationDays } = req.body;
    if (!name || !goalOpenDate || !goalCloseDate)
      return res.status(400).json({ error: 'name, goalOpenDate, goalCloseDate required.' });

    const cycle = await Cycle.create({
      name, goalOpenDate, goalCloseDate,
      q1Open, q2Open, q3Open, q4Open,
      escalationDays: escalationDays || 5,
      createdBy: req.user._id,
    });

    logAudit(req.user._id, 'CYCLE_CREATED', 'cycle', cycle._id, null, { name }, req.ip);
    res.status(201).json({ message: 'Cycle created.', cycle });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/cycles/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const old = await Cycle.findById(req.params.id);
    if (!old) return res.status(404).json({ error: 'Cycle not found.' });

    const { name, goalOpenDate, goalCloseDate, q1Open, q2Open, q3Open, q4Open, escalationDays, status } = req.body;
    const updatePayload = {};
    if (name           !== undefined) updatePayload.name           = name;
    if (goalOpenDate   !== undefined) updatePayload.goalOpenDate   = goalOpenDate;
    if (goalCloseDate  !== undefined) updatePayload.goalCloseDate  = goalCloseDate;
    if (q1Open         !== undefined) updatePayload.q1Open         = q1Open;
    if (q2Open         !== undefined) updatePayload.q2Open         = q2Open;
    if (q3Open         !== undefined) updatePayload.q3Open         = q3Open;
    if (q4Open         !== undefined) updatePayload.q4Open         = q4Open;
    if (escalationDays !== undefined) updatePayload.escalationDays = escalationDays;
    if (status         !== undefined) updatePayload.status         = status;

    const cycle = await Cycle.findByIdAndUpdate(
      req.params.id,
      { $set: updatePayload },
      { new: true, runValidators: true }
    );
    logAudit(req.user._id, 'CYCLE_UPDATED', 'cycle', cycle._id, old.toObject(), updatePayload, req.ip);
    res.json({ message: 'Cycle updated.', cycle });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════

router.get('/dashboard', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    let cycleId = req.query.cycle_id;
    if (!cycleId) {
      const active = await Cycle.getActive();
      if (!active) return res.status(404).json({ error: 'No active cycle.' });
      cycleId = active._id;
    }

    const totalEmployees = await User.countDocuments({ role: 'employee' });

    // All sheets for this cycle
    const sheets = await GoalSheet.find({ cycle: cycleId }).populate('user', 'name email department manager');

    const allEmployees = await User.find({ role: 'employee' }).populate('manager', 'name');

    // Filter sheets visible to this user's role
    let visibleSheets = sheets;
    if (req.user.role === 'manager') {
      const managerTeamIds = new Set(
        allEmployees
          .filter(u => String(u.manager?._id || u.manager) === String(req.user._id))
          .map(u => String(u._id)),
      );
      visibleSheets = sheets.filter(s => managerTeamIds.has(String(s.user._id)));
    }

    const submitted = visibleSheets.filter(s => ['submitted', 'approved'].includes(s.status)).length;
    const approved = visibleSheets.filter(s => s.status === 'approved').length;

    const managerTeamSet = req.user.role === 'manager'
      ? new Set(allEmployees.filter(u => String(u.manager?._id || u.manager) === String(req.user._id)).map(u => String(u._id)))
      : null;

    const relevantEmployees = managerTeamSet
      ? allEmployees.filter(u => managerTeamSet.has(String(u._id)))
      : allEmployees;

    // Who hasn't submitted (scoped to manager's team when applicable)
    const submittedUserIds = new Set(
      sheets
        .filter(s => ['submitted', 'approved'].includes(s.status))
        .map(s => String(s.user?._id || s.user)),
    );
    const notSubmitted = relevantEmployees.filter(u => !submittedUserIds.has(String(u._id)));

    const sheetUser = (s) => {
      if (s.user?.name) return s.user;
      const uid = String(s.user?._id || s.user);
      return allEmployees.find(u => String(u._id) === uid) || {};
    };

    // Pending approval (with goal counts)
    const pendingSheets = visibleSheets.filter(s => s.status === 'submitted');
    const pendingApproval = await Promise.all(pendingSheets.map(async s => {
      const goals = await Goal.find({ sheet: s._id });
      const total = goals.reduce((acc, g) => acc + g.weightage, 0);
      const user = sheetUser(s);
      return {
        sheetId:        s._id,
        employeeName:   user.name,
        email:          user.email,
        department:     user.department,
        submittedAt:    s.submittedAt,
        goalCount:      goals.length,
        totalWeightage: total,
      };
    }));

    const approvedSheetDocs = visibleSheets.filter(s => s.status === 'approved');
    const approvedSheets = await Promise.all(approvedSheetDocs.map(async s => {
      const goals = await Goal.find({ sheet: s._id });
      const total = goals.reduce((acc, g) => acc + g.weightage, 0);
      const user = sheetUser(s);
      return {
        sheetId:        s._id,
        employeeName:   user.name,
        email:          user.email,
        department:     user.department,
        goalCount:      goals.length,
        totalWeightage: total,
        _status:        'approved',
      };
    }));

    // Manager stats using aggregation
    const managerStats = await User.aggregate([
      { $match: { role: 'manager' } },
      { $lookup: { from: 'users', localField: '_id', foreignField: 'manager', as: 'team' } },
      { $project: { name: 1, teamSize: { $size: '$team' }, teamIds: '$team._id' } },
    ]);

    res.json({
      cycleId,
      summary: {
        totalEmployees,
        submitted,
        approved,
        notSubmitted: notSubmitted.length,
        submissionRate: totalEmployees ? Math.round((submitted / totalEmployees) * 100) : 0,
        approvalRate:   submitted ? Math.round((approved / submitted) * 100) : 0,
      },
      notSubmitted: notSubmitted.map(u => ({
        id:          u._id,
        _id:         u._id,
        name:        u.name,
        email:       u.email,
        department:  u.department,
        managerName: u.manager?.name,
      })),
      pendingApproval,
      approvedSheets,
      managerStats,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════
// ESCALATIONS
// ════════════════════════════════════════════════

router.get('/escalations', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    let cycleId = req.query.cycle_id;
    if (!cycleId) {
      const c = await Cycle.getActive();
      if (!c) return res.status(404).json({ error: 'No active cycle found. Pass ?cycle_id= explicitly.' });
      cycleId = c._id;
    }

    const escFilter = { cycle: cycleId };
    if (req.query.all !== '1') escFilter.resolved = false;

    const escalations = await Escalation.find(escFilter)
      .populate('user', 'name email department')
      .sort({ createdAt: -1 });

    // Attach manager name via user.manager
    const enriched = await Promise.all(escalations.map(async e => {
      const user = await User.findById(e.user._id).populate('manager', 'name email');
      return { ...e.toObject(), managerName: user?.manager?.name, managerEmail: user?.manager?.email };
    }));

    res.json({ escalations: enriched });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/escalations/trigger', authenticate, authorize('admin'), async (req, res) => {
  try {
    let cycleId = req.query.cycle_id;
    if (!cycleId) { const c = await Cycle.getActive(); cycleId = c?._id; }
    const cycle = await Cycle.findById(cycleId);
    if (!cycle) return res.status(404).json({ error: 'Cycle not found.' });

    const result = await runEscalationScan(cycle);
    res.json({ message: 'Escalation scan complete.', ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/escalations/:id/resolve', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    await Escalation.findByIdAndUpdate(req.params.id, { resolved: true, resolvedAt: new Date() });
    logAudit(req.user._id, 'ESCALATION_RESOLVED', 'escalation', req.params.id, null, { resolved: true }, req.ip);
    res.json({ message: 'Escalation resolved.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/escalations/:id/notify', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const esc = await Escalation.findByIdAndUpdate(
      req.params.id,
      { $inc: { notifiedCount: 1 } },
      { new: true }
    );
    if (!esc) return res.status(404).json({ error: 'Escalation not found.' });
    // TODO: plug in nodemailer / Teams webhook here
    res.json({ message: 'Notification sent (stub).', notifiedCount: esc.notifiedCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════
// AUDIT TRAIL
// ════════════════════════════════════════════════

router.get('/audit', authenticate, authorize('admin'), async (req, res) => {
  try {
    const limit       = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset      = parseInt(req.query.offset) || 0;
    const action      = req.query.action      || null;
    const entity_type = req.query.entity_type || null;

    const filter = {};
    if (action)      filter.action     = action;
    if (entity_type) filter.entityType = entity_type;

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .populate('actor', 'name role')
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit),
      AuditLog.countDocuments(filter),
    ]);

    res.json({ logs, total, limit, offset });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/audit-log', authenticate, authorize('admin'), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const logs = await AuditLog.find()
      .populate('actor', 'name email')
      .sort({ createdAt: -1 })
      .limit(limit);
    res.json({ logs });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════
// ANALYTICS  (MongoDB Aggregation Pipelines)
// ════════════════════════════════════════════════

router.get('/analytics', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    let cycleId = req.query.cycle_id;
    if (!cycleId) { const c = await Cycle.getActive(); cycleId = c?._id; }
    const quarter = req.query.quarter || 'Q1';
    const mongoose = require('mongoose');
    const cycleObjId = new mongoose.Types.ObjectId(String(cycleId));
    const goalSheetCollection = GoalSheet.collection.name;

    // Org-level stats via aggregation
    const orgStats = await GoalSheet.aggregate([
      { $match: { cycle: cycleObjId, status: 'approved' } },
      { $lookup: { from: 'goals', localField: '_id', foreignField: 'sheet', as: 'goals' } },
      { $unwind: '$goals' },
      { $unwind: { path: '$goals.achievements', preserveNullAndEmptyArrays: true } },
      { $match: { $or: [{ 'goals.achievements.quarter': quarter }, { 'goals.achievements': { $exists: false } }] } },
      { $group: {
          _id:            null,
          totalGoals:     { $sum: 1 },
          avgScore:       { $avg: '$goals.achievements.score' },
          completed:      { $sum: { $cond: [{ $eq: ['$goals.achievements.status', 'completed'] },  1, 0] } },
          onTrack:        { $sum: { $cond: [{ $eq: ['$goals.achievements.status', 'on-track'] },   1, 0] } },
          notStarted:     { $sum: { $cond: [{ $eq: ['$goals.achievements.status', 'not-started'] },1, 0] } },
      }},
    ]);

    // Per thrust-area breakdown
    const thrustBreakdown = await GoalSheet.aggregate([
      { $match: { cycle: cycleObjId, status: 'approved' } },
      { $lookup: { from: 'goals', localField: '_id', foreignField: 'sheet', as: 'goals' } },
      { $unwind: '$goals' },
      { $unwind: { path: '$goals.achievements', preserveNullAndEmptyArrays: true } },
      { $match: { $or: [{ 'goals.achievements.quarter': quarter }, { 'goals.achievements': null }] } },
      { $group: {
          _id:            '$goals.thrustArea',
          goalCount:      { $sum: 1 },
          avgScore:       { $avg: '$goals.achievements.score' },
          totalWeightage: { $sum: '$goals.weightage' },
      }},
      { $sort: { totalWeightage: -1 } },
    ]);

    // QoQ trend (all quarters)
    const qoqTrend = await Goal.aggregate([
      { $lookup: { from: goalSheetCollection, localField: 'sheet', foreignField: '_id', as: 'sheet' } },
      { $unwind: '$sheet' },
      { $match: { 'sheet.cycle': cycleObjId, 'sheet.status': 'approved' } },
      { $unwind: '$achievements' },
      { $group: {
          _id:      '$achievements.quarter',
          avgScore: { $avg: '$achievements.score' },
          updates:  { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]);

    // Department breakdown
    const deptBreakdown = await GoalSheet.aggregate([
      { $match: { cycle: cycleObjId, status: 'approved' } },
      { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      { $lookup: { from: 'goals', localField: '_id', foreignField: 'sheet', as: 'goals' } },
      { $unwind: '$goals' },
      { $unwind: { path: '$goals.achievements', preserveNullAndEmptyArrays: true } },
      { $match: { $or: [{ 'goals.achievements.quarter': quarter }, { 'goals.achievements': null }] } },
      { $group: {
          _id:           '$user.department',
          employeeCount: { $addToSet: '$user._id' },
          goalCount:     { $sum: 1 },
          avgScore:      { $avg: '$goals.achievements.score' },
      }},
      { $project: { department: '$_id', employeeCount: { $size: '$employeeCount' }, goalCount: 1, avgScore: 1 } },
      { $sort: { avgScore: -1 } },
    ]);

    res.json({ cycleId, quarter, orgStats: orgStats[0] || {}, thrustBreakdown, qoqTrend, deptBreakdown });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/report
router.get('/report', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    let cycleId = req.query.cycle_id;
    if (!cycleId) { const c = await Cycle.getActive(); cycleId = c?._id; }
    const { quarter, department, manager_id } = req.query;

    const sheetFilter = { cycle: cycleId, status: 'approved' };
    if (manager_id) {
      const teamIds = await User.find({ manager: manager_id }).select('_id');
      sheetFilter.user = { $in: teamIds.map(u => u._id) };
    }
    if (req.user.role === 'manager') {
      const teamIds = await User.find({ manager: req.user._id }).select('_id');
      sheetFilter.user = { $in: teamIds.map(u => u._id) };
    }

    const sheets = await GoalSheet.find(sheetFilter)
      .populate({ path: 'user', select: 'name email department', populate: { path: 'manager', select: 'name' } });

    let report = [];
    for (const sheet of sheets) {
      if (department && sheet.user?.department !== department) continue;
      const goals = await Goal.find({ sheet: sheet._id });
      for (const goal of goals) {
        const ach = quarter ? goal.achievements.find(a => a.quarter === quarter) : null;
        report.push({
          employeeName:       sheet.user?.name,
          email:              sheet.user?.email,
          department:         sheet.user?.department,
          managerName:        sheet.user?.manager?.name,
          goalId:             goal._id,
          goalTitle:          goal.title,
          thrustArea:         goal.thrustArea,
          uomType:            goal.uomType,
          targetValue:        goal.targetValue,
          weightage:          goal.weightage,
          isShared:           goal.isShared,
          quarter:            ach?.quarter || null,
          actualValue:        ach?.actualValue || null,
          achievementStatus:  ach?.status || 'not-started',
          score:              ach?.score || 0,
          notes:              ach?.notes || null,
          updatedAt:          ach?.updatedAt || null,
        });
      }
    }

    res.json({ report, count: report.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════
// ESCALATION SCAN (called by scheduler too)
// ════════════════════════════════════════════════

async function runEscalationScan(cycle) {
  const now       = new Date();
  const closeDate = new Date(cycle.goalCloseDate);
  const daysPast  = Math.floor((now - closeDate) / 86400000);
  let noSubmit = 0, noApprove = 0;

  if (daysPast >= cycle.escalationDays) {
    // Employees who haven't submitted
    const allEmployees = await User.find({ role: 'employee' }).select('_id');
    const submittedIds  = await GoalSheet.find({ cycle: cycle._id, status: { $in: ['submitted','approved'] } }).select('user');
    const submittedSet  = new Set(submittedIds.map(s => String(s.user)));

    for (const emp of allEmployees) {
      if (!submittedSet.has(String(emp._id))) {
        const result = await Escalation.findOneAndUpdate(
          { user: emp._id, cycle: cycle._id, type: 'no_submission' },
          { $setOnInsert: { user: emp._id, cycle: cycle._id, type: 'no_submission' } },
          { upsert: true, new: false }
        );
        if (!result) noSubmit++;
      }
    }

    // Sheets submitted but not approved after escalation_days
    const staleDate = new Date(now - cycle.escalationDays * 86400000);
    const stale = await GoalSheet.find({
      cycle: cycle._id, status: 'submitted', submittedAt: { $lte: staleDate }
    }).select('user');

    for (const s of stale) {
      const result = await Escalation.findOneAndUpdate(
        { user: s.user, cycle: cycle._id, type: 'no_approval' },
        { $setOnInsert: { user: s.user, cycle: cycle._id, type: 'no_approval' } },
        { upsert: true, new: false }
      );
      if (!result) noApprove++;
    }
  }

  return { noSubmissionEscalations: noSubmit, noApprovalEscalations: noApprove, daysPastDeadline: daysPast };
}

module.exports = { router, runEscalationScan };
