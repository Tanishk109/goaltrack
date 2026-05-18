// routes/auth.js
const express = require('express');
const jwt     = require('jsonwebtoken');
const User    = require('../models/User');
const { authenticate, authorize, logAudit } = require('../middleware/auth');

const router = express.Router();

const signToken = (id, role) =>
  jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

// ─── POST /api/auth/login ────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required.' });

    // Explicitly select password (it's excluded by default in schema)
    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');
    if (!user || !(await user.matchPassword(password)))
      return res.status(401).json({ error: 'Invalid email or password.' });

    const token = signToken(user._id, user.role);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id:         user._id,
        name:       user.name,
        email:      user.email,
        role:       user.role,
        department: user.department,
        manager:    user.manager,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/auth/register ─────────────────────────────────────────────────
router.post('/register', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { name, email, password, role, department, manager } = req.body;
    if (!name || !email || !password || !role)
      return res.status(400).json({ error: 'name, email, password, role are required.' });

    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) return res.status(409).json({ error: 'Email already in use.' });

    const user = await User.create({ name, email, password, role, department, manager: manager || null });

    res.status(201).json({
      message: 'User registered.',
      user: { id: user._id, name: user.name, email: user.email, role: user.role, department: user.department },
    });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(e => e.message).join(', ');
      return res.status(400).json({ error: messages });
    }
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('manager', 'name email role');
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/auth/users ─────────────────────────────────────────────────────
router.get('/users', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    let query = User.find().populate('manager', 'name email').select('-password');

    // Managers only see their own team
    if (req.user.role === 'manager') {
      query = User.find({ manager: req.user._id })
        .populate('manager', 'name email')
        .select('-password');
    }

    const users = await query.sort({ role: 1, name: 1 });
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /api/auth/users/:id ───────────────────────────────────────────────
router.patch('/users/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { name, role, department, manager } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { name, role, department, manager } },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) return res.status(404).json({ error: 'User not found.' });
    logAudit(req.user._id, 'USER_UPDATED', 'user', user._id, null, { name, role }, req.ip);
    res.json({ message: 'User updated.', user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
