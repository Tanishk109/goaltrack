// models/CheckInPeriod.js — Quarterly check-in campaigns launched by manager/admin
const mongoose = require('mongoose');

const PHASES = ['goal_setting', 'Q1', 'Q2', 'Q3', 'Q4'];

const CheckInPeriodSchema = new mongoose.Schema({
  cycle: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Cycle',
    required: true,
    index: true,
  },
  phase: {
    type: String,
    enum: PHASES,
    required: true,
  },
  title: { type: String, required: true, trim: true },
  action: { type: String, required: true, trim: true },
  windowOpens: { type: Date, required: true },
  deadline: { type: Date, required: true },
  launchedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  launchedAt: { type: Date, default: Date.now },
  status: {
    type: String,
    enum: ['active', 'closed'],
    default: 'active',
  },
  scope: {
    type: String,
    enum: ['all', 'team'],
    default: 'all',
  },
}, { timestamps: true });

CheckInPeriodSchema.index({ cycle: 1, phase: 1, status: 1 });

const CheckInAssignmentSchema = new mongoose.Schema({
  period: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CheckInPeriod',
    required: true,
    index: true,
  },
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  status: {
    type: String,
    enum: ['pending', 'submitted', 'overdue'],
    default: 'pending',
  },
  submittedAt: Date,
  notifiedAt: { type: Date, default: Date.now },
}, { timestamps: true });

CheckInAssignmentSchema.index({ period: 1, employee: 1 }, { unique: true });

const CheckInPeriodModel = mongoose.model('CheckInPeriod', CheckInPeriodSchema);
const CheckInAssignmentModel = mongoose.model('CheckInAssignment', CheckInAssignmentSchema);

module.exports = {
  PHASES,
  CheckInPeriod: CheckInPeriodModel,
  CheckInAssignment: CheckInAssignmentModel,
};
