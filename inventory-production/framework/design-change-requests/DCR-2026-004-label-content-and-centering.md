# DCR-2026-004 Label Content and Print Centering

## Request control

| Item | Value |
|---|---|
| Request ID | DCR-2026-004 |
| Requestor | Gaurav Mehta |
| Date | 2026-08-13 |
| Product baseline | Implementation candidate 1.3.13 |
| Design System baseline | 1.1 |
| Status | APPROVED |

## Business reason

Asset labels need enough model context to identify NVIDIA hardware without opening the
application. The existing preview is centered, but physical print placement can be left
aligned by the browser or printer page. Label content and placement must remain consistent
between preview and print.

## Approved system change

- Preserve the 2.125 inch by 1 inch physical label and mandatory Code 128 barcode.
- Preserve Product Name, Model Number, Asset Tag, and Serial Number as the default fields.
- Allow Super Users and Privileged Administrators to optionally include Board SKU, GPU SKU,
  and Board Architecture for an individual print job.
- Read all label values from the existing PostgreSQL-backed asset and model records.
- Omit optional model metadata when its stored value is empty.
- Use one shared physical-label renderer for preview and print.
- Center every physical label and its content in both preview and browser print output.
- Preserve the rule that one included asset creates exactly one printed label page.

## Responsive and accessibility impact

- The existing wide overlay, field checkboxes, keyboard behavior, focus handling, and narrow
  full-screen sheet remain unchanged.
- New field choices use the existing accessible checkbox control.
- Dense labels reduce text size only when optional model metadata is selected; the barcode
  remains isolated, centered, and readable.

## Framework impact

PostgreSQL remains authoritative for label data. Fastify validates the supported field list,
enforces elevated customization, and audits the print job. React presents the selected fields
through the existing label overlay. No schema, role, route, hosting, or runtime dependency is
introduced.

## Release impact

| Area | Impact |
|---|---|
| Database | None |
| API | Label response includes three existing model attributes |
| Permissions | Existing Super User and Privileged Administrator customization rule remains authoritative |
| UI | Three optional field controls and compact metadata rendering |
| Printing | Physical labels are centered on the print page |
| Deployment | API, web, and operations component delta after acceptance |
| Rollback | Restore the previous API, web, and operations components; PostgreSQL remains unchanged |

## Evidence

- Frontend and backend TypeScript checks pass.
- Label component tests verify elevated field selection, regular-user restrictions, and one
  physical label per included asset.
- Backend label contract tests verify the model fields, stable default set, print isolation,
  and centered physical print rules.
- Release remains conditional on the complete automated, build, design-lock, and conformance
  gates.

## Decision

| Item | Value |
|---|---|
| Decision | APPROVED |
| Approved by | Gaurav Mehta |
| Decision date | 2026-08-13 |
| Conditions | The default field set and physical label size remain stable; future label layout changes require another approved Design Change Request. |
