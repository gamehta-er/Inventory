# DCR-2026-001 Reports Intelligence

## Request control

| Item | Value |
|---|---|
| Request ID | DCR-2026-001 |
| Requestor | Gaurav Mehta |
| Date | 2026-08-12 |
| Product baseline | 1.3.10 |
| Design System baseline | 1.0 |
| Status | APPROVED |

## Business reason

The existing Reports page presents technically correct totals but does not give managers
a clear path from inventory health to the exact assets requiring action. Reports must
support leadership, operations, and data-quality decisions without decorative controls
or untraceable calculations.

## Approved system change

- Preserve the existing AppShell, PageHeader, controls, surfaces, tokens, routes,
  filters, overlays, and responsive breakpoints.
- Replace only the Reports page composition with three report views: Leadership
  Overview, Operations Analysis, and Data Quality & Risk.
- Add report-specific shared stylesheet rules to the single approved stylesheet.
- Lock the Reports page source after acceptance so later work cannot replace its
  hierarchy without another approved Design Change Request.

## Framework impact

The change preserves the approved architecture and strengthens the reporting contract:
PostgreSQL remains authoritative, Fastify owns report queries and normalized responses,
and React presents server-owned data. KPI, drilldown, and CSV export retain one filter
scope. No database migration, permission change, import change, or hosting change is
introduced.

## Product impact

| Area | Impact |
|---|---|
| Database | Read-only use of existing normalized tables and profile registry |
| API | Adds lifecycle KPIs, profile-driven quality counts, and field-gap drilldowns |
| Permissions | Existing `report.view` and `report.export` permissions remain authoritative |
| Profiles and lookups | Active required fields drive data-quality counts automatically |
| Import | No impact |
| Reports and exports | Three live views; all actions use existing report/export endpoints |
| Activity | Existing export activity remains in place |
| UI and accessibility | Reports-only hierarchy; buttons expose accessible names and direct actions |
| Operations and release | Component-aware API/web delta only after full acceptance |

## Evidence

- Backend TypeScript check passed.
- Frontend TypeScript check passed.
- All 79 backend tests passed.
- All 33 frontend tests passed, including Reports queue, export, and quality drilldown.
- Production build passed.
- No new stylesheet, shell, breakpoint, raw color, or hosting implementation was added.

## Decision

| Item | Value |
|---|---|
| Decision | APPROVED |
| Approved by | Gaurav Mehta |
| Decision date | 2026-08-12 |
| Conditions | Every visible Reports control must remain connected to PostgreSQL-backed API behavior. |
