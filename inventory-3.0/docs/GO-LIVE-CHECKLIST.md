# Go-Live Checklist — Inventory 3.0

Manual smoke steps before pilot go-live.

## Startup

1. Set `NODE_ENV=production` and `SEED_MODE=0` for production.
2. Set `DATA_DIR` to a dedicated path outside the git repo.
3. Start server: `node server.js` (or `start-local.cmd` for dev only).
4. Open `http://127.0.0.1:3003`
5. Confirm `/api/v3/health` returns 200
6. Confirm `/api/v3/ready` returns 200 with `schemaVersion`

## Auth

7. Login page loads member list via `/api/v3/bootstrap`
8. Sign in as Regular User succeeds
9. Sign in as Admin User succeeds
10. `curl` without cookie → 401 on `/api/v3/session`
11. Regular user cannot create backup (403)

## Search & KPIs

12. Empty search: KPI row shows non-zero Active/Available counts (after import or seed)
13. Category card click filters results
14. Serial/asset tag exact search opens one asset

## Asset writes

15. Edit asset without revision → 400
16. Two tabs edit same asset → second save gets 409
17. Checkout then check-in closes checkout record in History

## Import

18. Preview CSV with duplicate asset tag → blocked
19. Commit import once → success
20. Commit same batch again → rejected

## Backup / restore

21. Admin creates backup → file in `{DATA_DIR}/backups/`
22. Restore with wrong confirm → 400
23. Restore with `RESTORE <filename>` → activity log entry

## Reports & export

24. Export CSV with `=1+1` in NVBUG cell → safe in Excel
25. Activity log shows server-authenticated actor, not forged client name

## Automated regression

26. Run `node --test test/hardening.test.js test/stress.test.js` — all pass
