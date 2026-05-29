# Lab Hardware Inventory Management System

## Executive Summary

The Lab Hardware Inventory Management System is an internal application designed to improve visibility, accountability, and operational control for shared lab and data center hardware. The system supports fast part lookup, controlled inventory updates, structured replenishment, administrative catalog maintenance, and management-ready reporting.

The primary objective is to reduce time spent locating hardware, improve inventory accuracy, and provide reliable transaction records for operational and leadership review.

## Business Objectives

- Provide a simple customer-facing workflow for locating, taking, returning, and reporting hardware inventory.
- Improve accountability by capturing user, timestamp, quantity, part, location, and reason for every inventory movement.
- Support administrators with controlled catalog maintenance, import validation, review workflows, and structured data management.
- Provide management with clear, exportable reports for inventory status, consumption trends, replenishment activity, and audit review.
- Establish a scalable data foundation that can support barcode, QR code, and future image-based SKU identification.

## Intended Users

| User Group | Primary Responsibilities |
| --- | --- |
| Customers | Locate parts, take inventory, return inventory, and report missing or low stock. |
| Administrators | Maintain members, SKUs, locations, barcode/QR mappings, replenishment workflows, and data imports. |
| Management | Review inventory health, usage trends, exceptions, replenishment status, and audit data. |

## Phase 1 MVP Scope

Phase 1 is focused on a reliable internal pilot that can support real inventory activity without unnecessary operational complexity.

### Customer Workflow

The customer experience should be direct, guided, and task-focused.

1. Select a registered user profile or continue as a guest.
2. Choose a lookup method: Manual Search or Barcode/QR Scan.
3. Locate the correct SKU using search, scan, or manual code entry.
4. Review the matched part, available quantity, and location.
5. Confirm whether inventory is being taken or added.
6. Enter quantity and reason or ticket reference.
7. Submit the inventory update.
8. Receive confirmation and complete the session.

Customer screens should expose only the information required to complete the task. Administrative data, raw CSV content, import controls, and maintenance tools should remain outside the customer workflow.

### Manual Search

Manual search should support natural, imperfect input. Users should not be required to know exact SKU names.

Search should evaluate:

- SKU
- Part name
- Category and subcategory
- Manufacturer and model
- Aliases
- Metadata
- Location
- Physical distinguishers

Result cards should present:

- SKU
- Part name
- Category
- Available quantity
- Aisle and bin
- Key distinguisher
- Match confidence or match reason

### Barcode and QR Code Lookup

Barcode and QR code lookup is included in Phase 1.

This capability is deterministic code lookup, not image recognition. The camera is used only to read a printed barcode or QR code and convert it into text. No camera images should be stored.

Required capabilities:

- Scan barcode or QR code using the browser camera where supported.
- Provide manual code entry as a fallback.
- Match scanned codes to a SKU or serialized asset record.
- Require user confirmation before inventory quantity changes.
- Route unknown codes to administrative review.
- Prevent duplicate active codes from mapping to conflicting parts.
- Support disabled or retired codes.

Required code mapping fields:

| Field | Purpose |
| --- | --- |
| Code | Barcode or QR value. |
| Code Type | QR, barcode, asset tag, vendor label, or internal label. |
| SKU | Associated catalog SKU. |
| Asset ID | Optional serialized asset reference. |
| Status | Active, disabled, retired, or pending review. |
| Location Override | Optional location-specific mapping. |
| Created By | Administrator or import source. |
| Created At | Creation timestamp. |
| Last Scanned At | Most recent scan timestamp. |

### Identity and Access

Registered users should select their name from a controlled member list. Email should auto-populate from the member record.

Guest users should be permitted for operational flexibility, but must provide:

- Name
- Email
- Team or organization
- Reason or ticket reference for inventory movement

Administrative access should be role-based. For the prototype, Gaurav Mehta and Monica Martin are treated as administrators. When an administrator signs in, the application should allow them to continue as an administrator or as a regular customer.

## Administrative Capabilities

Administrator screens should be structured, concise, and table-driven. The interface should allow administrators to maintain operational data without editing raw files directly.

Administrators should be able to manage:

- Members
- Parts catalog
- Locations
- Inventory balances
- Barcode and QR mappings
- Replenishment records
- Evaluation queue
- Import review queue

CSV and Excel workflows should support:

- Table-based viewing
- Export
- Import
- Column mapping
- Required-field validation
- Duplicate detection
- Preview before commit
- Approval workflow for catalog-impacting changes

Administrative interfaces should prioritize data quality, validation, and controlled change management.

## Management Reporting

Management reporting should be available through clear, button-driven dashboards and exports. Reports should not require direct access to raw files.

Phase 1 reports should include:

- Current inventory on hand
- Low inventory
- Missing inventory
- Transactions by date range
- Transactions by user
- Transactions by SKU
- Most frequently used SKUs
- Replenishment status
- Guest user activity
- Unknown barcode or QR scans
- Pending administrative reviews

Reports should be filterable by:

- Date range
- User
- Category
- Location
- Action
- SKU

Export formats:

- CSV
- Excel

## Data Model

The MVP should use a database as the operational source of truth. CSV and Excel should remain import and export formats, not the primary runtime data store.

Recommended Phase 1 tables:

| Table | Purpose |
| --- | --- |
| members | Registered users, email addresses, teams, and role flags. |
| parts | SKU catalog, category, metadata, aliases, and part-level attributes. |
| locations | Structured physical locations by region, site, building, room, aisle, rack, shelf, and bin. |
| inventory_balances | Quantity available by SKU and location. |
| inventory_items | Optional serialized asset records. |
| part_codes | Barcode, QR code, asset tag, and label mappings. |
| transactions | Append-only inventory movement history. |
| reports | Missing inventory and low inventory reports. |
| replenishment | Replenishment workflow records. |
| evaluations | Unknown codes, incorrect matches, and user-submitted review items. |
| admin_reviews | Import, catalog, and configuration changes pending approval. |
| imports | Import batches, source files, validation results, and commit history. |
| part_images | Image references for future SKU recognition workflows. |

SQLite is appropriate for the Phase 1 pilot because it is lightweight, reliable, easy to back up, and sufficient for the expected inventory and transaction volume. The schema should be designed so the system can later migrate to a managed database if multi-site concurrency or broader enterprise deployment requires it.

## Parts Catalog Requirements

Every SKU should contain enough structured information to support search, replenishment, reporting, barcode/QR mapping, and future image recognition.

Required catalog fields:

- SKU
- Part name
- Category
- Subcategory
- Manufacturer
- Model
- Description
- Available quantity
- Minimum quantity
- Location
- Aisle
- Bin
- Aliases
- Metadata
- Physical distinguisher
- Image path
- Status

Recommended category-specific distinguishers:

| Category | Recommended Distinguishers |
| --- | --- |
| GPU | GPU family, memory capacity, PCIe/SXM type, cooling type, power connector, compatible server models. |
| M.2 Drive | Capacity, interface, PCIe generation, form factor, key type, endurance class. |
| Hard Disk | Capacity, interface, RPM, form factor, vendor, tray type. |
| Cable | Connector A, connector B, length, rating, color, latch type, speed class. |
| NIC | Port count, speed, PCIe generation, optical/copper type, bracket type. |
| Riser Card | Server model, slot layout, PCIe generation, orientation. |
| PSU | Wattage, voltage, server compatibility, connector type, redundancy type. |
| PDU | Input plug, output receptacles, phase, voltage, amperage, metered or switched capability. |
| Server | Vendor, model, generation, CPU family, GPU support, rack units. |
| Cooling Hose | Diameter, length, fitting type, pressure rating, coolant compatibility. |

## Location Requirements

Inventory location should be structured enough to support accurate lookup and reporting while remaining simple for customers.

Recommended location fields:

- Region
- Site
- Building
- Room
- Aisle
- Rack
- Shelf
- Bin
- Owner team
- Notes

Customer screens should display a concise location label. Administrative screens should expose the full structured location record.

## Inventory and Audit Requirements

The system must support both quantity-based inventory and serialized assets.

Quantity-based inventory examples:

- Cables
- Adapters
- Common storage drives
- Consumables

Serialized inventory examples:

- GPUs
- Servers
- High-value NICs
- Test fixtures
- Asset-tagged equipment

Every inventory movement must create an append-only transaction record.

Required transaction fields:

- Timestamp
- User name
- User email
- User role
- Guest indicator
- Action
- SKU
- Part name
- Quantity
- Before quantity
- After quantity
- Location
- NVBug#
- Reason or ticket reference
- Lookup method
- Barcode or QR code, when applicable
- Administrative override indicator

Existing transaction records should not be edited directly. Corrections should be entered as adjustment transactions.

## Mandatory Field Exception Handling

Mandatory fields should not be silently bypassed. If a user cannot provide a required value, the application should offer controlled exception paths that preserve audit quality and administrative visibility.

Recommended options:

| Situation | Recommended User Option | System Behavior |
| --- | --- | --- |
| User does not know the SKU | Mark as Unknown SKU | Route the transaction or report to administrative review before affecting catalog data. |
| User cannot identify exact part | Submit for Evaluation | Capture description, photo reference if available, location, notes, and user details for admin review. |
| User does not know location | Use Unknown Location | Allow report creation, but require admin review before inventory balances are updated. |
| User does not have an NVBug# | Select No NVBug# Available | Require a reason, flag the transaction, and include it in management reporting. |
| User does not have a reason or ticket | Require Operational Reason | Do not allow inventory removal without at least a short business reason. |
| Guest user cannot provide email | Require Admin Override | Block inventory movement unless an administrator approves and the override is logged. |
| Quantity is uncertain | Submit Count Discrepancy | Route to replenishment or admin review instead of directly updating stock. |
| Barcode or QR code is unknown | Submit Unknown Code | Add the scanned or entered code to the evaluation queue. |
| User needs to stop mid-flow | Save Draft or Cancel | Save incomplete data only as a draft or discard it without changing inventory. |

Administrative overrides should capture:

- Approving administrator
- Timestamp
- Field bypassed
- User-provided explanation
- Related SKU or code, if available
- NVBug# or reason when available

Bypass and override activity should appear in management reports so leadership can see where process gaps, missing labels, or incomplete data are affecting inventory quality.

## Replenishment Workflow

Replenishment should convert low-stock signals into visible, trackable work.

Trigger conditions:

- Available quantity falls below minimum quantity.
- User reports low inventory.
- User reports missing inventory.
- Administrator creates a manual replenishment request.

Recommended workflow statuses:

- Bin Threshold Reached
- Signal Sent
- Reorder in Progress
- Bin Refilled
- Closed

Recommended replenishment fields:

- SKU
- Part name
- Current quantity
- Minimum quantity
- Requested quantity
- Priority
- Owner
- Due date
- Supplier or source
- Notes
- Status

## UI/UX Standards

The application should present a professional internal product experience. The design should be clean, structured, and operationally efficient.

Customer experience standards:

- Minimal steps from login to completed inventory action.
- Clear lookup method selection.
- Prominent part name, quantity, and location.
- Confirmation before inventory changes.
- Simple error recovery for unknown or incorrect matches.
- No administrative controls in the customer path.

Administrator experience standards:

- Table-based data management.
- Clear validation messages.
- Preview before committing imports.
- Direct access to pending review items.
- Clear separation between catalog maintenance, replenishment, and reporting.

Management experience standards:

- Dashboard-first presentation.
- One-click exports.
- Clear date and location filters.
- Summary metrics with drill-down tables.
- No dependency on raw CSV files.

Visual design standards:

- Professional dashboard layout.
- Consistent spacing, typography, and button hierarchy.
- Clear status indicators for low stock, missing inventory, pending review, and completed actions.
- Responsive layouts for desktop and tablet use.
- Accessible contrast and readable tables.
- No unnecessary decorative content.

## Phase 2 Scope

Phase 2 should introduce image-assisted SKU identification only after the catalog baseline, SKU images, and evaluation workflow are mature.

Phase 1 should prepare for Phase 2 by:

- Allowing administrators to attach reference images to SKUs.
- Capturing user feedback when a search or scan result is incorrect.
- Tracking unknown codes and unresolved lookup attempts.
- Maintaining clean aliases, metadata, and distinguishers for each SKU.

Image recognition should not be required for production checkout until the system has sufficient reference images, controlled evaluation data, and administrative review processes.

## Operational Risks

The MVP should be designed around the following risks:

- Users may not know exact SKU names.
- Similar parts may have nearly identical physical appearance.
- A single SKU may exist in multiple locations.
- Some inventory requires quantity tracking, while other inventory requires serial-level tracking.
- Guest access must remain accountable without creating excessive friction.
- Barcode or QR labels may be missing, damaged, duplicated, or incorrectly applied.
- CSV imports may introduce duplicates or overwrite valid data.
- Administrative metadata changes may reduce search quality if not validated.
- Report accuracy depends on transaction integrity.
- Concurrent updates require controlled write behavior.

## MVP Acceptance Criteria

The Phase 1 MVP is ready for pilot when:

- Customers can locate and update inventory quickly with minimal training.
- Manual search supports common plain-language terms.
- Barcode and QR lookup works with manual code fallback.
- Unknown codes are routed to administrative review.
- Every inventory movement creates an append-only transaction.
- Administrators can import, validate, review, and commit catalog updates.
- Administrators can export catalog and transaction data.
- Low inventory and missing inventory workflows are visible and trackable.
- Management can generate and export reports without opening raw files.
- Backup and restore procedures are documented.

## Prototype Runtime

Requirements:

- Node.js 18 or newer

Start the application:

```bash
npm start
```

Open:

```text
http://localhost:3000
```

## Implementation Roadmap

1. Add barcode and QR lookup to the customer workflow.
2. Add a `part_codes` data source and administrative management view.
3. Add unknown code handling and review workflow.
4. Refine customer login, lookup, confirmation, update, and sign-out flow.
5. Move runtime data from CSV files to SQLite while preserving CSV/Excel import and export.
6. Add management report exports.
7. Document backup, restore, and deployment procedures.
