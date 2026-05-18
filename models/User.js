// models/User.js
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: 6,
    select: false, // never returned in queries by default
  },
  role: {
    type: String,
    enum: ['employee', 'manager', 'admin'],
    required: true,
    default: 'employee',
  },
  department: {
    type: String,
    trim: true,
  },
  manager: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
}, {
  timestamps: true, // adds createdAt, updatedAt automatically
});

// ─── Hash password before saving ────────────────────────────────────────────
UserSchema.pre('save', async function (next) {
  // Only hash if password was actually changed
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// ─── Instance method: compare passwords ─────────────────────────────────────
UserSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

// ─── Virtual: full manager info (populated on demand) ───────────────────────
UserSchema.virtual('managerInfo', {
  ref: 'User',
  localField: 'manager',
  foreignField: '_id',
  justOne: true,
});

module.exports = mongoose.model('User', UserSchema);
