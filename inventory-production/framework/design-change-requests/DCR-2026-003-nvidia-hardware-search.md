# DCR-2026-003 NVIDIA Hardware Search

## Request control

| Item | Value |
|---|---|
| Request ID | DCR-2026-003 |
| Requestor | Gaurav Mehta |
| Date | 2026-08-13 |
| Product baseline | Implementation candidate 1.3.12 |
| Design System baseline | 1.1 |
| Status | APPROVED |

## Business reason

Search is the operational entry point for finding NVIDIA hardware. The previous surface
was functional but did not communicate the hardware domain or create a strong first
impression. The approved experience must feel specific to NVIDIA hardware while
remaining fast, dense, accurate, and connected to existing inventory workflows.

## Approved system change

- Introduce one image-led Search header using an optimized official NVIDIA hardware
  image. The image is presentation-only and cannot affect inventory behavior.
- Keep the global application shell, navigation, permissions, routes, tokens, controls,
  overlays, and responsive breakpoints unchanged.
- Keep text search, hardware-family selection, lifecycle selection, and explicit profile
  filters independent.
- Present live fleet counts for Tracked, Available, Unavailable, and Attention. Labels
  must describe the exact server-owned values and cannot reinterpret a count.
- Present active inventory categories as compact hardware-family filters generated from
  the session contract.
- Preserve Add Asset, Filters, Select Page, Export CSV, Print Labels, Open Asset, empty
  state, loading state, and failure recovery behavior.
- Use the existing AssetCard and shared overlay implementations. No page-specific shell,
  modal, routing, API, database, or permission implementation is introduced.

## Responsive and accessibility impact

- Desktop keeps the hardware image, search control, fleet summary, family filters, and
  the beginning of results visible without horizontal page scrolling.
- Tablet collapses the result facts through the existing AssetCard responsive contract.
- Mobile uses a single-column search action, two-column fleet and family controls, and
  the existing compact asset rows.
- Search has a persistent accessible label, filters expose pressed state, buttons retain
  keyboard operation, the image has descriptive alternative text, and reduced-motion
  behavior remains controlled by the shared stylesheet.

## Framework impact

PostgreSQL remains authoritative for counts and categories. Fastify retains the existing
search and filter contract. React only composes the response. This change adds no schema,
API, role, import, reporting, activity, hosting, or runtime dependency.

## Release impact

| Area | Impact |
|---|---|
| Database | None |
| API | None |
| Permissions | Existing permissions remain authoritative |
| Search | Approved NVIDIA hardware composition and responsive rules |
| Inventory and other pages | No visual or behavioral change |
| Static assets | One optimized 120,005-byte JPEG |
| Runtime performance | One cacheable image; no additional request library or data query |
| Deployment | Web-only component delta after acceptance |
| Rollback | Restore the previous compiled web component; API and PostgreSQL remain running |

## Evidence

- Frontend TypeScript check passed.
- All 39 frontend tests passed.
- The focused Search test covers query, family, lifecycle, row selection, CSV export,
  and label preview behavior.
- The design lock verifies the stylesheet, Search source, and approved image hashes.
- Final release remains conditional on the production build and the approved viewport
  acceptance checks.

## Decision

| Item | Value |
|---|---|
| Decision | APPROVED |
| Approved by | Gaurav Mehta |
| Decision date | 2026-08-13 |
| Conditions | Existing Search actions remain connected and future changes cannot replace this hierarchy without another approved Design Change Request. |
