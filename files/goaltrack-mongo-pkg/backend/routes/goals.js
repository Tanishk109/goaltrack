// routes/goals.js
const express = require('express');
const { Goal, GoalSheet } = require('../models/Goal');
const Cycle    = require('../models/Cycle');
const { authenticate, authorize, logAudit } = require('../middleware/auth');

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
      if (goal.locked) return res.status(403).json({ error: 'Goal is locked. Ask admin to unlock.' });
      if (goal.sheet.status === 'approved') return res.status(403).json({ error: 'Sheet is approved and locked.' });
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
    if (goal.locked || goal.sheet.status === 'approved') return res.status(403).json({ error: 'Cannot delete locked goal.' });

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
    if (cycle && cycle.goalCloseDate && new Date() > new Date(cycle.goalCloseDate)) {
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
    const goal = await Goal.findByIdAndUpdate(req.params.id, { $set: { locked: false } }, { new: true });
    if (!goal) return res.status(404).json({ error: 'Goal not found.' });

    logAudit(req.user._id, 'GOAL_UNLOCKED', 'goal', goal._id, { locked: true }, { locked: false, reason }, req.ip);
    res.json({ message: `Goal unlocked.`, reason, goal });
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

module.exports = router;
