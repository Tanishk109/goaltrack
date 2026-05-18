// db/seed.js — Seeds MongoDB with demo users, cycle, goals, and audit logs
// Run: npm run seed
// Or imported by server.js when the database is empty

require('dotenv').config();
const connectDB = require('../config/db');
const User      = require('../models/User');
const Cycle     = require('../models/Cycle');
const { Goal, GoalSheet } = require('../models/Goal');
const AuditLog  = require('../models/AuditLog');

async function runSeed({ closeConnection = true } = {}) {
  await connectDB();
  console.log('🌱 Seeding MongoDB...\n');

  await Promise.all([
    User.deleteMany({}),
    Cycle.deleteMany({}),
    GoalSheet.deleteMany({}),
    Goal.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);

  const admin   = await User.create({ name: 'HR Admin',     email: 'admin@company.com',    password: 'password123', role: 'admin',    department: 'HR' });
  const manager = await User.create({ name: 'Ravi Kumar',   email: 'manager@company.com',  password: 'password123', role: 'manager',  department: 'Engineering' });
  const john    = await User.create({ name: 'John Doe',     email: 'employee@company.com', password: 'password123', role: 'employee', department: 'Engineering', manager: manager._id });
  await User.create({ name: 'Priya Sharma', email: 'priya@company.com', password: 'password123', role: 'employee', department: 'Engineering', manager: manager._id });
  await User.create({ name: 'Rahul Verma',  email: 'rahul@company.com', password: 'password123', role: 'employee', department: 'Engineering', manager: manager._id });
  await User.create({ name: 'Aman Singh',   email: 'aman@company.com',  password: 'password123', role: 'employee', department: 'Product',     manager: manager._id });

  console.log('✅ Users created (password: password123 for all)');

  const now = new Date();
  const cycle = await Cycle.create({
    name:           'FY 2025-26',
    goalOpenDate:   new Date(now.getTime() - 5 * 86400000),
    goalCloseDate:  new Date(now.getTime() + 25 * 86400000),
    q1Open:         new Date(now.getTime() - 2 * 86400000),
    q2Open:         new Date(now.getTime() + 60 * 86400000),
    q3Open:         new Date(now.getTime() + 120 * 86400000),
    q4Open:         new Date(now.getTime() + 180 * 86400000),
    status:         'active',
    escalationDays: 5,
    createdBy:      admin._id,
  });
  console.log('✅ Cycle created: FY 2025-26');

  const sheet = await GoalSheet.create({
    user:        john._id,
    cycle:       cycle._id,
    status:      'approved',
    submittedAt: new Date(Date.now() - 10 * 86400000),
    approvedAt:  new Date(Date.now() - 8 * 86400000),
    approvedBy:  manager._id,
  });

  const goalsData = [
    { thrustArea: 'Revenue Growth',      title: 'Increase Sales Revenue',       uomType: 'min',     targetValue: '50',  weightage: 25, locked: true, achievements: [{ quarter: 'Q1', actualValue: '42', status: 'on-track',   score: 84 }] },
    { thrustArea: 'Quality Improvement', title: 'Reduce Bug Backlog',         uomType: 'max',     targetValue: '50',  weightage: 20, locked: true, achievements: [{ quarter: 'Q1', actualValue: '35', status: 'completed',  score: 143 }] },
    { thrustArea: 'People Development',  title: 'Complete Leadership Training', uomType: 'percent', targetValue: '100', weightage: 15, locked: true, achievements: [{ quarter: 'Q1', actualValue: '60', status: 'on-track',   score: 60 }] },
    { thrustArea: 'Safety & Compliance', title: 'Zero Safety Incidents',        uomType: 'zero',    targetValue: '0',   weightage: 20, locked: true, achievements: [{ quarter: 'Q1', actualValue: '0',  status: 'completed',  score: 100 }] },
    { thrustArea: 'Cost Optimization',   title: 'Reduce Operational Cost',      uomType: 'max',     targetValue: '10',  weightage: 20, locked: true, achievements: [{ quarter: 'Q1', actualValue: null, status: 'not-started', score: 0 }] },
  ];

  for (const gd of goalsData) {
    await Goal.create({ sheet: sheet._id, ...gd });
  }
  console.log('✅ Goal sheet + 5 goals for John Doe');

  await AuditLog.log(manager._id, 'SHEET_APPROVED', 'goal_sheet', sheet._id, null, { approvedBy: 'Ravi Kumar' }, '127.0.0.1');
  await AuditLog.log(admin._id,   'GOAL_UNLOCKED',  'goal',       null,      null, { reason: 'Target revision' }, '127.0.0.1');
  await AuditLog.log(admin._id,   'SHARED_GOAL_PUSHED', 'goal',   null,      null, { pushedTo: 8 }, '127.0.0.1');
  console.log('✅ Audit logs seeded\n');

  if (closeConnection) {
    const { disconnectDB } = require('../config/db');
    await disconnectDB();
    console.log('🎉 Seeding complete! Run: npm run dev\n');
    process.exit(0);
  }

  console.log('🎉 Seeding complete!\n');
  return { admin, manager, john, cycle, sheet };
}

if (require.main === module) {
  runSeed().catch((err) => {
    console.error('Seed failed:', err.message);
    process.exit(1);
  });
}

module.exports = runSeed;
