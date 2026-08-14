# DCR-2026-005 Search Criteria Recovery

## Request control

| Item | Value |
|---|---|
| Request ID | DCR-2026-005 |
| Requestor | Gaurav Mehta |
| Date | 2026-08-13 |
| Product baseline | Implementation candidate 1.3.14 |
| Design System baseline | 1.1 |
| Status | APPROVED |

## Business reason

Search text, hardware-family shortcuts, fleet status, and profile filters can all narrow the
same results, but the current page does not present them as one recoverable state. Users can
reach a filtered result set without a dependable way to understand or remove each criterion,
clear everything, share the result, or use Browser Back to restore the prior result set.

## Approved system change

- Keep the approved DCR-2026-003 NVIDIA Hardware Search hierarchy and visual language.
- Show one Applied Criteria bar directly above Results whenever any criterion is active.
- Present Search, Family, Availability, profile category, and each profile field as removable
  criteria chips with user-facing labels and values.
- Keep a visible `Clear all` command whenever criteria are active.
- Let the search-field close control clear only the applied text query.
- Let `Clear Filters` remove profile filters, the family shortcut, and fleet availability while
  preserving the applied text query.
- Let an active family or fleet-status control toggle itself off.
- Show the active facet count on both Filters buttons.
- Make the empty-result recovery action clear all criteria in one step.
- Store applied criteria in the URL so shared links and Browser Back restore the same query.
- Reset asset selection and refresh results immediately after an applied criterion changes.

## Responsive and accessibility impact

- Criteria use accessible buttons whose names identify the exact criterion being removed.
- Desktop wraps criteria in the existing content width; narrow screens use one bounded
  horizontal chip row and a full-width Clear all action without page overflow.
- Existing focus, reduced-motion, shared button, filter drawer, and route-error behavior remain
  authoritative.

## Framework impact

This change implements UX-003, UX-006, and UX-007. React owns only the URL representation and
presentation of applied criteria. Fastify remains authoritative for search execution, profile
fields, controlled values, counts, and permissions. PostgreSQL, API routes, data contracts,
roles, hosting, and runtime dependencies do not change.

## Release impact

| Area | Impact |
|---|---|
| Database | None |
| API | None; existing asset query parameters are reused |
| Permissions | None |
| UI | Applied criteria, removable chips, active counts, toggle-off controls, and URL history |
| Deployment | Component-aware web and operations delta after acceptance |
| Rollback | Restore the previous web and operations components; PostgreSQL remains unchanged |

## Evidence

- Frontend TypeScript check passes.
- Search tests verify independent query, family, lifecycle, selection, export, and label actions.
- Search recovery tests verify URL initialization, user-facing profile values, one-chip removal,
  facet clearing that preserves text, full reset, and Browser Back restoration.
- Release remains conditional on the complete automated, build, design-lock, and conformance
  gates.

## Decision

| Item | Value |
|---|---|
| Decision | APPROVED |
| Approved by | Gaurav Mehta |
| Decision date | 2026-08-13 |
| Conditions | The DCR-2026-003 Search hierarchy remains locked; future Search redesigns require another approved Design Change Request. |
