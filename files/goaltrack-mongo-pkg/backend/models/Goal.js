// models/Goal.js
// Two schemas: GoalSheet (one per employee per cycle) + Goal (embedded or referenced)
// We use separate collections so managers can query goals across employees easily.

const mongoose = require('mongoose');

// ─── Achievement sub-document (stored inside each Goal) ─────────────────────
const AchievementSchema = new mongoose.Schema({
  quarter: {
    type: String,
    enum: ['Q1', 'Q2', 'Q3', 'Q4'],
    required: true,
  },
  actualValue: {
    type: String,
    default: null,
  },
  status: {
    type: String,
    enum: ['not-started', 'on-track', 'completed'],
    default: 'not-started',
  },
  score: {
    type: Number,
    default: 0,
    min: 0,
  },
  notes: String,
  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, { _id: false }); // no separate _id for sub-docs

// ─── Goal Schema ─────────────────────────────────────────────────────────────
const GoalSchema = new mongoose.Schema({
  sheet: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GoalSheet',
    required: true,
    index: true,
  },
  thrustArea: {
    type: String,
    required: [true, 'Thrust area is required'],
    trim: true,
  },
  title: {
    type: String,
    required: [true, 'Goal title is required'],
    trim: true,
  },
  description: String,
  uomType: {
    type: String,
    enum: ['min', 'max', 'percent', 'timeline', 'zero'],
    required: [true, 'Unit of measurement type is required'],
  },
  targetValue: {
    type: String,
    required: [true, 'Target value is required'],
  },
  weightage: {
    type: Number,
    required: [true, 'Weightage is required'],
    min: [10, 'Minimum weightage is 10%'],
    max: [100, 'Maximum weightage is 100%'],
  },
  isShared: {
    type: Boolean,
    default: false,
  },
  sharedFrom: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Goal',
    default: null,
  },
  locked: {
    type: Boolean,
    default: false,
  },
  // Quarterly achievements stored as an array of sub-documents
  achievements: [AchievementSchema],
}, {
  timestamps: true,
});

// ─── GoalSheet Schema ─────────────────────────────────────────────────────────
// One goal sheet per employee per cycle
const GoalSheetSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  cycle: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Cycle',
    required: true,
    index: true,
  },
  status: {
    type: String,
    enum: ['draft', 'submitted', 'approved', 'returned'],
    default: 'draft',
  },
  submittedAt: Date,
  approvedAt:  Date,
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  returnNote: String,
}, {
  timestamps: true,
});

// Prevent duplicate sheets (one per user per cycle)
GoalSheetSchema.index({ user: 1, cycle: 1 }, { unique: true });

// ─── GoalSheet instance method: get total weightage ─────────────────────────
GoalSheetSchema.methods.getTotalWeightage = async function () {
  const Goal = mongoose.model('Goal');
  const result = await Goal.aggregate([
    { $match: { sheet: this._id } },
    { $group: { _id: null, total: { $sum: '$weightage' } } },
  ]);
  return result[0]?.total || 0;
};

module.exports = {
  Goal:      mongoose.model('Goal', GoalSchema),
  GoalSheet: mongoose.model('GoalSheet', GoalSheetSchema),
};
