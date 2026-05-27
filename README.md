# Lab Hardware Inventory

Manual-first inventory lookup, checkout, replenishment, and admin management tooling for shared lab hardware.

## What Problem This Project Solves

Lab hardware inventory is difficult to keep accurate when parts are spread across multiple rooms, buildings, regions, and teams. In many lab environments, not every item has a barcode, QR code, or standardized asset tag. People often know what they need in plain language, such as "hard drive", "SSD", "GPU", "H100", or "power cable", but the inventory system expects exact SKU knowledge.

This project is designed to close that gap.

It gives users a fast self-service way to:

- Find parts using natural descriptions instead of exact SKUs.
- See matching inventory options grouped by useful categories.
- Confirm location, quantity, and part details before taking or restocking inventory.
- Record who used what, when, and why.
- Report missing or low inventory.
- Help admins safely import, review, and update catalog data.

The goal is to make manual inventory reliable without forcing every item to have a barcode on day one.

## Why This Project Is Worth Looking Into

This project is useful because it focuses on the real operating problem: inventory accuracy depends on user behavior. If the lookup flow is slow, confusing, or requires exact SKU knowledge, people will bypass it. If people bypass it, management reports become unreliable.

The application is designed around speed and trust:

- A user can type what they are looking for in plain language.
- The system returns grouped, scored matches instead of one brittle result.
- The user selects the closest part and confirms the location.
- Every movement is recorded in a transaction log.
- Admin catalog changes require review before being committed.

This makes the system practical for teams that need quick inventory visibility but are still operating with manual labels, mixed part names, and regional variation.

## Current Capabilities

### Manual Inventory Search

Users can search by SKU, category, connector, capacity, nickname, label text, or common language.

Examples:

- `hard drive` returns hard disks and M.2 drive options.
- `SSD` prioritizes M.2 or SSD-like storage results.
- `GPU` returns available GPU options such as A100, H100, and L40S.
- `power cable` returns cable-related inventory.

Search results include:

- Match score
- SKU
- Part name
- Category
- Distinguishing details
- Available quantity
- Aisle and bin location

The search flow is intentionally quick. It gives users enough context to choose the correct part without overwhelming them with a full catalog table.

### Checkout and Restock Flow

After selecting a part, users can:

- Check out inventory
- Add inventory back
- Enter quantity
- Add a reason, ticket, or build context

Every transaction updates the inventory and is written to the transaction log.

### Management Report

Admins can review inventory movement by:

- Day
- Week
- Month
- Year
- All time

The report answers:

- Who used inventory?
- What did they take or restock?
- How many movements happened in the selected period?
- Which SKUs are moving?
- How many unique users and SKUs were involved?

This helps management understand consumption patterns, recurring demand, team usage, and stock movement.

### Admin CSV Manager

Admins can manage the CSV-backed catalog through the UI:

- Open CSV files as editable tables
- Add rows
- Add columns
- Import CSV data
- Map imported columns into the current table
- Preview before and after changes
- Accept or decline changes

CSV changes require two distinct admin approvals before being committed. This helps protect the source data from accidental or unreviewed changes.

### Replenishment Board

The application includes an in-app Kanban-style replenishment board for manual inventory environments. The board is based on user-entered signals rather than barcode scanning:

- A user notices a bin is low.
- The user picks a known SKU or describes the item manually.
- The user creates a low-bin signal with quantity, priority, and notes.
- The team moves the signal through the replenishment workflow.
- Inventory is updated when the bin is refilled.

Workflow columns:

- Bin Threshold Reached
- Signal Sent
- Reorder in Progress
- Bin Refilled

This gives the team one place to track replenishment work without requiring barcodes on every item.

## Why Management Can Rely on This Data

Management can rely on the data when the process is consistently followed because the application captures the key audit trail:

- User name and email
- Action taken
- SKU and part name
- Quantity moved
- Before and after quantity
- Location
- Timestamp
- Reason or ticket

The application also protects catalog quality through admin review:

- Required columns are validated.
- Imported data is reviewed before commit.
- Two admins must approve catalog changes.
- The source files remain downloadable and auditable.

This creates a more reliable operational record than ad hoc spreadsheets, hallway messages, or informal inventory notes.

## How This Benefits the Organization

- Match score
- SKU
- Part name
- Category
- Distinguishing details
- Available quantity
- Aisle and bin location

The search flow is intentionally quick. It gives users enough context to choose the correct part without overwhelming them with a full catalog table.

### Checkout and Restock Flow

After selecting a part, users can:

- Check out inventory
- Add inventory back
- Enter quantity
- Add a reason, ticket, or build context

Every transaction updates the inventory and is written to the transaction log.

### Management Report

Admins can review inventory movement by:

- Day
- Week
- Month
- Year
- All time

The report answers:

- Who used inventory?
- What did they take or restock?
- How many movements happened in the selected period?
- Which SKUs are moving?
- How many unique users and SKUs were involved?

This helps management understand consumption patterns, recurring demand, team usage, and stock movement.

### Admin CSV Manager

Admins can manage the CSV-backed catalog through the UI:

- Open CSV files as editable tables
- Add rows
- Add columns
- Import CSV data
- Map imported columns into the current table
- Preview before and after changes
- Accept or decline changes

CSV changes require two distinct admin approvals before being committed. This helps protect the source data from accidental or unreviewed changes.

### Replenishment Board

The application includes an in-app Kanban-style replenishment board for manual inventory environments. The board is based on user-entered signals rather than barcode scanning:

- A user notices a bin is low.
- The user picks a known SKU or describes the item manually.
- The user creates a low-bin signal with quantity, priority, and notes.
- The team moves the signal through the replenishment workflow.
- Inventory is updated when the bin is refilled.

Workflow columns:

- Bin Threshold Reached
- Signal Sent
- Reorder in Progress
- Bin Refilled

This gives the team one place to track replenishment work without requiring barcodes on every item.

## Why Management Can Rely on This Data

Management can rely on the data when the process is consistently followed because the application captures the key audit trail:

- User name and email
- Action taken
- SKU and part name
- Quantity moved
- Before and after quantity
- Location
- Timestamp
- Reason or ticket

The application also protects catalog quality through admin review:

- Required columns are validated.
- Imported data is reviewed before commit.
- Two admins must approve catalog changes.
- The source files remain downloadable and auditable.

This creates a more reliable operational record than ad hoc spreadsheets, hallway messages, or informal inventory notes.

## How This Benefits the Organization

Better inventory data can help the organization:

- Reduce time wasted searching for parts.
- Reduce duplicate purchases caused by poor visibility.
- Improve replenishment planning.
- Identify high-demand items by region, building, or team.
- Detect low-stock patterns earlier.
- Improve accountability for shared lab resources.
- Support future supplier and procurement automation.
- Build a foundation for database-backed global inventory.

The long-term value is not just knowing "what is on the shelf." It is understanding how inventory moves across people, teams, buildings, and projects.

## Data Strategy

The current implementation uses CSV files for speed and transparency:

- `data/parts.csv`
- `data/inventory.csv`
- `data/members.csv`
- `data/transactions.csv`
- `data/evaluation_queue.csv`
- `data/replenishment.csv`

CSV is useful for early development because it is easy to inspect, import, export, and review.

For wider regional usage, the recommended next step is to move the source of truth into a database such as Postgres. CSV and XLSX should become import/export formats, not the long-term operational database.

Recommended future database tables:

- Parts
- Locations
- Bins
- Inventory balances
- Transactions
- Users
- Admin approvals
- Import reviews
- Replenishment cards
- Suppliers

## Running the Project Locally

Requirements:

- Node.js 18 or newer

Start the app:

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

## Current Project Status

This is an active prototype moving toward a production-ready internal tool.

Recently added:

- Manual intent-aware search
- Grouped matching results
- Search refinement prompts
- Quick search chips
- Admin management report
- CSV import and review flow
- Two-admin approval before CSV commit
- In-app replenishment board with manual signal creation

## Recommended Next Steps

1. Add more realistic SKUs and metadata for common categories such as SSD, HDD, GPU, cables, PSUs, PDUs, and NICs.
2. Add location hierarchy for region, site, building, room, aisle, rack, and bin.
3. Add manual low-bin signal creation directly from the checkout flow.
4. Add replenishment ownership, due dates, and supplier fields.
5. Move source data from CSV to a database when multi-region usage begins.
6. Add role-based permissions beyond the current admin allowlist.
7. Add exportable management reports for leadership review.

## Security and Governance Notes

The project currently uses a simple allowlist for admin access. For broader deployment, it should integrate with company identity and access management.

Important production considerations:

- Authentication and authorization
- Audit log retention
- Approval history
- Data backup
- Change review workflow
- Regional data ownership
- Privacy and internal data handling

## Why This Matters

Inventory accuracy is not only a data problem. It is a workflow problem.

This project makes the workflow easier for the people using the inventory every day, while giving admins and management better data to plan, replenish, and make decisions.
