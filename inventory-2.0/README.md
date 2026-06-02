# Inventory 2.0 Comparison Build

Inventory 2.0 is a separate comparison model for the lab hardware inventory application. It keeps the existing port 3000 application untouched and runs independently on port 3001.

## Runtime Model

- Runtime source: SQLite
- Database path: `inventory-2.0/data/inventory2.db`
- Seed source: existing files in `data/`
- Phase 1 lookup model: manual search and connected 2D barcode or QR scanner input

## Core Domains

- Part Master: SKU identity, family, aliases, metadata, distinguishers, image readiness, owner, and storage location
- Stock Ledger: checkout and restock transactions with operator, quantity, reason, and NVBug or reference status
- Code Mappings: barcode and QR values linked to SKU records
- Replenishment Requests: low-stock and missing-stock signals owned by the operations team
- System Operations: database path visibility, exports, and backup controls

## Local Run

```powershell
cd inventory-2.0
node server.js
```

Then open:

```text
http://localhost:3001
```

This build is intentionally isolated so the team can compare Inventory 1.0 and Inventory 2.0 before deciding which model to keep.
