// routes/goals.js
const express = require('express');
const { Goal, GoalSheet } = require('../models/Goal');
const Cycle    = require('../models/Cycle');
const { authenticate, authorize, logAudit } = require('../middleware/auth');
const { UnlockRequest } = require('../models/AuditLog');
const { CheckInPeriod, CheckInAssignment } = require('../models/CheckInPeriod');
const { refreshAssignmentStatuses } = require('./checkins');

const router = express.Router();

// ─── Helper: get or create a draft goal sheet ────────────────────────────────
async function getOrCreateSheet(userId, cycleId) {
  let sheet = await GoalSheet.findOne({ user: userId, cycle: cycleId });
  if (!sheet) {
    sheet = await GoalSheet.create({ user: userId, cycle: cycleId });
  }
  return sheet;
}

// ─── Helper: total weightage for a sheet ────────────────────────────────────
function isGoalLocked(goal) {
  const sheet = goal.sheet;
  if (sheet?.status === 'approved') return goal.locked !== false;
  return !!goal.locked;
}

async function getTotalWeightage(sheetId, excludeGoalId = null) {
  const match = { sheet: sheetId };
  if (excludeGoalId) match._id = { $ne: excludeGoalId };
  const result = await Goal.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: '$weightage' } } },
  ]);
  return result[0]?.total || 0;
}

// ─── GET /api/goals/my-sheet?cycle_id= ──────────────────────────────────────
router.get('/my-sheet', authenticate, async (req, res) => {
  try {
    let cycleId = req.query.cycle_id;
    if (!cycleId) {
      const active = await Cycle.getActive();
      if (!active) return res.status(404).json({ error: 'No active cycle found.' });
      cycleId = active._id;
    }

    const sheet = await getOrCreateSheet(req.user._id, cycleId);

    const goals = await Goal.find({ sheet: sheet._id }).sort({ createdAt: 1 });
    const totalWeightage = await getTotalWeightage(sheet._id);

    res.json({ sheet, goals, totalWeightage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/goals/sheet/:sheet_id — manager/admin view employee sheet ───────
router.get('/sheet/:sheet_id', authenticate, authorize('manager', 'admin'), async (req, res) => {
  try {
    const sheet = await GoalSheet.findById(req.params.sheet_id).populate('user', 'name email department');
    if (!sheet) return res.status(404).json({ error: 'Sheet not found.' });

    if (req.user.role === 'manager') {
      const User = require('../models/User');
      const emp = await User.findById(sheet.user._id).select('manager');
      if (!emp || String(emp.manager) !== String(req.user._id)) {
        return res.status(403).json({ error: 'Not your team member.' });
      }
    }

    const goals = await Goal.find({ sheet: sheet._id }).sort({ createdAt: 1 });
    const totalWeightage = await getTotalWeightage(sheet._id);
    res.json({ sheet, goals, totalWeightage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/goals — add a goal ───────────────────────────────────────────
router.post('/', authenticate, authorize('employee'), async (req, res) => {
  try {
    const { sheet_id, thrustArea, title, description, uomType, targetValue, weightage } = req.body;
    if (!sheet_id || !thrustArea || !title || !uomType || !targetValue || !weightage)
      return res.status(400).json({ error: 'All fields required: sheet_id, thrustArea, title, uomType, targetValue, weightage.' });

    const sheet = await GoalSheet.findOne({ _id: sheet_id, user: req.user._id });
    if (!sheet) return res.status(404).json({ error: 'Goal sheet not found.' });
    if (sheet.status === 'approved') return res.status(403).json({ error: 'Sheet is locked after approval.' });

    const goalCount = await Goal.countDocuments({ sheet: sheet._id });
    if (goalCount >= 8) return res.status(400).json({ error: 'Maximum 8 goals allowed.' });

    if (weightage < 10) return res.status(400).json({ error: 'Minimum weightage is 10%.' });

    const currentTotal = await getTotalWeightage(sheet._id);
    if (currentTotal + weightage > 100)
      return res.status(400).json({ error: `Adding this goal would exceed 100% (currently ${currentTotal}%).` });

    const goal = await Goal.create({
      sheet: sheet._id,
      thrustArea, title, description: description || null,
      uomType, targetValue, weightage,
    });

    logAudit(req.user._id, 'GOAL_CREATED', 'goal', goal._id, null, { title }, req.ip);
    res.status(201).json({ message: 'Goal added.', goal });
  } catch (err) {
    if (err.name === 'ValidationError') {
      return res.status(400).json({ error: Object.values(err.errors).map(e => e.message).join(', ') });
    }
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /api/goals/:id ───────────────────────────────────────────────────
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const goal = await Goal.findById(req.params.id).populate('sheet');
    if (!goal) return res.status(404).json({ error: 'Goal not found.' });

    if (goal.isShared && req.user.role !== 'admin') {
      const disallowed = Object.keys(req.body).filter(k => k !== 'weightage');
      if (disallowed.length)
        return res.status(403).json({ error: 'Shared goals: only weightage can be changed by non-admins.' });
    }

    if (req.user.role === 'employee') {
      if (String(goal.sheet.user) !== String(req.user._id))
        return res.status(403).json({ error: 'Not your goal.' });
      if (goal.sheet.status === 'submitted')
        return res.status(403).json({ error: 'Sheet is submitted for approval.' });
      if (isGoalLocked(goal))
        return res.status(403).json({ error: 'Goal is locked. Request an unlock from Admin/HR.' });
    }

    const { weightage } = req.body;
    if (weightage !== undefined) {
      if (weightage < 10) return res.status(400).json({ error: 'Min weightage is 10%.' });
      const currentTotal = await getTotalWeightage(goal.sheet._id, goal._id);
      if (currentTotal + weightage > 100)
        return res.status(400).json({ error: `Total would be ${currentTotal + weightage}%. Max is 100%.` });
    }

    const old = goal.toObject();
    const allowed = ['thrustArea','title','description','uomType','targetValue','weightage'];
    allowed.forEach(field => { if (req.body[field] !== undefined) goal[field] = req.body[field]; });
    await goal.save();

    logAudit(req.user._id, 'GOAL_UPDATED', 'goal', goal._id, old, req.body, req.ip);
    res.json({ message: 'Goal updated.', goal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/goals/:id ──────────────────────────────────────────────────
router.delete('/:id', authenticate, authorize('employee'), async (req, res) => {
  try {
    const goal = await Goal.findById(req.params.id).populate('sheet');
    if (!goal) return res.status(404).json({ error: 'Goal not found.' });
    if (String(goal.sheet.user) !== String(req.user._id)) return res.status(403).json({ error: 'Not your goal.' });
    if (goal.sheet.status === 'submitted')
      return res.status(403).json({ error: 'Cannot delete goals while sheet is submitted.' });
    if (isGoalLocked(goal)) return res.status(403).json({ error: 'Cannot delete locked goal.' });

    await goal.deleteOne();
    logAudit(req.user._id, 'GOAL_DELETED', 'goal', goal._id, goal.toObject(), null, req.ip);
    res.json({ message: 'Goal deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/goals/submit/:sheet_id ───────────────────────────────────────
router.post('/submit/:sheet_id', authenticate, authorize('employee'), async (req, res) => {
  try {
    const sheet = await GoalSheet.findOne({ _id: req.params.sheet_id, user: req.user._id });
    if (!sheet) return res.status(404).json({ error: 'Sheet not found.' });

    const cycle = await Cycle.findById(sheet.cycle);
    const gsPeriod = await CheckInPeriod.findOne({
      cycle: sheet.cycle,
      phase: 'goal_setting',
      status: 'active',
    });
    if (gsPeriod) {
      const assignment = await CheckInAssignment.findOne({
        period: gsPeriod._id,
        employee: req.user._id,
      });
      if (!assignment) {
        return res.status(403).json({ error: 'Goal setting has not been launched for you. Contact your manager or HR.' });
      }
      if (new Date() > gsPeriod.deadline) {
        return res.status(400).json({ error: 'Goal setting deadline has passed.' });
      }
    } else if (cycle && cycle.goalCloseDate && new Date() > new Date(cycle.goalCloseDate)) {
      return res.status(400).json({ error: 'Goal submission window is closed.' });
    }

    if (sheet.status === 'approved') return res.status(400).json({ error: 'Already approved.' });

    const goalCount = await Goal.countDocuments({ sheet: sheet._id });
    if (goalCount === 0) return res.status(400).json({ error: 'Add at least one goal before submitting.' });

    const total = await getTotalWeightage(sheet._id);
    if (total !== 100) return res.status(400).json({ error: `Total weightage is ${total}%. Must be exactly 100%.` });

    sheet.status = 'submitted';
    sheet.submittedAt = new Date();
    await sheet.save();

    logAudit(req.user._id, 'SHEET_SUBMITTED', 'goal_sheet', sheet._id, null, { total, goalCount }, req.ip);

    if (gsPeriod) {
      await refreshAssignmentStatuses(gsPeriod._id);
    }

    res.json({ message: 'Submitted for manager approval.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/goals/approve/:sheet_id ─────────────────────────────────────
router.post('/approve/:sheet_id', authenticate, authorize('manager', 'admin'), async (req, res) => {
  try {
    const sheet = await GoalSheet.findById(req.params.sheet_id).populate('user');
    if (!sheet) return res.status(404).json({ error: 'Sheet not found.' });
    if (sheet.status !== 'submitted') return res.status(400).json({ error: 'Sheet is not submitted.' });

    // Manager can only approve their team
    if (req.user.role === 'manager' && String(sheet.user.manager) !== String(req.user._id))
      return res.status(403).json({ error: 'This employee is not in your team.' });

    // Lock all goals in this sheet
    await Goal.updateMany({ sheet: sheet._id }, { $set: { locked: true } });

    sheet.status = 'approved';
    sheet.approvedAt = new Date();
    sheet.approvedBy = req.user._id;
    await sheet.save();

    logAudit(req.user._id, 'SHEET_APPROVED', 'goal_sheet', sheet._id,
      { status: 'submitted' }, { status: 'approved' }, req.ip);
    res.json({ message: 'Sheet approved and locked.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/goals/return/:sheet_id ──────────────────────────────────────
router.post('/return/:sheet_id', authenticate, authorize('manager', 'admin'), async (req, res) => {
  try {
    const { note } = req.body;
    const sheet = await GoalSheet.findById(req.params.sheet_id);
    if (!sheet) return res.status(404).json({ error: 'Sheet not found.' });

    sheet.status = 'returned';
    sheet.returnNote = note || 'Returned for rework.';
    sheet.approvedAt = undefined;
    sheet.approvedBy = undefined;
    sheet.submittedAt = undefined;
    await sheet.save();
    await Goal.updateMany({ sheet: sheet._id }, { $set: { locked: false } });

    logAudit(req.user._id, 'SHEET_RETURNED', 'goal_sheet', sheet._id, null, { note }, req.ip);
    res.json({ message: 'Sheet returned for rework.', note });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/goals/unlock/:id  (Admin) ────────────────────────────────────
router.post('/unlock/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { reason } = req.body;
    const goal = await Goal.findById(req.params.id).populate('sheet');
    if (!goal) return res.status(404).json({ error: 'Goal not found.' });
    if (goal.sheet?.status !== 'approved') {
      return res.status(400).json({ error: 'Only goals on approved sheets can be unlocked.' });
    }
    if (!isGoalLocked(goal)) {
      return res.status(400).json({ error: 'Goal is already unlocked.' });
    }

    const updated = await Goal.findByIdAndUpdate(goal._id, { $set: { locked: false } }, { new: true });
    logAudit(req.user._id, 'GOAL_UNLOCKED', 'goal', goal._id, { locked: true }, { locked: false, reason }, req.ip);
    res.json({ message: 'Goal unlocked.', reason, goal: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/goals/lock/:id  (Admin) ──────────────────────────────────────
router.post('/lock/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { reason } = req.body;
    const goal = await Goal.findById(req.params.id).populate('sheet');
    if (!goal) return res.status(404).json({ error: 'Goal not found.' });
    if (goal.sheet?.status !== 'approved') {
      return res.status(400).json({ error: 'Only goals on approved sheets can be re-locked.' });
    }
    if (isGoalLocked(goal)) {
      return res.status(400).json({ error: 'Goal is already locked.' });
    }

    const updated = await Goal.findByIdAndUpdate(goal._id, { $set: { locked: true } }, { new: true });
    logAudit(req.user._id, 'GOAL_LOCKED', 'goal', goal._id, { locked: false }, { locked: true, reason }, req.ip);
    res.json({ message: 'Goal locked.', reason, goal: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/goals/push-shared  (Admin/Manager) ───────────────────────────
router.post('/push-shared', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { thrustArea, title, description, uomType, targetValue, recipientUserIds, cycleId } = req.body;
    if (!recipientUserIds?.length) return res.status(400).json({ error: 'recipientUserIds cannot be empty.' });

    const results = [];
    const skipped = [];
    let sourceGoalId = null;

    for (const uid of recipientUserIds) {
      const sheet = await getOrCreateSheet(uid, cycleId);
      if (sheet.status === 'approved') {
        skipped.push({ userId: uid, reason: 'sheet_approved' });
        continue;
      }
      const count = await Goal.countDocuments({ sheet: sheet._id });
      if (count >= 8) {
        skipped.push({ userId: uid, reason: 'max_goals_reached' });
        continue;
      }
      const currentTotal = await getTotalWeightage(sheet._id);
      if (currentTotal + 10 > 100) {
        skipped.push({ userId: uid, reason: 'weightage_exceeded' });
        continue;
      }

      const existingShared = await Goal.findOne({
        sheet: sheet._id,
        title,
        isShared: true,
      });
      if (existingShared) {
        skipped.push({ userId: uid, reason: 'duplicate_shared_goal' });
        continue;
      }

      const goal = await Goal.create({
        sheet: sheet._id,
        thrustArea, title, description: description || null,
        uomType, targetValue,
        weightage: 10,
        isShared: true,
        sharedFrom: sourceGoalId,
        locked: false,
      });
      if (!sourceGoalId) {
        sourceGoalId = goal._id;
        await Goal.findByIdAndUpdate(goal._id, { sharedFrom: goal._id });
      }
      results.push({ userId: uid, goalId: goal._id });
    }

    logAudit(req.user._id, 'SHARED_GOAL_PUSHED', 'goal', sourceGoalId,
      null, { title, pushedTo: results.length, skipped: skipped.length }, req.ip);
    res.json({
      message: `Shared goal pushed to ${results.length} of ${recipientUserIds.length} employees.`,
      sourceGoalId,
      results,
      skipped,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/goals/unlock-request/:goal_id — Employee requests unlock ───────
router.post('/unlock-request/:goal_id', authenticate, authorize('employee'), async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'A reason is required for the unlock request.' });
    }

    const goal = await Goal.findById(req.params.goal_id).populate('sheet');
    if (!goal) return res.status(404).json({ error: 'Goal not found.' });

    if (String(goal.sheet.user) !== String(req.user._id)) {
      return res.status(403).json({ error: 'Not your goal.' });
    }

    if (goal.sheet?.status !== 'approved') {
      return res.status(400).json({ error: 'Unlock requests apply only to approved goal sheets.' });
    }
    if (!isGoalLocked(goal)) {
      return res.status(400).json({ error: 'This goal is not locked.' });
    }

    const existing = await UnlockRequest.findOne({
      goal: goal._id,
      employee: req.user._id,
      status: 'pending',
    });
    if (existing) {
      return res.status(409).json({ error: 'You already have a pending unlock request for this goal.' });
    }

    const request = await UnlockRequest.create({
      goal:     goal._id,
      employee: req.user._id,
      reason:   reason.trim(),
    });

    logAudit(
      req.user._id,
      'UNLOCK_REQUESTED',
      'goal',
      goal._id,
      null,
      { reason: reason.trim(), goalTitle: goal.title },
      req.ip,
    );

    res.status(201).json({ message: 'Unlock request submitted. Admin will review it.', request });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/goals/unlock-requests — Admin sees all pending requests ─────────
router.get('/unlock-requests', authenticate, authorize('admin'), async (req, res) => {
  try {
    const filter = req.query.all === '1' ? {} : { status: 'pending' };
    const requests = await UnlockRequest.find(filter)
      .populate('goal', 'title thrustArea targetValue weightage locked')
      .populate('employee', 'name email department')
      .populate('resolvedBy', 'name')
      .sort({ createdAt: -1 })
      .limit(100);

    res.json({ requests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/goals/my-unlock-requests — Employee sees their own requests ──────
router.get('/my-unlock-requests', authenticate, authorize('employee'), async (req, res) => {
  try {
    const requests = await UnlockRequest.find({ employee: req.user._id })
      .populate('goal', 'title thrustArea locked')
      .populate('resolvedBy', 'name')
      .sort({ createdAt: -1 });

    res.json({ requests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /api/goals/unlock-requests/:id/approve — Admin approves ───────────
router.patch('/unlock-requests/:id/approve', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { adminNote } = req.body;
    const unlockReq = await UnlockRequest.findById(req.params.id).populate('goal');
    if (!unlockReq) return res.status(404).json({ error: 'Unlock request not found.' });
    if (unlockReq.status !== 'pending') {
      return res.status(400).json({ error: `Request is already ${unlockReq.status}.` });
    }

    await Goal.findByIdAndUpdate(unlockReq.goal._id, { $set: { locked: false } });

    unlockReq.status     = 'approved';
    unlockReq.resolvedBy = req.user._id;
    unlockReq.resolvedAt = new Date();
    unlockReq.adminNote  = adminNote || 'Approved.';
    await unlockReq.save();

    logAudit(
      req.user._id,
      'GOAL_UNLOCKED',
      'goal',
      unlockReq.goal._id,
      { locked: true },
      { locked: false, reason: `Unlock request approved. ${adminNote || ''}` },
      req.ip,
    );

    res.json({ message: 'Unlock request approved. Goal is now unlocked.', request: unlockReq });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /api/goals/unlock-requests/:id/reject — Admin rejects ─────────────
router.patch('/unlock-requests/:id/reject', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { adminNote } = req.body;
    const unlockReq = await UnlockRequest.findById(req.params.id);
    if (!unlockReq) return res.status(404).json({ error: 'Unlock request not found.' });
    if (unlockReq.status !== 'pending') {
      return res.status(400).json({ error: `Request is already ${unlockReq.status}.` });
    }

    unlockReq.status     = 'rejected';
    unlockReq.resolvedBy = req.user._id;
    unlockReq.resolvedAt = new Date();
    unlockReq.adminNote  = adminNote || 'Request rejected.';
    await unlockReq.save();

    logAudit(
      req.user._id,
      'UNLOCK_REQUEST_REJECTED',
      'goal',
      unlockReq.goal,
      null,
      { adminNote: unlockReq.adminNote },
      req.ip,
    );

    res.json({ message: 'Unlock request rejected.', request: unlockReq });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
