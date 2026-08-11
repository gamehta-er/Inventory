[CmdletBinding()]
param(
    [switch]$ReleaseGate
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$CataloguePath = Join-Path $ProjectRoot 'framework\requirements.json'
$EvidencePath = Join-Path $ProjectRoot 'framework\conformance-evidence.json'
$ApprovalPath = Join-Path $ProjectRoot 'framework\approval.json'
$PackagePath = Join-Path $ProjectRoot 'package.json'
$PdfPath = Join-Path $ProjectRoot 'output\pdf\Inventory-Project-Product-and-Engineering-Framework-v1.0.pdf'
$Results = [System.Collections.Generic.List[object]]::new()

function Add-Result([string]$Check, [bool]$Passed, [string]$Detail) {
    $Results.Add([pscustomobject]@{
        Check = $Check
        Status = if ($Passed) { 'PASS' } else { 'FAIL' }
        Detail = $Detail
    })
}

foreach ($Path in @($CataloguePath, $EvidencePath, $ApprovalPath, $PackagePath, $PdfPath)) {
    Add-Result "Required artifact: $(Split-Path -Leaf $Path)" (Test-Path -LiteralPath $Path -PathType Leaf) $Path
}
if ($Results.Status -contains 'FAIL') {
    $Results | Format-Table -AutoSize
    exit 1
}

$Catalogue = Get-Content -LiteralPath $CataloguePath -Raw | ConvertFrom-Json
$Evidence = Get-Content -LiteralPath $EvidencePath -Raw | ConvertFrom-Json
$Approval = Get-Content -LiteralPath $ApprovalPath -Raw | ConvertFrom-Json
$Package = Get-Content -LiteralPath $PackagePath -Raw | ConvertFrom-Json
$Requirements = @($Catalogue.requirements)
$Fields = @($Catalogue.standardFields)
$Statuses = @($Catalogue.lifecycleStatuses)
$EvidenceRows = @($Evidence.requirements)

Add-Result 'Framework requirement count' ($Requirements.Count -eq 138) "Found $($Requirements.Count); expected 138."
$UniqueIds = @($Requirements.id | Sort-Object -Unique)
Add-Result 'Unique requirement IDs' ($UniqueIds.Count -eq $Requirements.Count) "Found $($UniqueIds.Count) unique IDs."
$InvalidIds = @($Requirements.id | Where-Object { $_ -notmatch '^[A-Z]+-[0-9]{3}$' })
$InvalidIdDetail = if ($InvalidIds.Count -eq 0) { 'All IDs valid.' } else { $InvalidIds -join ', ' }
Add-Result 'Requirement ID format' ($InvalidIds.Count -eq 0) $InvalidIdDetail
Add-Result 'Standard field count' ($Fields.Count -eq 19) "Found $($Fields.Count); expected 19."
$RequiredFields = @($Fields | Where-Object requirement -eq 'Required')
$OptionalFields = @($Fields | Where-Object requirement -eq 'Optional')
Add-Result 'Required/optional field split' ($RequiredFields.Count -eq 8 -and $OptionalFields.Count -eq 11) "Required=$($RequiredFields.Count), Optional=$($OptionalFields.Count)."
$ExpectedStatuses = @('IN_USE','REWORK','E_WASTE','ARCHIVE','GPU_READY','AVAILABLE')
$StatusDifferences = @(Compare-Object $ExpectedStatuses $Statuses)
Add-Result 'Lifecycle status contract' ($StatusDifferences.Count -eq 0) ($Statuses -join ', ')
$CatalogueText = Get-Content -LiteralPath $CataloguePath -Raw
Add-Result 'No unresolved framework placeholders' ($CatalogueText -notmatch '(?i)\bTBD\b|TO_BE_DEFINED') 'Catalogue contains no unresolved TBD markers.'
$PdfHash = (Get-FileHash -LiteralPath $PdfPath -Algorithm SHA256).Hash.ToLowerInvariant()
Add-Result 'PDF integrity matches catalogue' ([string]$Catalogue.document.pdfSha256 -ceq $PdfHash) $PdfHash
$EvidenceIds = @($EvidenceRows.requirementId | Sort-Object -Unique)
$EvidenceIdDifferences = @(Compare-Object $UniqueIds $EvidenceIds)
Add-Result 'Evidence ledger coverage' ($EvidenceIds.Count -eq $UniqueIds.Count -and $EvidenceIdDifferences.Count -eq 0) "Evidence rows=$($EvidenceRows.Count)."
$AllowedEvidenceStatuses = @('NOT_ASSESSED','PASSED','FAILED')
$InvalidEvidence = @($EvidenceRows | Where-Object { $_.status -notin $AllowedEvidenceStatuses -or $_.applicability -notin @('APPLICABLE','NOT_APPLICABLE') })
Add-Result 'Evidence status vocabulary' ($InvalidEvidence.Count -eq 0) "Invalid rows=$($InvalidEvidence.Count)."
Add-Result 'Sites hosting is not initialized' (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot '.openai\hosting.json'))) 'IIS remains the production host.'
Add-Result 'Candidate product version unchanged' ([string]$Package.version -ceq '1.3.2') "Candidate source version=$($Package.version)."

if ($ReleaseGate) {
    Add-Result 'Framework approval recorded' ([string]$Approval.status -ceq 'APPROVED') "Approval status=$($Approval.status)."
    Add-Result 'Approved PDF hash recorded' ([string]$Approval.approvedPdfSha256 -ceq $PdfHash) "Approved hash=$($Approval.approvedPdfSha256)."
    Add-Result 'Approved source commit recorded' (-not [string]::IsNullOrWhiteSpace([string]$Approval.approvedCommit)) "Commit=$($Approval.approvedCommit)."
    $Unpassed = @($EvidenceRows | Where-Object { $_.applicability -eq 'APPLICABLE' -and $_.status -ne 'PASSED' })
    Add-Result 'All applicable requirements passed' ($Unpassed.Count -eq 0) "Unpassed requirements=$($Unpassed.Count)."
}

$Results | Format-Table -AutoSize -Wrap
$Failed = @($Results | Where-Object Status -eq 'FAIL')
if ($Failed.Count -gt 0) {
    Write-Host "Framework conformance failed: $($Failed.Count) check(s)." -ForegroundColor Red
    exit 1
}

$Mode = if ($ReleaseGate) { 'release gate' } else { 'catalogue integrity' }
Write-Host "PASS: Framework v1.0 $Mode checks completed." -ForegroundColor Green
