# DCR-2026-002 Management Command Center

## Request control

| Item | Value |
|---|---|
| Request ID | DCR-2026-002 |
| Requestor | Gaurav Mehta |
| Date | 2026-08-12 |
| Product baseline | 1.3.11 |
| Design System baseline | 1.1 |
| Status | APPROVED |

## Business reason

Reports is the management landing page for users with reporting permission. It must
present a consistent operational snapshot and provide direct paths from each number to
the matching assets or workflow. Search remains an independent operational page.

## Approved system change

- Make Reports the role-aware home page for users with `report.view`; other users enter
  Search.
- Keep Search available at `/search` and keep the NVIDIA brand link role-aware.
- Add a Management Command Center view ahead of the existing Leadership, Operations,
  and Data Quality views.
- Add one PostgreSQL-backed command-center API response containing lifecycle, movement,
  data-quality, import, and recent-activity data from one read-only transaction.
- Connect every command-center KPI, queue, breakdown, activity entry, and quick action
  to an existing route or server-side drilldown.
- Preserve the approved AppShell, PageHeader, tokens, shared controls, stylesheet,
  breakpoints, permissions, and IIS production architecture.

## Framework impact

PostgreSQL remains authoritative. Fastify owns the snapshot, permission checks, report
filters, and initialized response contract. React renders the response and cannot invent
counts. No schema migration, status change, role change, import rule change, or hosting
change is introduced.

## Product impact

| Area | Impact |
|---|---|
| Database | Read-only queries against existing normalized inventory, import, and activity tables |
| API | Adds `/api/v1/reports/command-center` using a consistent read-only transaction |
| Permissions | Existing `report.view`, `import.execute`, `activity.view`, and admin permissions remain authoritative |
| Reports | Adds the default Command Center while preserving all three detailed report views |
| Search and navigation | Search moves to `/search`; role-aware home routes managers to Reports |
| UI | Adds only Reports-specific composition using the locked component and token system |
| Operations | API/web/operations delta only after conformance and browser workflow acceptance |

## Decision

| Item | Value |
|---|---|
| Decision | APPROVED |
| Approved by | Gaurav Mehta |
| Decision date | 2026-08-12 |
| Conditions | Every visible control must navigate, filter, refresh, export, or open an authorized workflow backed by the production API. |
