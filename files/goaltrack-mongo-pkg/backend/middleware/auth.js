// middleware/auth.js
const jwt      = require('jsonwebtoken');
const User     = require('../models/User');
const AuditLog = require('../models/AuditLog');
require('dotenv').config();

// ─── Verify JWT ──────────────────────────────────────────────────────────────
const authenticate = async (req, res, next) => {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided. Please login first.' });
  }

  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Fetch fresh user from MongoDB (handles role changes)
    const user = await User.findById(decoded.id).select('-password');
    if (!user) return res.status(401).json({ error: 'User no longer exists.' });
    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired. Please login again.' });
    }
    return res.status(401).json({ error: 'Invalid token.' });
  }
};

// ─── Role guard ──────────────────────────────────────────────────────────────
// Usage: authorize('admin')  or  authorize('manager', 'admin')
const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({
      error: `Access denied. Requires: ${roles.join(' or ')}.`,
    });
  }
  next();
};

// ─── Audit logger (async fire-and-forget) ────────────────────────────────────
const logAudit = (actorId, action, entityType, entityId, oldVal, newVal, ip) => {
  AuditLog.log(actorId, action, entityType, entityId, oldVal, newVal, ip);
};

module.exports = { authenticate, authorize, logAudit };
