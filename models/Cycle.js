// models/Cycle.js
const mongoose = require('mongoose');

const CycleSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Cycle name is required'],
    trim: true,
  },
  goalOpenDate: {
    type: Date,
    required: [true, 'Goal open date is required'],
  },
  goalCloseDate: {
    type: Date,
    required: [true, 'Goal close date is required'],
  },
  // Check-in window open dates
  q1Open: Date,
  q2Open: Date,
  q3Open: Date,
  q4Open: Date,

  status: {
    type: String,
    enum: ['draft', 'active', 'closed'],
    default: 'active',
  },
  escalationDays: {
    type: Number,
    default: 5,
    min: 1,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
}, {
  timestamps: true,
});

// Helper: get the currently active cycle (static method)
CycleSchema.statics.getActive = function () {
  return this.findOne({ status: 'active' }).sort({ createdAt: -1 });
};

module.exports = mongoose.model('Cycle', CycleSchema);
