# Inventory-Shaped Reliability Fixtures

| Case | Source | Inventory Scenario | Expected Result |
|---|---|---|---|
| F01 | CSV | One valid SATA SSD with all eight required fields | Awaiting approval |
| F02 | XLSX | Same values as F01 | Draft equals CSV |
| F03 | CSV | Semicolon-delimited Windows-1252 product name | Correct decoded value |
| F04 | CSV | UTF-8 BOM, quoted comma, CRLF, and blank lines | One normalized row |
| F05 | CSV | Duplicate `Serial #` header | Rejected before staging |
| F06 | CSV | Duplicate serial values in one file | Both rows blocked |
| F07 | CSV | Null byte in an inventory row | Rejected before staging |
| F08 | CSV | Unknown extra column | Explicit map/ignore decision |
| F09 | XLSX | Two building worksheets | User selects one sheet |
| F10 | XLSX | Formula with a cached date result | Formula rejected |
| F11 | XLSX | Merged header cell | Rejected with cell address |
| F12 | XLSX | Data beyond the last header | Rejected with row number |
| F13 | CSV | Exactly 1,000 inventory rows | Accepted within 60 seconds |
| F14 | CSV | 1,001 inventory rows | Rejected with 1,000-row limit |
| F15 | CSV/XLSX | Source larger than 10 MB | Rejected before parsing |
| F16 | Draft | Correction followed by filtering/navigation | Correction retained |
| F17 | Review | Importer attempts self-review | Rejected |
| F18 | Review | Administrator submits an old revision/hash | Rejected |
| F19 | Commit | Same idempotency key retried concurrently | One write, same result |
| F20 | Commit | Forced failure after partial row work | Full rollback and lock disabled |

Synthetic fixture values use inventory fields such as serial number, model, product, status, owner, vendor, and date received. They do not use unrelated `full_name`, `email`, or `amount` examples.
