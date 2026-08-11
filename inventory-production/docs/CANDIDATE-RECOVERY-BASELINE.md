# Candidate Recovery Baseline

## Decision

The `inventory-production` source is the only implementation candidate. It is not an approved production release. No new product version is assigned during recovery.

## Traceability

- Candidate branch: `codex/inventory-framework-lock`
- Candidate tag: `inventory-framework-v1.0-candidate`
- Candidate source version: `1.3.2`
- Governing framework: `Inventory Project Product and Engineering Framework v1.0`
- Framework approval: pending Product Owner decision

## Confirmed Evidence

- Architecture remains React, Fastify, PostgreSQL, and IIS.
- Backend TypeScript check passes.
- Backend automated suite passes 42 tests.
- Frontend TypeScript check passes.
- Existing frontend tests do not cover every route or complete workflow.
- Existing production acceptance checks HTTP responses and component versions but do not validate rendered browser workflows.
- Candidate PostgreSQL objects are currently created in `public`; Framework v1.0 requires a controlled move to `invmgmt` with least-privilege ownership and grants.
- Production `/api/v1/version`, `/version.json`, and readiness endpoints were unreachable from the current workstation on 2026-08-11. The deployed web, API, schema, import contract, and release-ledger versions are therefore unconfirmed.
- Sites hosting is not initialized and is prohibited for this application. IIS remains the production host.

## Release Blockers

1. Product Owner approval is not recorded.
2. Production component versions are not captured.
3. PostgreSQL `invmgmt` migration and ownership evidence are incomplete.
4. Requirement-linked API, registry, permission, import, report, activity, browser, responsive, printing, and operations evidence is incomplete.
5. Complete workflow acceptance has not passed through IIS.

## Recovery Order

After approval, work proceeds only in this dependency order:

1. PostgreSQL schema and ownership.
2. API response contracts.
3. Profile-registry propagation.
4. Roles and permissions.
5. Import workflow.
6. Reports and exports.
7. Activity and direct links.
8. Page stability and responsive UI.
9. Operations and release validation.

Each correction references Framework requirement IDs and supplies automated evidence. A failed component is corrected behind the same contracts; it does not trigger a new architecture or framework.
