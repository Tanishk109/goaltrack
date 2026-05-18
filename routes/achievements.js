// routes/achievements.js
const express = require('express');
const { Goal, GoalSheet } = require('../models/Goal');
const { CheckIn } = require('../models/AuditLog');
const { authenticate, authorize } = require('../middleware/auth');
const { computeScore } = require('../middleware/scoring');
const { CheckInPeriod } = require('../models/CheckInPeriod');
const {
  refreshAssignmentStatuses,
  validateAchievementCheckinAccess,
} = require('../lib/checkinAssignments');

const router = express.Router();

// ─── POST /api/achievements — save/update quarterly achievement ───────────────
router.post('/', authenticate, authorize('employee'), async (req, res) => {
  try {
    const { goal_id, quarter, actualValue, status, notes } = req.body;
    if (!goal_id || !quarter || !status)
      return res.status(400).json({ error: 'goal_id, quarter, and status are required.' });

    const validQ = ['Q1','Q2','Q3','Q4'];
    if (!validQ.includes(quarter)) return res.status(400).json({ error: `Quarter must be one of: ${validQ.join(', ')}` });

    const goal = await Goal.findById(goal_id).populate('sheet');
    if (!goal) return res.status(404).json({ error: 'Goal not found.' });
    if (String(goal.sheet.user) !== String(req.user._id)) return res.status(403).json({ error: 'Not your goal.' });

    const sheet = await GoalSheet.findById(goal.sheet._id).populate('cycle');
    const cycle = sheet?.cycle;

    const access = await validateAchievementCheckinAccess(
      req.user._id,
      cycle,
      quarter,
      sheet?.status,
    );
    if (!access.ok) {
      return res.status(access.mode === 'campaign' ? 403 : 400).json({ error: access.error });
    }

    const score = computeScore(goal.uomType, goal.targetValue, actualValue);

    // Upsert the achievement for this quarter inside the goal's achievements array
    const existingIdx = goal.achievements.findIndex(a => a.quarter === quarter);
    const achData = { quarter, actualValue: actualValue || null, status, score, notes: notes || null, updatedAt: new Date() };

    if (existingIdx >= 0) {
      Object.assign(goal.achievements[existingIdx], achData);
    } else {
      goal.achievements.push(achData);
    }

    await goal.save();

    if (sheet?.status === 'approved' && cycle) {
      const period = await CheckInPeriod.findOne({ cycle: cycle._id, phase: quarter, status: 'active' });
      if (period) {
        await refreshAssignmentStatuses(period._id);
      }
    }

    // If this is a shared goal, sync achievement to all siblings (same sharedFrom source)
    if (goal.isShared && goal.sharedFrom) {
      const siblings = await Goal.find({
        sharedFrom: goal.sharedFrom,
        _id: { $ne: goal._id },
      });
      for (const sibling of siblings) {
        const ci = sibling.achievements.findIndex(a => a.quarter === quarter);
        const syncData = { actualValue: actualValue || null, score, updatedAt: new Date() };
        if (ci >= 0) {
          Object.assign(sibling.achievements[ci], syncData);
        } else {
          sibling.achievements.push({ quarter, ...syncData, status: achData.status, notes: null });
        }
        await sibling.save();
      }
    }

    res.json({ message: 'Achievement saved.', score, quarter, actualValue });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/achievements/goal/:goal_id ─────────────────────────────────────
router.get('/goal/:goal_id', authenticate, async (req, res) => {
  try {
    const goal = await Goal.findById(req.params.goal_id).populate('sheet');
    if (!goal) return res.status(404).json({ error: 'Goal not found.' });

    if (req.user.role === 'employee' && String(goal.sheet.user) !== String(req.user._id))
      return res.status(403).json({ error: 'Access denied.' });

    res.json({ goal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/achievements/team?quarter=Q1&cycle_id= ─────────────────────────
router.get('/team', authenticate, authorize('manager', 'admin'), async (req, res) => {
  try {
    const { quarter, cycle_id } = req.query;

    // Build sheet query
    const sheetQuery = {};
    if (cycle_id) sheetQuery.cycle = cycle_id;

    // Manager: only their team's sheets
    if (req.user.role === 'manager') {
      const { User } = require('../models/User') || require('../models/User');
      const UserModel = require('../models/User');
      const teamIds = await UserModel.find({ manager: req.user._id }).select('_id');
      sheetQuery.user = { $in: teamIds.map(u => u._id) };
    }

    const sheets = await GoalSheet.find({ ...sheetQuery, status: 'approved' })
      .populate('user', 'name email department');

    const sheetIds = sheets.map(s => s._id);
    const goals    = await Goal.find({ sheet: { $in: sheetIds } });

    // Attach employee info to each goal
    const sheetMap = {};
    sheets.forEach(s => { sheetMap[String(s._id)] = s; });

    const data = goals.map(g => {
      const sheet = sheetMap[String(g.sheet)];
      const ach   = quarter ? g.achievements.find(a => a.quarter === quarter) : null;
      return {
        employeeId:   String(sheet?.user?._id || ''),
        employeeName: sheet?.user?.name,
        department:   sheet?.user?.department,
        goalId:       g._id,
        title:        g.title,
        thrustArea:   g.thrustArea,
        uomType:      g.uomType,
        targetValue:  g.targetValue,
        weightage:    g.weightage,
        quarter:      ach?.quarter || null,
        actualValue:  ach?.actualValue || null,
        status:       ach?.status || 'not-started',
        score:        ach?.score || 0,
        updatedAt:    ach?.updatedAt || null,
      };
    });

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/achievements/checkin ──────────────────────────────────────────
router.post('/checkin', authenticate, authorize('manager', 'admin'), async (req, res) => {
  try {
    const { goal_id, employee_id, quarter, comment } = req.body;
    if (!goal_id || !employee_id || !quarter || !comment)
      return res.status(400).json({ error: 'goal_id, employee_id, quarter, comment are required.' });

    // Verify employee is in manager's team
    if (req.user.role === 'manager') {
      const UserModel = require('../models/User');
      const emp = await UserModel.findById(employee_id).select('manager');
      if (!emp || String(emp.manager) !== String(req.user._id))
        return res.status(403).json({ error: 'Employee not in your team.' });
    }

    const goal = await Goal.findById(goal_id).populate('sheet');
    if (!goal) return res.status(404).json({ error: 'Goal not found.' });
    if (String(goal.sheet.user) !== String(employee_id))
      return res.status(403).json({ error: 'Goal does not belong to this employee.' });

    const checkin = await CheckIn.create({
      goal: goal_id, manager: req.user._id, employee: employee_id, quarter, comment,
    });

    res.status(201).json({ message: 'Check-in comment saved.', checkin });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/achievements/checkins/:employee_id ─────────────────────────────
router.get('/checkins/:employee_id', authenticate, async (req, res) => {
  try {
    const empId = req.params.employee_id;
    if (req.user.role === 'employee' && String(req.user._id) !== empId)
      return res.status(403).json({ error: 'Access denied.' });

    const checkins = await CheckIn.find({ employee: empId })
      .populate('manager', 'name email')
      .populate('goal', 'title')
      .sort({ createdAt: -1 });

    res.json({ checkins });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
