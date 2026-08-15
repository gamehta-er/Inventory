# Inventory Project 1.4

Inventory Project is a PostgreSQL-backed inventory application served by IIS with a Fastify API running as a Windows service.

## Runtime

- Public web application: IIS on port 80
- Internal API: `127.0.0.1:3020`
- Internal PostgreSQL: `127.0.0.1:5432`
- Phase 1 access: database-backed company user picker

The production package does not contain Vite, a gateway process, a memory repository, presentation mode, or database backup tooling.

Before changing the server, the installer verifies every packaged file against `release-manifest.json`. A missing, unexpected, resized, or hash-mismatched file stops installation.

## Operations

Run support scripts from an elevated PowerShell window. State-changing scripts ask for explicit confirmation.

- `Operations\Status-Inventory.ps1`
- `Operations\Start-Inventory.ps1`
- `Operations\Stop-Inventory.ps1`
- `Operations\Restart-Inventory.ps1`
- `Operations\Maintenance-On.ps1`
- `Operations\Maintenance-Off.ps1`
- `Operations\Show-InventoryLogs.ps1`
- `Operations\Invoke-InventoryUpdate.ps1`
- `Operations\Remove-InventoryUpdateCache.ps1`
- `Operations\Test-Acceptance.ps1`

Configuration is stored in `Config`. API/service and operations logs are stored in `Logs`.

The complete import-session workflow, validation classes, correction options, and support procedure are documented in `IMPORT-WORKFLOW.md`.

Release 1.4 adds governed CSV/XLSX imports, a server-enforced import safety mode, protected draft revisions, and two independent administrator reviews. Import commits remain `DISABLED` until the reliability gates and organizational sign-offs in `quality/GATE-EVIDENCE.md` are complete.

Production releases use a frozen full baseline for clean installation and small component-aware deltas for routine updates. See `RELEASES.md`.
