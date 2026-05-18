// models/AuditLog.js
const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
  actor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  action: {
    type: String,
    required: true,
    // e.g. GOAL_CREATED, SHEET_APPROVED, GOAL_UNLOCKED, SHARED_GOAL_PUSHED
  },
  entityType: {
    type: String,
    enum: ['goal', 'goal_sheet', 'user', 'cycle', 'escalation'],
  },
  entityId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
  },
  oldValue: mongoose.Schema.Types.Mixed, // JSON snapshot before change
  newValue: mongoose.Schema.Types.Mixed, // JSON snapshot after change
  ipAddress: String,
}, {
  timestamps: true,
});

// Index for fast lookups by action type and time
AuditLogSchema.index({ action: 1, createdAt: -1 });
AuditLogSchema.index({ actor: 1, createdAt: -1 });

// Static helper to log quickly from route files
AuditLogSchema.statics.log = function (actorId, action, entityType, entityId, oldVal, newVal, ip) {
  return this.create({
    actor:      actorId,
    action,
    entityType,
    entityId:   entityId || null,
    oldValue:   oldVal   || null,
    newValue:   newVal   || null,
    ipAddress:  ip       || null,
  }).catch(err => console.error('Audit log error:', err.message));
};

// ─── Escalation model (same file for brevity) ────────────────────────────────
const EscalationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  cycle: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Cycle',
    required: true,
  },
  type: {
    type: String,
    enum: ['no_submission', 'no_approval', 'no_checkin'],
    required: true,
  },
  resolved: {
    type: Boolean,
    default: false,
  },
  resolvedAt: Date,
  notifiedCount: {
    type: Number,
    default: 0,
  },
}, {
  timestamps: true,
});

// Prevent duplicate escalations for same user+cycle+type
EscalationSchema.index({ user: 1, cycle: 1, type: 1 }, { unique: true });

// ─── CheckIn model ───────────────────────────────────────────────────────────
const CheckInSchema = new mongoose.Schema({
  goal: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Goal',
    required: true,
  },
  manager: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  quarter: {
    type: String,
    enum: ['Q1', 'Q2', 'Q3', 'Q4'],
    required: true,
  },
  comment: {
    type: String,
    required: true,
  },
}, {
  timestamps: true,
});

const AuditLogModel   = mongoose.model('AuditLog', AuditLogSchema);
const EscalationModel = mongoose.model('Escalation', EscalationSchema);
const CheckInModel    = mongoose.model('CheckIn', CheckInSchema);

// Default export is AuditLog; named models attached as properties.
// Do NOT reassign module.exports after this block.
module.exports = AuditLogModel;
module.exports.Escalation = EscalationModel;
module.exports.CheckIn    = CheckInModel;
