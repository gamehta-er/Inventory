INVENTORY PROJECT INSTALLER CLEANUP

Purpose
-------
Remove obsolete Inventory Project installer folders and ZIP packages from:

  C:\InventoryProject-Install

The cleanup does not access the live application under D:\Inventory Project,
PostgreSQL, IIS, uploads, configuration, or activity data.

Preserved
---------
- Prerequisites
- Every file or folder that does not match an Inventory Project versioned
  installer folder or package name
- One cleanup log: C:\InventoryProject-Install\Cleanup-InventoryProjectInstall.log

Run
---
1. Copy all three cleanup files into C:\InventoryProject-Install\Cleanup.
2. Open that folder.
3. Optional read-only preview:

     powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Cleanup-InventoryProjectInstall.ps1 -PlanOnly

4. Right-click Cleanup-InventoryProjectInstall.cmd and choose Run as administrator.
5. Review the exact list.
6. Type: DELETE INSTALLER CLUTTER

The script verifies that all listed items were removed before reporting PASS.
