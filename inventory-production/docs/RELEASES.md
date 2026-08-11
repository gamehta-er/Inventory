# Inventory Project Releases

## Release model

Inventory Project uses two package types:

- **Baseline**: a complete clean-install package for disaster recovery or an intentionally promoted new baseline.
- **Delta**: a routine production update containing only changed `web`, `api`, `database`, or `operations` components.

`InventoryProject-1.3.1.zip` remains the current baseline. Routine corrections must not rebuild or redeploy it.

## Build a delta

The source and target must be previously built baseline directories with valid `release-manifest.json` files.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File ".\operations\Build-Delta-Package.ps1" `
  -FromPackageRoot ".\artifacts\InventoryProject-1.3.1" `
  -ToPackageRoot ".\artifacts\InventoryProject-1.3.2" `
  -RequiredUpdaterVersion "1.0.0" `
  -VerifySourcePackages
```

The builder compares manifests, copies only added or replaced component files, records removals, includes only new immutable migrations, and embeds the complete target manifest for each affected component. Use `-VerifySourcePackages` only for a deliberate deep audit of both full baselines.

An operations delta carries the complete target operations toolkit. This lets the updater repair a missing or older support script while retaining strict complete-component validation.

## Install the permanent updater once

The release-tools package installs:

- `D:\Inventory Project\Operations\Invoke-InventoryUpdate.ps1`
- `D:\Inventory Project\Operations\Test-Delta-Package.ps1`
- `D:\Inventory Project\Operations\Test-Release-System.ps1`
- `D:\Inventory Project\Operations\Remove-InventoryUpdateCache.ps1`

It does not publish the application, restart services, or alter PostgreSQL.

## Apply a routine delta

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File "D:\Inventory Project\Operations\Invoke-InventoryUpdate.ps1" `
  -PackagePath "C:\InventoryProject-Install\InventoryProject-Delta-1.3.1-to-1.3.2.zip" `
  -InstallRoot "D:\Inventory Project" `
  -PostgreSqlBin "C:\Program Files\PostgreSQL\18\bin" `
  -DatabaseName "inventory_project" `
  -SiteName "Inventory Project" `
  -ApiServiceName "InventoryProjectApi" `
  -Confirmed
```

This corrective delta has no database component, so it does not request a PostgreSQL password.

The updater rejects:

- A `fromVersion` different from the installed `deployment.json` version.
- A delta requiring a newer updater.
- Missing, unexpected, resized, or hash-mismatched files.
- An incomplete staged target component.
- Changed or removed historical migrations.
- Unsafe paths or unknown components.

After successful health checks, it updates `deployment.json`, appends the compact release ledger, and removes the applied package and temporary workspace. Failed application component health checks restore the previous component automatically.

## Component behavior

| Delta component | API restart | IIS maintenance | PostgreSQL restart |
|---|---:|---:|---:|
| web | No | During switch | No |
| api | Yes | During switch | No |
| database | Yes | During migration and readiness check | No |
| operations | No | No | No |

Database migrations must be transactional, forward-only, backward-compatible, and uniquely journaled. Previously applied migration IDs are skipped and never logged as newly applied.
