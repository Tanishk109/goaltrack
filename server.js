// server.js — GoalTrack Pro API (MongoDB Edition)
require('dotenv').config();
const path      = require('path');
const express   = require('express');
const cors      = require('cors');
const connectDB = require('./config/db');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
const corsOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map((s) => s.trim())
  : true;

app.use(cors({
  origin:         corsOrigins,
  credentials:    true,
  methods:        ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${req.method.padEnd(6)} ${req.path}`);
  next();
});

// Serve frontend (parent folder) when running API locally
app.use(express.static(path.join(__dirname, '..')));

// ─── Routes (mounted after DB is ready) ─────────────────────────────────────
const authRoutes        = require('./routes/auth');
const goalRoutes        = require('./routes/goals');
const achievementRoutes = require('./routes/achievements');
const checkinRoutes     = require('./routes/checkins');
const { router: adminRoutes, runEscalationScan } = require('./routes/admin');

app.use('/api/auth',         authRoutes);
app.use('/api/goals',        goalRoutes);
app.use('/api/achievements', achievementRoutes);
app.use('/api/checkins',     checkinRoutes);
app.use('/api/admin',        adminRoutes);

app.get('/api/health', async (_req, res) => {
  const mongoose = require('mongoose');
  const User = require('./models/User');
  const userCount = await User.countDocuments().catch(() => -1);
  res.json({
    status:    'ok',
    app:       'GoalTrack Pro API (MongoDB)',
    version:   '1.0.0',
    timestamp: new Date().toISOString(),
    db:        mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    db_users:  userCount,
  });
});

app.get('/api', (_req, res) => {
  res.json({
    message: '🎯 GoalTrack Pro API — MongoDB Edition',
    health:  '/api/health',
  });
});

app.use((req, res) => res.status(404).json({ error: `Not found: ${req.method} ${req.path}` }));

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({
    error:   'Internal server error.',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

setInterval(async () => {
  try {
    const Cycle = require('./models/Cycle');
    const cycle = await Cycle.getActive();
    if (cycle) {
      const result = await runEscalationScan(cycle);
      console.log('[CRON] Escalation scan:', result);
    }
  } catch (e) {
    console.error('[CRON] Error:', e.message);
  }
}, 24 * 60 * 60 * 1000);

// ─── Bootstrap: connect DB → seed if empty → listen ───────────────────────────
async function start() {
  await connectDB();

  const User = require('./models/User');
  const userCount = await User.countDocuments();
  if (userCount === 0) {
    console.log('[DB] Empty database — seeding demo data...');
    const runSeed = require('./db/seed');
    await runSeed({ closeConnection: false });
  }

  app.listen(PORT, () => {
    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║   🎯  GoalTrack Pro API  (MongoDB)       ║');
    console.log('║   AtomQuest Hackathon 1.0                ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log(`\n  API    → http://localhost:${PORT}/api`);
    console.log(`  Health → http://localhost:${PORT}/api/health\n`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});

module.exports = app;
