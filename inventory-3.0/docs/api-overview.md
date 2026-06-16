# API Overview

REST JSON API under `/api/v3/`. All responses are JSON unless noted.

**Base URL:** `http://127.0.0.1:3003` (default)

---

## Authentication

### Login

```http
POST /api/v3/login
Content-Type: application/json

{
  "memberId": "guest",
  "role": "Admin User"
}
```

Response sets cookie `inventory3_session` (HttpOnly, 12h TTL).

Alternative: `Authorization: Bearer <token>` after login.

### Session

```http
GET /api/v3/session
Cookie: inventory3_session=...
```

Returns categories, locations, members, statuses, and app revision.

---

## Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v3/health` | No | Liveness + revision |
| GET | `/api/v3/ready` | No | DB schema ready |
| GET | `/api/v3/revision` | Yes | Current data revision |
| GET | `/api/v3/bootstrap` | No | Login page data (members) |

---

## Search & assets

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v3/search?q=...` | Yes | Search assets + KPI summary |
| GET | `/api/v3/assets/:id` | Yes | Asset detail + history |
| POST | `/api/v3/assets` | Admin | Create asset |
| PATCH | `/api/v3/assets/:id` | Admin | Update asset (requires `revision`) |
| POST | `/api/v3/assets/:id/actions` | Yes | Checkout, check-in, status, print, request |
| GET | `/api/v3/assets/:id/activity` | Yes | Asset activity log |

### Action payload example (checkout)

```json
{
  "action": "check-out",
  "revision": 3,
  "status": "In Use",
  "ownerId": 5,
  "locationId": 2,
  "reason": "Lab allocation",
  "nvbug": "1234567"
}
```

Actions: `check-out`, `check-in`, `status-change`, `print-label`, `request`

`print-label` and `request` skip revision requirement.

---

## Bulk

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v3/assets/bulk-preview` | Yes | Preview eligible/conflicts |
| POST | `/api/v3/assets/bulk-commit` | Yes | Execute bulk action |

```json
{
  "action": "check-out",
  "assetIds": [1, 2, 3],
  "expectedRevisions": { "1": 4, "2": 2, "3": 7 },
  "status": "In Use",
  "ownerId": 5,
  "locationId": 2,
  "reason": "Batch checkout"
}
```

---

## Import (admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v3/import/preview` | Admin | multipart or JSON CSV |
| POST | `/api/v3/import/:batchId/commit` | Admin | Commit previewed batch |

Preview response includes `id`, `canCommit`, `issues`, `rows`.

---

## Reports & activity

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v3/reports/assets?category=gpu` | Yes | Filtered report JSON |
| GET | `/api/v3/reports/export?...` | Yes | CSV download |
| GET | `/api/v3/activity` | Yes | Global activity log |
| GET | `/api/v3/requests` | Yes | Open asset requests |

---

## Backups (admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v3/backups` | Admin | List backups |
| POST | `/api/v3/backups` | Admin | Create backup |
| POST | `/api/v3/backups/restore` | Admin | Restore with confirm phrase |
| GET | `/api/v3/backups/:id/download` | Admin | Download `.db` file |

---

## Master data (admin)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v3/locations` | Create location |
| PATCH | `/api/v3/locations/:id` | Update location |
| POST | `/api/v3/members` | Create member |
| PATCH | `/api/v3/members/:id` | Update member |
| POST | `/api/v3/asset-models` | Create model |
| DELETE | `/api/v3/asset-models/:id` | Deactivate model |
| PATCH | `/api/v3/categories/:id/fields` | Field settings |
| POST | `/api/v3/asset-models/:id/image` | Upload model image |
| DELETE | `/api/v3/asset-models/:id/image` | Remove model image |

---

## Error format

```json
{
  "error": "Human-readable message",
  "errors": { "fieldKey": "Field error" },
  "currentRevision": 5,
  "preview": { }
}
```

| Status | Meaning |
|--------|---------|
| 400 | Validation failed |
| 401 | Not authenticated |
| 403 | Admin required |
| 404 | Not found |
| 409 | Revision conflict |
| 503 | Database not ready |

---

## curl examples

```powershell
# Login and save cookie
curl -c cookies.txt -X POST http://127.0.0.1:3003/api/v3/login `
  -H "Content-Type: application/json" `
  -d '{"memberId":"guest","role":"Admin User"}'

# Search
curl -b cookies.txt "http://127.0.0.1:3003/api/v3/search?q=GPU"

# Create asset
curl -b cookies.txt -X POST http://127.0.0.1:3003/api/v3/assets `
  -H "Content-Type: application/json" `
  -d '{"categoryId":1,"model":"Test","assetTag":"API-001","locationId":1,"reason":"API test"}'
```

---

## Related

- [Architecture](architecture.md)
- [Troubleshooting](troubleshooting.md)
