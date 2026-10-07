# slashSchool

A school-to-home platform for private schools (Arabic-first, RTL). Staff record the school
day: lessons, homework, absence, exams, grades, behavior and fees. Guardians follow each child
from their phone. The director runs the school from a web dashboard.

| Surface | Users | URL prefix |
|---|---|---|
| Phone-first web app | Guardians | `/g/:studentId` |
| Phone-first web app | Supervisors, teachers | `/s/:schoolId` |
| Desktop dashboard | Director / admin | `/a/:schoolId` |

## Try it on Render (about 5 minutes)

The repo includes a [Render Blueprint](render.yaml). It defines one free web service (the API
plus the web app) and one free Postgres database. Every push to the linked branch redeploys.

1. Sign in at [render.com](https://render.com) and connect your GitHub account.
2. Go to **New → Blueprint**, pick `musabibr/slashSchool`, and choose the branch to deploy.
3. Click **Apply**. The first build takes a few minutes. On first start the server applies the
   database migrations and, because `DEMO_MODE=true`, loads a demo dataset.
4. Open the service URL. The login page lists one-click demo accounts.

### Demo data and logins

No typing is needed: the login page shows one card per role. You can also share direct links,
which log in on open:

- `/demo/guardian`
- `/demo/teacher`
- `/demo/supervisor`
- `/demo/admin`

Inside the app, the yellow ⚗ button switches role or resets the demo data.

The demo dataset is generated around today's date (Khartoum time):

- **Schools:** two schools (أولاد عمار المتوسطة / الثانوية), 6 classes, 120 students,
  16 teachers, and full weekly timetables.
- **School life:** 15 school days of lessons and homework, about 40 days of attendance, published
  term and monthly exam results, graded and upcoming quizzes, behavior incidents, teacher
  evaluations, fee plans with payments and arrears, announcements, and calendar events.
- **The sketch's guardian:** the demo guardian (إبراهيم عبدالله أحمد) has three children. مصعب's
  fees and absences match the sketch.

Each deploy reloads the latest demo dataset automatically.

Phone and PIN, if you prefer to log in by hand:

| Role | Phone | PIN |
|---|---|---|
| Director (both schools) | `0900000001` | `1234` |
| Supervisor (both schools) | `0900000002` | `1234` |
| Teacher | `0900000003` | `1234` |
| Guardian (3 children, 2 schools) | `0912345678` | `1234` |

- Try first-time activation with the code `DEMO-2025-AB`.
- After logging in as the guardian, link another child with **+** and the code `DEMO-LINK-01`.
- **Reset demo data** on the login page restores everything.

### Free-plan notes

- The free web service sleeps after about 15 minutes idle. The first request after that takes
  about a minute.
- Render's free Postgres expires after 30 days. Upgrade the database plan, or recreate it (the
  demo data reloads automatically), when that happens.
- Before real use, set `DEMO_MODE=false` in the service's environment. This removes the demo
  logins and the reset button.

## Local development

Requires Node 20.19+ (22 recommended). Postgres is optional: without `DATABASE_URL` the API uses
an embedded PGlite database stored in `apps/api/.data/`.

```bash
npm install
DEMO_MODE=true npm run dev     # API on :3000, web on :5173 (proxied); open http://localhost:5173
npm test                       # shared rules + API tests (in-memory Postgres)
npm run typecheck
npm run build && DEMO_MODE=true npm start   # production build on :3000, as Render runs it
npm run seed                   # wipe local data and reload the demo dataset
```

## Project layout

```
packages/shared   enums, Arabic labels, formatters, fee/result/date rules (+ tests)
apps/api          Express 5 + Drizzle ORM (Postgres / PGlite), modules per feature, vitest + supertest
apps/web          React 19 + Mantine 8 (RTL), TanStack Query, React Router 7
docs/             product breakdown, architecture, developer conventions
render.yaml       Render Blueprint
```

## Docs

- [Sketch breakdown](docs/sketch-breakdown.md): every wireframe screen, the inconsistencies
  found in it, and the decisions taken.
- [MVP architecture](docs/mvp-architecture.md): scope, stack, tenancy and RBAC, domain model,
  API, deployment.
- [Developer conventions](docs/dev/conventions.md): how modules, endpoints, tests and screens are
  written.
