from __future__ import annotations

import ast
import hashlib
import json
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
GENERATOR = ROOT / "tools" / "generate_framework_pdf.py"
FRAMEWORK_DIR = ROOT / "framework"
CATALOGUE_PATH = FRAMEWORK_DIR / "requirements.json"
EVIDENCE_PATH = FRAMEWORK_DIR / "conformance-evidence.json"
APPROVAL_PATH = FRAMEWORK_DIR / "approval.json"
BACKLOG_PATH = ROOT / "docs" / "CONFORMANCE-BACKLOG.md"
PDF_PATH = ROOT / "output" / "pdf" / "Inventory-Project-Product-and-Engineering-Framework-v1.0.pdf"

AREAS = {
    "GOV": "Governance",
    "ARCH": "Architecture",
    "DATA": "Database",
    "PROF": "Profile registry",
    "AUTH": "Users and permissions",
    "ASSET": "Asset operations",
    "IMPORT": "Import",
    "RPT": "Reports",
    "ACT": "Activity",
    "API": "API contracts",
    "UX": "User experience",
    "OPS": "Operations",
    "TEST": "Acceptance testing",
}


def load_literal(name: str):
    tree = ast.parse(GENERATOR.read_text(encoding="utf-8"), filename=str(GENERATOR))
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == name:
                    return ast.literal_eval(node.value)
    raise RuntimeError(f"{name} was not found in {GENERATOR}")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")


def main() -> None:
    requirements = load_literal("REQS")
    fields = load_literal("FIELDS")
    if len(requirements) != 138:
        raise RuntimeError(f"Expected 138 framework requirements, found {len(requirements)}")
    if len(fields) != 19:
        raise RuntimeError(f"Expected 19 standard fields, found {len(fields)}")

    ids = [item[0] for item in requirements]
    duplicates = sorted(item for item, count in Counter(ids).items() if count > 1)
    if duplicates:
        raise RuntimeError(f"Duplicate requirement IDs: {', '.join(duplicates)}")

    field_entries = [
        {
            "fieldKey": key,
            "label": label,
            "requirement": requirement,
            "dataType": data_type,
            "storageTarget": storage,
            "definition": definition,
        }
        for key, label, requirement, data_type, storage, definition in fields
    ]
    required = sum(1 for item in field_entries if item["requirement"] == "Required")
    optional = sum(1 for item in field_entries if item["requirement"] == "Optional")
    if (required, optional) != (8, 11):
        raise RuntimeError(f"Expected 8 required and 11 optional fields, found {required} and {optional}")

    FRAMEWORK_DIR.mkdir(parents=True, exist_ok=True)
    pdf_hash = sha256(PDF_PATH) if PDF_PATH.exists() else None
    catalogue = {
        "document": {
            "title": "Inventory Project Product and Engineering Framework",
            "version": "1.0",
            "productOwner": "Gaurav Mehta",
            "approvalAuthority": "Gaurav Mehta",
            "status": "PENDING_APPROVAL",
            "sourcePdf": str(PDF_PATH.relative_to(ROOT)).replace("\\", "/"),
            "pdfSha256": pdf_hash,
            "requirementCount": len(requirements),
        },
        "requirements": [
            {
                "id": requirement_id,
                "area": AREAS[requirement_id.split("-", 1)[0]],
                "statement": statement,
                "requiredEvidence": evidence,
            }
            for requirement_id, statement, evidence in requirements
        ],
        "standardFields": field_entries,
        "lifecycleStatuses": ["IN_USE", "REWORK", "E_WASTE", "ARCHIVE", "GPU_READY", "AVAILABLE"],
        "approvedViewports": ["1920x1080", "1366x768", "1280x720", "768x1024", "390x844"],
    }
    write_json(CATALOGUE_PATH, catalogue)

    previous = {}
    if EVIDENCE_PATH.exists():
        previous_data = json.loads(EVIDENCE_PATH.read_text(encoding="utf-8-sig"))
        previous = {item["requirementId"]: item for item in previous_data.get("requirements", [])}
    evidence_rows = []
    for requirement_id in ids:
        current = previous.get(requirement_id, {})
        evidence_rows.append({
            "requirementId": requirement_id,
            "applicability": current.get("applicability", "APPLICABLE"),
            "status": current.get("status", "NOT_ASSESSED"),
            "evidence": current.get("evidence", []),
            "notes": current.get("notes", ""),
        })
    write_json(EVIDENCE_PATH, {
        "frameworkVersion": "1.0",
        "candidateTag": "inventory-framework-v1.0-candidate",
        "releaseDecision": "FROZEN_PENDING_CONFORMANCE",
        "requirements": evidence_rows,
    })

    approval = json.loads(APPROVAL_PATH.read_text(encoding="utf-8-sig")) if APPROVAL_PATH.exists() else {}
    approval_status = approval.get("status", "PENDING_APPROVAL")
    status_counts = Counter(item["status"] for item in evidence_rows)
    lines = [
        "# Framework v1.0 Conformance Backlog",
        "",
        "> Generated from the governing Framework v1.0 requirement catalogue. Do not edit this file directly.",
        "",
        f"- Product Owner: **Gaurav Mehta**",
        f"- Approval: **{approval_status}**",
        f"- Candidate tag: `inventory-framework-v1.0-candidate`",
        f"- Requirements: **{len(requirements)}**",
        f"- Passed: **{status_counts.get('PASSED', 0)}**",
        f"- Failed: **{status_counts.get('FAILED', 0)}**",
        f"- Not assessed: **{status_counts.get('NOT_ASSESSED', 0)}**",
        "",
        "Packaging and production rollout remain blocked until approval is recorded and every applicable requirement has passed evidence.",
        "",
    ]
    grouped: dict[str, list[dict[str, str]]] = {}
    requirement_by_id = {item["id"]: item for item in catalogue["requirements"]}
    for row in evidence_rows:
        if row["status"] == "PASSED" or row["applicability"] == "NOT_APPLICABLE":
            continue
        requirement = requirement_by_id[row["requirementId"]]
        grouped.setdefault(requirement["area"], []).append({**row, **requirement})
    for area, rows in grouped.items():
        lines.extend([f"## {area}", "", "| Requirement | Status | Required evidence |", "|---|---|---|"])
        for row in rows:
            evidence = row["requiredEvidence"].replace("|", "\\|")
            lines.append(f"| `{row['id']}` | {row['status']} | {evidence} |")
        lines.append("")
    BACKLOG_PATH.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    print(CATALOGUE_PATH)
    print(EVIDENCE_PATH)
    print(BACKLOG_PATH)


if __name__ == "__main__":
    main()
