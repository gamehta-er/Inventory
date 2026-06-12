# Inventory 3.0

Clean-sheet local inventory pilot for #imargulis-staff.

## Run

```powershell
& "C:\Users\gamehta\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" server.js
```

Default URL:

```text
http://localhost:3003
```

## Notes

- Uses SQLite with WAL, busy timeout, transactions, and asset revision checks.
- Seeds synthetic data only. It does not copy real workbook names, locations, or serial numbers.
- Uploads and SQLite data are stored under `data/` and ignored by git.
- No Bootstrap or frontend framework dependency is used.
