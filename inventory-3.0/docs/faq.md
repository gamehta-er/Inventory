# FAQ

Frequently asked questions about Inventory 3.0 pilot usage, design, and limits.

---

## General

### What is Inventory 3.0?

A local web app for tracking lab hardware (GPUs, DPUs, servers, etc.) for **#imargulis-staff**. It replaces ad-hoc spreadsheets with searchable inventory, checkout history, and CSV import — aligned to Colossus-style fields without requiring Colossus itself.

### How is this different from Inventory 2.0?

Inventory 2.0 is **deprecated**. Version 3.0 is a clean rewrite with:

- Server-side auth and validation
- Mandatory revision locking
- Structured import preview/commit
- Checkout records and governed status labels
- Automated test suite

### Can I delete an asset?

**No.** There is no hard delete. Set status to **Archived** or **E-Wasted** to retire an asset. It remains in the database and audit log.

### How many users can share one server?

**3–4 concurrent users** is the pilot design. SQLite uses WAL mode with a single writer. More users or heavy bulk writes may cause brief lock contention.

---

## Login & roles

### Why is there no password during the pilot?

The pilot uses an **honor-system** login: pick your name and role. This speeds multi-user testing without LDAP/SSO setup. Production deployment should add real authentication — see [Hardening rules](HARDENING-RULES.md).

### What is the difference between Regular User and Admin User?

| Capability | Regular | Admin |
|------------|---------|-------|
| Search, view, checkout, print | Yes | Yes |
| Bulk actions | Yes | Yes |
| Add / edit assets | No | Yes |
| CSV import | No | Yes |
| Backups / restore | No | Yes |
| Master data (locations, members) | No | Yes |

### Why was I signed out?

Sessions expire after **12 hours** or when the **server restarts** (sessions are in-memory). Sign in again.

### Can I trust the name shown in the activity log?

Yes. The server sets the actor from your **session**, not from form fields. Clients cannot forge audit attribution.

---

## Assets & status

### Which statuses mean "available"?

**Ready to Deploy**, **Idle**, and **Borrowed** count as available in KPIs. See `AVAILABLE_STATUSES` in `src/config/constants.js`.

### Why can't I check out this asset?

Checkout requires:

1. Current status is **deployable** (not Broken, Archived, E-Wasted, etc.)
2. Target status is valid (usually **In Use**)
3. Owner and location are provided
4. Reason is filled in

### What is "revision"?

Each asset has a revision number incremented on every write. Edits and actions must send the current revision. If two people edit the same asset, the second save gets **409 Conflict** — refresh and retry.

Print-label and create-request actions skip revision checks.

---

## Import & export

### What CSV columns should I use?

See [Colossus field map](COLOSSUS-FIELD-MAP.md). Headers like `assetTag`, `Asset Tag`, and `serial` are all recognized.

### Can I re-run the same import file?

Preview creates a new batch each time. **Commit** only works once per batch. Re-importing the same asset tags skips duplicates at commit time.

### Is exported CSV safe to open in Excel?

Yes. Values starting with `=`, `+`, `-`, `@` are escaped to prevent formula injection.

---

## Technical

### Where is my data stored?

Default: `inventory-3.0/data/inventory-3.db`. Override with `DATA_DIR` or `DB_PATH` environment variables.

### Does the app work without internet?

Yes. Fully local — no external API dependencies at runtime.

### What Node version do I need?

**Node.js 22+** with experimental SQLite support (`node:sqlite`).

### How do I run automated tests?

```powershell
node --test test/hardening.test.js test/stress.test.js
```

---

## Roadmap / out of scope

### Will you add LDAP or SSO?

Not in the current pilot scope per [Hardening rules](HARDENING-RULES.md). Planned as a post-pilot upgrade.

### Will you migrate to Postgres?

Not for this pilot. SQLite is intentional for single-host deployment.

### Can this replace Colossus entirely?

Not today. Inventory 3.0 is a **lab pilot** with import field alignment. Enterprise Colossus integration would need separate API work (see internal `colossus-search` patterns).

---

## Still stuck?

→ [Troubleshooting](troubleshooting.md)  
→ `#imargulis-staff` channel (your team process)
