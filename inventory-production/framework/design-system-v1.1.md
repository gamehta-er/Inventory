# Inventory Project Design System v1.1

## Document control

| Item | Approved value |
|---|---|
| Status | APPROVED AND LOCKED |
| Product owner | Gaurav Mehta |
| Approval date | 2026-08-12 |
| Product baseline | Inventory Project 1.3.10 |
| Governing framework | Inventory Project Product and Engineering Framework v1.0 |
| Production host | IIS at `http://10.176.177.149` |
| Review trigger | An approved Design Change Request |
| Approved amendment | DCR-2026-001 Reports Intelligence |

This document freezes the verified 1.3.10 visual system with the Reports Intelligence
amendment approved by Gaurav Mehta on 2026-08-12. It does not certify every
business workflow. It prevents bug fixes, feature work, and wording changes from
quietly becoming page redesigns.

## Design principles

1. Inventory Project is a quiet, work-focused inventory tool. It prioritizes scanning,
   comparison, repeated action, clear status, and recovery from errors.
2. The first screen is the working application. Marketing pages, decorative hero
   sections, gradient illustrations, and ornamental layouts are outside scope.
3. React presents server-owned state. UI styling cannot define fields, statuses,
   validation, permissions, reporting logic, or controlled values.
4. All pages use the same shell, navigation, page-header hierarchy, controls, feedback,
   overlays, and responsive rules.
5. Product corrections extend the locked system. They do not replace it.

## Locked foundations

### Shell and navigation

- `AppShell` is the only authenticated application shell.
- The header is 68 px high and uses the official NVIDIA logo, product name, primary
  navigation, user identity, and sign-out action.
- The logo returns to Search and clears transient page state.
- Main content is centered with a maximum width of 1560 px.
- Search, Inventory, Import, Reports, Activity, and Admin retain their established
  navigation order and permission visibility.
- Browser Back closes an overlay or returns to the previous route naturally.

### Color and shape

The authoritative tokens live in `frontend/src/styles.css`:

| Token | Value | Use |
|---|---|---|
| `--green` | `#2c8d08` | Primary actions and active state |
| `--green-dark` | `#1f6904` | Links and strong brand emphasis |
| `--green-soft` | `#eef8e9` | Selected and successful surfaces |
| `--ink` | `#11151b` | Primary text |
| `--muted` | `#637083` | Secondary text |
| `--line` | `#dce3df` | Standard borders |
| `--line-strong` | `#c9d3cd` | Strong borders |
| `--surface` | `#ffffff` | Primary surface |
| `--surface-soft` | `#f7f9f8` | Secondary surface |
| `--danger` | `#b42318` | Blocking errors |
| `--warning` | `#925d00` | Non-blocking warnings |
| `--info` | `#175cd3` | Informational feedback |
| `--radius` | `8px` | Maximum standard corner radius |
| `--shadow` | `0 18px 50px rgba(18, 33, 25, 0.14)` | Overlays only |

New raw colors, page-specific palettes, larger card radii, decorative gradient blobs,
and inline visual styles are prohibited.

### Typography and density

- Font stack: Inter, system UI, Segoe UI, sans-serif.
- Letter spacing is zero.
- Page H1 is 38 px on desktop and follows the existing responsive rules.
- Panel and card headings remain compact; hero-scale typography is not used inside
  tools, cards, dialogs, or sidebars.
- Cards represent records, repeated items, or framed tools. Page sections are not
  wrapped in decorative cards, and cards are never nested inside cards.

## Locked components

| Component | Responsibility |
|---|---|
| `AppShell` | Header, navigation, identity, and page frame |
| `PageHeader` | Page eyebrow, title, supporting copy, and permitted actions |
| `Overlay` | Dialog and sheet behavior, focus, backdrop, Escape, and close |
| `RouteErrorBoundary` | Route recovery without blanking the application |
| `LoadingState` | Consistent loading and skeleton presentation |
| `PageFailure` | Actionable page-level failure state |
| `ToastRegion` | Non-blocking success, warning, and error feedback |
| `AssetCard` | Shared asset row/card presentation and selection |
| `KpiStrip` | Shared KPI summary presentation |

A page may compose these components but may not create a replacement shell, overlay,
failure pattern, selection model, or control language.

## Page contracts

- **Search:** independent text query, category shortcut, and explicit filters; shared
  asset selection and bulk actions.
- **Inventory:** category browsing, shared asset selection, page-aware bulk actions,
  and asset workspace entry.
- **Import:** persistent session status, upload/mapping/review progression, actionable
  validation, and a visible commit outcome.
- **Reports:** the locked Reports Intelligence workspace contains Leadership Overview,
  Operations Analysis, and Data Quality & Risk views. Every KPI, queue, chart,
  breakdown, quality issue, export, pagination control, and asset link must be backed by
  the PostgreSQL report contract. Decorative or unavailable controls are prohibited.
  The exact page heading is `Inventory intelligence`, with the description `Move from
  management health to the exact assets behind every number.`
- **Activity:** actor, time, action, source, changes, and direct record navigation.
- **Admin:** profiles, dropdowns, locations, users/roles, and health remain tabs in one
  control plane.
- **Asset workspace:** overview and operations use the shared overlay behavior.

Route content may evolve to meet Framework requirements. Its visual hierarchy and
interaction vocabulary remain governed by this document.

## Overlay and interaction rules

- Every overlay has one internal scrolling surface, a stable header, and stable actions.
- Backdrop click, Escape, and the close control dismiss an overlay.
- Background scrolling is prevented while an overlay is open.
- Focus returns to the initiating control after close.
- Desktop uses the bounded workspace already defined by the shared overlay.
- Tablet and mobile use the shared full-screen sheet rules.
- Buttons and cards may have restrained hover/press feedback. Motion must respect
  `prefers-reduced-motion`.

## Responsive rules

The established CSS breakpoints are locked at 1180 px, 900 px, 760 px, 680 px, and
420 px. The 760 px rule is scoped to reference sections; the other breakpoints govern
the shared layout system.
Acceptance evidence must cover:

- 1920 x 1080
- 1366 x 768
- 1280 x 720
- 768 x 1024
- 390 x 844

No page may introduce horizontal document scrolling, clipped actions, incoherent
overlap, or nested scrolling. A deliberate data table may own a labeled horizontal
scroll region without making the page itself overflow.

## Labels and printing

- Print output is isolated from the application page.
- The default physical label is 2.125 in x 1 in.
- One selected asset produces one label unless the user explicitly selects a copy count.
- Barcode, selected fields, and page count must match the preview.
- Printing changes may extend label configuration without changing the application shell.

## Change-control matrix

| Change | Design approval required | Rule |
|---|---|---|
| Business data or controlled value | No | Use Admin/profile configuration |
| Wording correction | No | Reuse existing content hierarchy and controls |
| Page workflow bug | No | Preserve shared components and add tests |
| New workflow | No, when Framework-conformant | Compose the locked system; complete impact analysis |
| Shared component defect | Product Owner acknowledgement | Preserve its public design contract and update lock evidence |
| Token, shell, navigation, breakpoint, overlay, or page hierarchy | Yes | Approved Design Change Request and Design System revision |
| Page-specific redesign | Not permitted | Resolve through the shared system |

## Enforcement

1. `framework/design-lock.json` records the exact approved source files and SHA-256
   hashes.
2. `framework/design-approval.json` binds this document and the lock manifest to
   Gaurav Mehta's approval.
3. `operations/Test-DesignLock.ps1` checks hashes, tokens, shared components,
   stylesheet count, prohibited inline styles, responsive rules, print isolation, and
   IIS ownership.
4. `operations/Test-FrameworkConformance.ps1` runs the design lock on every normal and
   release conformance check.
5. A failed lock gate blocks packaging. Debugging never creates a new version or a
   replacement design.

## Amendment procedure

Only Gaurav Mehta can approve a Design Change Request. An approved request must state
the business reason, affected requirements, components, routes, responsive impact,
accessibility impact, screenshots at all five widths, migration/API impact, and rollback
behavior. The Design System version and lock hashes are updated only after that request
is accepted.
