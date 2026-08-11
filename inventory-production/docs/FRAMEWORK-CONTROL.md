# Framework Control

Inventory Project is governed by **Inventory Project Product and Engineering Framework v1.0**. Gaurav Mehta is the Product Owner and approval authority.

## Current State

- The Saturday source is the only implementation candidate.
- Candidate tag: `inventory-framework-v1.0-candidate`.
- Framework status: `PENDING_APPROVAL`.
- Releases and production changes are frozen until approval and conformance are complete.
- IIS remains the production host. Sites hosting is not used for this application.

## Governing Artifacts

- `output/pdf/Inventory-Project-Product-and-Engineering-Framework-v1.0.pdf`: formal governing document.
- `framework/approval.json`: controlled Product Owner decision.
- `framework/requirements.json`: generated machine-readable requirement catalogue.
- `framework/conformance-evidence.json`: evidence status for every requirement.
- `docs/CONFORMANCE-BACKLOG.md`: generated unresolved conformance work.

The PDF generator is the source for requirement wording and the approved 19-field contract. Run `npm run framework:export` after an approved framework amendment. Never edit the generated catalogue or backlog directly.

## Change Workflow

1. Identify the governing requirement ID or approve a Framework Change Request.
2. Record impact on database, API, registry, permissions, import, reports, activity, UI, tests, and operations.
3. Implement the smallest component-scoped change in source.
4. Add automated evidence referencing the requirement ID.
5. Update `framework/conformance-evidence.json` only with verifiable evidence paths.
6. Run catalogue, source, workflow, browser, database, and operations gates.
7. Assign a release version only after every applicable requirement passes.

## Release Freeze

All package builders call the Framework release gate. The gate fails while approval is pending, evidence is incomplete, the PDF hash differs, or a requirement has failed. Direct invocation of a package builder does not bypass this rule.

## Recording the Product Owner Decision

The decision must be explicit. From the candidate source root, Gaurav Mehta records it with `operations/Record-FrameworkApproval.ps1`. The script binds the decision to the current PDF SHA-256 and Git commit. Merely requesting implementation does not silently approve the governing document.
