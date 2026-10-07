# Developer conventions

How the code is organized and the rules every module follows. Read this before adding a feature.

## Layout

```
packages/shared   enums, Arabic labels, formatters, business rules (fees, results, date ranges)
apps/api          Express 5 + Drizzle (Postgres; PGlite in dev/tests)
  src/db/schema.ts          the whole schema — one file
  src/lib/                  errors, validate, context (scopes), scope (classes/subjects), cursors, audit, users, security
  src/routes/               auth, me, lookups, files, public (demo)
  src/modules/<module>/     feature endpoints — each exports register({ school, student }, deps)
  test/<module>.test.ts     vitest + supertest against in-memory PGlite (test/helpers.ts)
apps/web          React 19 + Mantine 8 (RTL), TanStack Query, React Router 7
  src/components/           MobilePage, Tile/TileGrid, RangeFilter, ClassSubjectSelect, IsoDateInput, States, AdminPage
  src/features/<module>/    feature screens; index.tsx exports the pages/panels routes.tsx uses
```

Commands (from the repo root unless noted):

| What | Command |
|---|---|
| Dev servers (API :3000 + web :5173 with proxy) | `npm run dev` |
| API tests (one file) | `cd apps/api && npx vitest run test/lessons.test.ts` |
| All tests | `npm test` |
| Typecheck | `npm run typecheck` |
| Build (what Render runs) | `npm run build` then `npm start` |
| New migration after editing schema.ts | `npm run db:generate` |
| Reset local data to the demo set | `npm run seed` |

## API

### Routing

- `/api/schools/:schoolId/*` is for staff. `req.school` is set, and the user holds
  `admin`/`supervisor`/`teacher` there.
- `/api/students/:studentId/*` is for the student's guardians and that school's staff.
  `req.student` and `req.school` are set. `req.student.access` is `'guardian' | 'staff'`.
- A module mounts its routers in `register()`:
  ```ts
  export function register({ school, student }: ModuleRouters, { db }: ModuleDeps) {
    school.use('/lessons', staffRouter(db));     // → /api/schools/:schoolId/lessons
    student.use('/lessons', guardianRouter(db)); // → /api/students/:studentId/lessons
  }
  ```
  Create sub-routers with `Router({ mergeParams: true })`.

### Rules

- **Tenant isolation.** Every query is filtered by `schoolOf(req).id`, or reached through
  `studentOf(req)`. Never trust a `schoolId` sent in a request body. Every id that comes from
  a client must be checked to belong to the school, e.g. with `assertClassInSchool`,
  `assertSubjectInSchool`, `assertStudentsInClass`, or a `where school_id = …` lookup that
  returns 404.
- **Roles.**
  - Use `requireRole('admin', 'supervisor')` as middleware, or `hasRole(req, …)` inline.
  - Teachers act only on their assigned (class, subject) pairs: use `assertCanTeach(db, req,
    classId, subjectId)` and `assertCanAccessClass(db, req, classId)`.
  - Admins and supervisors may act on the whole school.
- **Validation.** `parse(schema, req.body)` with zod and the helpers in `lib/validate.ts`:
  - `zId`, `zDate` (YYYY-MM-DD), `zText()`, `zOptText()`, `zOptDate`, `zMoney`.
  - Invalid input becomes a 400 whose `details` carry per-field Arabic messages.
- **Errors.** Throw `badRequest` / `forbidden` / `notFound` / `conflict` from `lib/errors.ts`.
  - **User-facing messages are Arabic.**
  - Unique-violation becomes 409, and FK-violation becomes 409 with an "in use" message.
- **Responses.**
  - Plain JSON. Dates are `YYYY-MM-DD` strings. Timestamps are ISO strings.
  - Create returns `201` + the created object. Delete returns `{ ok: true }`.
  - Lists are arrays, unless a summary needs an object.
- **Today.** Use `schoolToday(schoolOf(req))`, never `new Date()`, for calendar logic. Date
  ranges come from `dateRangeBounds(range, today, school.weekStart)` in `@slash/shared`.
- **Derived numbers are computed.** Fee balances use `computeFeeAccount`. Result sheets use
  `computeResultSheet(rows, school.gradeBands)`.
- **Audit.** Call `audit(db, { schoolId, actorId, entity, entityId, action, before, after })`
  when scores, absences, payments, behavior incidents or student status change.
- **Badges.** A guardian list endpoint calls `markSeenIfGuardian(db, req, module, scope?)`, so the
  matching unread badge clears. `scope` is the subject id for per-subject badges. The
  `/summary` endpoint (comms module) counts items newer than each cursor. If there is no cursor,
  the baseline is the guardian link's `created_at`.
- **Transactions.** Use `db.transaction(async (tx) => …)`. `tx` can be passed wherever a `Db` is
  expected.
- Don't change `schema.ts` casually. A schema change needs a migration
  (`npm run db:generate`), and the change must be reviewed as a whole.

### Tests

Each module has `test/<module>.test.ts`:

```ts
let t: TestContext;
beforeAll(async () => { t = await setupTestApp(); });
afterAll(() => t.close());
it('…', async () => {
  const agent = await t.loginAs(t.fx.users.teacher.phone);
  const res = await agent.post(`/api/schools/${t.fx.schoolA.id}/lessons`).send({ … });
  expect(res.status).toBe(201);
});
```

The fixture (`test/helpers.ts`) has two schools, classes 5-أ / 5-ب / 6-أ, a teacher scoped to
math 5-أ and arabic 5-ب, a supervisor, an admin, guardians and students. Every module tests:
- the happy path;
- validation;
- **authorization**:
  - another school's admin gets 403/404;
  - a teacher outside their assignment gets 403;
  - another student's guardian gets 403;
  - guardians cannot call staff routes.

## Web

- **Screen frames.**
  - Guardian (`/g/:studentId/*`) and staff (`/s/:schoolId/*`) screens are phone-first: wrap each
    one in `<MobilePage title="…">`, which renders the sketch's header (name, school, "الرجوع",
    red title).
  - Director screens (`/a/:schoolId/*`) use `<AdminPage title actions>` inside the sidebar shell.
- **Data.** Use `api.get/post/put/patch/delete` from `src/api/client.ts` with TanStack Query.
  - Query keys: `['students', studentId, '<module>', …]` and `['schools', schoolId, '<module>', …]`.
  - After a mutation, invalidate the module prefix.
  - Wrap results in `<QueryState query={q} empty="…" isEmpty={…}>` for loading, error and empty
    states.
- **Shared pieces.**
  - `useScope(schoolId)`: classes × subjects the user can act on, plus `school.today`.
  - `useClassStudents(schoolId, classId)`.
  - `ClassSubjectSelect`, `RangeFilter`, `IsoDateInput` (ISO string values), `Tile`/`TileGrid`.
  - `notifySuccess` / `notifyError`.
  - `formatDate` / `formatMoney` and the label maps from `@slash/shared`.
- **Copy.** All copy is Arabic, with wording that follows the sketch. Use Western digits and
  `d/M/yyyy` dates.
- **Exports.** A feature's `index.tsx` keeps the exact export names that `routes.tsx` (and other
  features, for the admin student profile) import.
- No new npm dependencies without a good reason. Mantine (core, dates, form, notifications),
  tabler icons, dayjs and papaparse are available.
