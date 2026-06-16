# Inventory 3.0 Hardening Rules

Hardening scope: single go-live pilot (SQLite, 3–4 users, dedicated server, **no LDAP/SSO**).

## Scope

- Work **only** under `inventory-3.0/`
- Inventory 2.0 is discarded
- Target branch for changes: `main`

## Rules for every change

- Minimal diffs; match existing code style
- No LDAP, SAML, Postgres, or new frontend frameworks
- No unrelated UI refactors
- Every DB mutation uses the existing `tx()` pattern in `src/db/index.js`
- After each prompt: list files changed, manual verification steps, and intentional exclusions

## Pilot constraints

- SQLite with WAL (single-writer, fine for 3–4 users)
- Server-side auth with honor-system role picker (pilot); production SSO is post-pilot
- Mandatory asset `revision` on all writes (except print-label)
- Status labels and checkout records are governed data
