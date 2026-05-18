# GoalTrack Pro

**Goal Setting & Achievement Tracking Portal**  
Built for AtomQuest Hackathon 1.0

---

## Live Links

| | |
|---|---|
| **Frontend** | https://peaceful-biscuit-a774c4.netlify.app |
| **Backend API** | https://goaltrack-36ze.onrender.com |
| **API Health** | https://goaltrack-36ze.onrender.com/api/health |

> **Note:** The backend runs on Render's free tier and may take 30 to 50 seconds to wake from sleep. If the page loads but shows no data, please wait a moment and reload. Everything works reliably once the server is warm.

---

## What It Does

GoalTrack Pro replaces the annual spreadsheet-and-email goal-setting cycle with a structured, role-aware portal. Goals are created, approved, locked, and tracked through a full quarterly check-in system - with every change logged in an audit trail.

### Phase 1 - Goal Setting

- Employees draft goals with a **thrust area**, **UoM type**, **target value**, and **weightage**
- Hard validation rules enforced everywhere: minimum 10% per goal, total must equal exactly 100%, maximum 8 goals per employee per cycle
- Managers review goal sheets inline, can edit targets before approving, and can return sheets for rework with a note
- Goals auto-lock the moment a sheet is approved - the record is permanent
- Admin can push shared departmental KPIs to multiple employees simultaneously

### Phase 2 - Achievement Tracking

- Employees log quarterly actuals against locked targets
- System computes achievement scores automatically using four UoM-aware formulas (see below)
- Managers leave structured check-in comments per goal per quarter
- Quarter windows are enforced using configurable cycle dates
- Escalation engine flags overdue submissions and unapproved sheets to Admin

### Reporting

- Achievement reports exportable as **CSV** and **Excel**
- Real-time completion dashboard with submission and approval rates per employee
- Analytics module: QoQ trend at org / department / team / individual levels, manager effectiveness dashboard, completion heatmap by department

---

## Score Formulas

| UoM Type | Formula | Example |
|---|---|---|
| Min (Numeric) | `score = actual / target` | Sales 42L actual vs 50L target = 84% |
| Max (Numeric) | `score = target / actual` | 35 bugs vs 50 target = 143% |
| Timeline | On time = 100%, −3.3% per day late | 5 days late = 83% |
| Zero-based | 0 actual = 100%, anything else = 0% | Safety incidents: 0 = 100% |

---

## Tech Stack

```
Frontend    Vanilla JavaScript + HTML (no framework)
            Deployed on Netlify

Backend     Node.js 20 + Express 4
            Deployed on Render (free tier)

Database    MongoDB Atlas M0
            Mongoose ODM, TLS encrypted connection

Auth        JWT Bearer tokens, bcrypt password hashing
Analytics   MongoDB aggregation pipelines
Reports     SheetJS (xlsx) for Excel, native CSV
```

---

## Project Structure

```
goaltrack/
├── frontend.html              Single-page app - all three roles in one file
├── api.js                     Frontend API client - every server call lives here
├── app.js                     Frontend logic - rendering, state, polling, events
│
└── server/
    ├── server.js              Express entry point - routes, daily cron, middleware
    ├── config/
    │   └── db.js              MongoDB connection with in-memory dev fallback
    ├── models/
    │   ├── User.js            Roles, bcrypt hashing, manager reference
    │   ├── Goal.js            Goal + GoalSheet schemas - achievements embedded
    │   ├── AuditLog.js        Audit, Escalation, CheckIn, UnlockRequest models
    │   ├── Cycle.js           Cycle schema with per-quarter window dates
    │   └── CheckInPeriod.js   Check-in campaigns and employee assignment models
    ├── routes/
    │   ├── auth.js            Login, admin-only register, user management
    │   ├── goals.js           Full goal lifecycle - CRUD, submit, approve, lock
    │   ├── achievements.js    Quarterly updates, score computation, comments
    │   ├── checkins.js        Check-in campaigns, assignments, schedule
    │   └── admin.js           Dashboard, analytics, escalations, reports
    ├── middleware/
    │   ├── auth.js            JWT verification and role-guard middleware
    │   └── scoring.js         UoM score engine - min, max, timeline, zero
    ├── lib/
    │   ├── checkinSchedule.js Calendar phase detection, no hardcoded months
    │   └── checkinAssignments.js Access validation with calendar fallback
    └── db/
        └── seed.js            Demo seeder - auto-runs on empty database
```

---

## Getting Started Locally

**Prerequisites:** Node.js 18+, MongoDB (local or Atlas URI)

```bash
git clone https://github.com/Tanishk109/goaltrack.git
cd goaltrack/server

npm install

cp .env.example .env
# Edit .env and set:
# MONGO_URI=mongodb://localhost:27017/goaltrack
# JWT_SECRET=your-secret-here

node server.js
# The database seeds demo data automatically on first run

# Open http://localhost:3000
```

If you do not have a local MongoDB, set `USE_MEMORY_DB=true` in your `.env` and the app will start an in-memory MongoDB instance automatically (requires `mongodb-memory-server` which is in devDependencies).

---

## Demo Accounts

All accounts use the password `password123`.

| Role | Email | Department |
|---|---|---|
| Employee (John Doe) | employee@company.com | Engineering |
| Employee (Priya Sharma) | priya@company.com | Engineering |
| Employee (Rahul Verma) | rahul@company.com | Engineering |
| Employee (Aman Singh) | aman@company.com | Product |
| Manager (Ravi Kumar) | manager@company.com | Engineering |
| Admin / HR | admin@company.com | HR |

**Recommended starting point:** Log in as `aman@company.com`. His goal sheet is blank so you can walk through the full creation flow from scratch.

---

## API Reference

Base URL: `https://goaltrack-36ze.onrender.com/api`

All protected routes require `Authorization: Bearer <token>`.

### Auth

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/auth/login` | Public | Login, returns JWT |
| POST | `/auth/register` | Admin only | Create a new user |
| GET | `/auth/me` | Any | Current user profile |
| GET | `/auth/users` | Manager + Admin | List users |

### Goals

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/goals/my-sheet` | Employee | Get or create goal sheet |
| POST | `/goals` | Employee | Add a goal |
| PATCH | `/goals/:id` | Employee + Manager | Edit a goal |
| DELETE | `/goals/:id` | Employee | Delete a goal (pre-approval) |
| POST | `/goals/submit/:sheet_id` | Employee | Submit for approval |
| POST | `/goals/approve/:sheet_id` | Manager + Admin | Approve and lock |
| POST | `/goals/return/:sheet_id` | Manager + Admin | Return for rework |
| POST | `/goals/unlock/:id` | Admin | Unlock a single goal |
| POST | `/goals/push-shared` | Admin + Manager | Push shared KPI |
| POST | `/goals/unlock-request/:id` | Employee | Request unlock |
| GET | `/goals/unlock-requests` | Admin | View unlock requests |
| PATCH | `/goals/unlock-requests/:id/approve` | Admin | Approve request |
| PATCH | `/goals/unlock-requests/:id/reject` | Admin | Reject request |

### Achievements

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/achievements` | Employee | Save quarterly achievement |
| GET | `/achievements/team` | Manager + Admin | Team achievement data |
| POST | `/achievements/checkin` | Manager + Admin | Add check-in comment |

### Check-ins

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/checkins/schedule` | Any | Phase schedule for cycle |
| POST | `/checkins/launch` | Manager + Admin | Launch a check-in round |
| GET | `/checkins/periods` | Manager + Admin | All check-in periods |
| GET | `/checkins/my-assignments` | Employee | Pending check-in tasks |

### Admin

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/admin/dashboard` | Manager + Admin | Summary stats |
| GET | `/admin/analytics` | Manager + Admin | QoQ trend, dept breakdown, heatmap |
| GET | `/admin/report` | Manager + Admin | Full achievement report |
| GET | `/admin/escalations` | Manager + Admin | Active escalations |
| POST | `/admin/escalations/trigger` | Admin | Run escalation scan now |
| GET | `/admin/audit` | Admin | Audit trail |
| POST | `/admin/cycles` | Admin | Create a cycle |

---

## Key Design Decisions

**No frontend framework.** The entire UI is one HTML file and two JS files. Zero build pipeline, instant Netlify deploys, no version conflicts, no node_modules on the frontend side. The bundle the browser downloads is exactly what was written.

**Decoupled frontend and backend.** The frontend works identically whether served from Express locally or from Netlify globally. The `API_BASE` in `api.js` auto-detects the environment.

**Achievements embedded in goals.** Each `Goal` document stores its quarterly achievements as a sub-document array. This makes fetching a full goal sheet - including all quarterly data - a single database query with no joins.

**Calendar-first with campaign override.** The check-in system works in two modes. Without a launched campaign, it enforces calendar windows from the cycle's configured dates. When a manager launches a campaign, it enforces assignment membership and deadline. This means Phase 2 works from day one without requiring managers to explicitly launch anything.

**Audit trail on every post-lock change.** Every goal unlock, sheet approval, achievement update, and admin action writes to the `AuditLog` collection with actor, timestamp, before/after snapshots, and IP address. Nothing gets lost.

---

## Environment Variables

```env
# Required
MONGO_URI=mongodb+srv://...
JWT_SECRET=a-long-random-secret

# Optional
PORT=3000
JWT_EXPIRES_IN=7d
NODE_ENV=production
FRONTEND_URL=https://peaceful-biscuit-a774c4.netlify.app

# Dev only
USE_MEMORY_DB=true   # starts embedded MongoDB, no Atlas needed
```

---

## Bonus Features Implemented

- **Employee Unlock Request Flow** - employees can request goal unlocks with a reason; admin approves or rejects; goal unlocks automatically on approval; all logged to audit trail
- **Escalation Engine** - daily cron scans for employees who have not submitted, sheets not approved after N days, and overdue check-in assignments; escalations visible to admin with resolve and remind actions
- **Real-time Notifications** - 15-second polling updates the notification bell with pending approvals (manager), pending unlock requests (admin), and resolved unlock requests (employee)
- **Analytics Module** - QoQ achievement trend at org, department, team, and individual levels; completion heatmap by department and quarter; manager effectiveness dashboard comparing approval rates and check-in completion across L1 managers

---

## Developer

**Tanishk Mittal**  
tanishkmittal38@gmail.com  
+91 9728014818

This has been one of the most fulfilling projects I have built. Every feature from the goal lifecycle to the escalation engine to the analytics charts was designed and debugged with care. I genuinely enjoyed every part of it and I am grateful for this hackathon and everything I learned while building it.

---

*AtomQuest Hackathon 1.0  (May 2026)*
