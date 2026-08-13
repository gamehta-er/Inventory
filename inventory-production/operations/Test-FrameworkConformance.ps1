[CmdletBinding()]
param(
    [switch]$ReleaseGate,
    [string]$ExpectedProductVersion,
    [string]$ReleaseEvidencePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$CataloguePath = Join-Path $ProjectRoot 'framework\requirements.json'
$EvidencePath = Join-Path $ProjectRoot 'framework\conformance-evidence.json'
$ApprovalPath = Join-Path $ProjectRoot 'framework\approval.json'
$DesignDocumentPath = Join-Path $ProjectRoot 'framework\design-system-v1.1.md'
$DesignLockPath = Join-Path $ProjectRoot 'framework\design-lock.json'
$DesignApprovalPath = Join-Path $ProjectRoot 'framework\design-approval.json'
$DesignChangeTemplatePath = Join-Path $ProjectRoot 'framework\design-change-request-template.md'
$DesignLockTestPath = Join-Path $ProjectRoot 'operations\Test-DesignLock.ps1'
$PackagePath = Join-Path $ProjectRoot 'package.json'
$BackendPackagePath = Join-Path $ProjectRoot 'backend\package.json'
$FrontendPackagePath = Join-Path $ProjectRoot 'frontend\package.json'
$ApiVersionPath = Join-Path $ProjectRoot 'backend\src\version.ts'
$PdfPath = Join-Path $ProjectRoot 'output\pdf\Inventory-Project-Product-and-Engineering-Framework-v1.0.pdf'
$Results = [System.Collections.Generic.List[object]]::new()

function Add-Result([string]$Check, [bool]$Passed, [string]$Detail) {
    $Results.Add([pscustomobject]@{
        Check = $Check
        Status = if ($Passed) { 'PASS' } else { 'FAIL' }
        Detail = $Detail
    })
}

foreach ($Path in @($CataloguePath, $EvidencePath, $ApprovalPath, $DesignDocumentPath, $DesignLockPath, $DesignApprovalPath, $DesignChangeTemplatePath, $DesignLockTestPath, $PackagePath, $BackendPackagePath, $FrontendPackagePath, $ApiVersionPath, $PdfPath)) {
    Add-Result "Required artifact: $(Split-Path -Leaf $Path)" (Test-Path -LiteralPath $Path -PathType Leaf) $Path
}
if ($ReleaseEvidencePath) {
    Add-Result 'Required release evidence artifact' (Test-Path -LiteralPath $ReleaseEvidencePath -PathType Leaf) $ReleaseEvidencePath
}
if ($Results.Status -contains 'FAIL') {
    $Results | Format-Table -AutoSize
    exit 1
}

$Catalogue = Get-Content -LiteralPath $CataloguePath -Raw | ConvertFrom-Json
$Evidence = Get-Content -LiteralPath $EvidencePath -Raw | ConvertFrom-Json
$Approval = Get-Content -LiteralPath $ApprovalPath -Raw | ConvertFrom-Json
$Package = Get-Content -LiteralPath $PackagePath -Raw | ConvertFrom-Json
$BackendPackage = Get-Content -LiteralPath $BackendPackagePath -Raw | ConvertFrom-Json
$FrontendPackage = Get-Content -LiteralPath $FrontendPackagePath -Raw | ConvertFrom-Json
$ApiVersionSource = Get-Content -LiteralPath $ApiVersionPath -Raw
$Requirements = @($Catalogue.requirements)
$Fields = @($Catalogue.standardFields)
$Statuses = @($Catalogue.lifecycleStatuses)
$EvidenceRows = @($Evidence.requirements)

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $DesignLockTestPath -ProjectRoot $ProjectRoot
$DesignLockExitCode = $LASTEXITCODE
Add-Result 'Approved Design System v1.1 lock' ($DesignLockExitCode -eq 0) "Design lock exit code=$DesignLockExitCode."

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
$ProductVersion = [string]$Package.version
$ValidProductVersion = $ProductVersion -match '^[0-9]+\.[0-9]+\.[0-9]+$'
Add-Result 'Candidate product version is valid' $ValidProductVersion "Candidate source version=$ProductVersion."
$WorkspaceVersionsAlign = (([string]$BackendPackage.version -ceq $ProductVersion) -and ([string]$FrontendPackage.version -ceq $ProductVersion))
Add-Result 'Workspace product versions align' $WorkspaceVersionsAlign "Root=$ProductVersion, Backend=$($BackendPackage.version), Frontend=$($FrontendPackage.version)."
$ApiVersionMatch = [regex]::Match($ApiVersionSource, "releaseVersion\s*=\s*'([^']+)'" )
Add-Result 'API release contract aligns' ($ApiVersionMatch.Success -and $ApiVersionMatch.Groups[1].Value -ceq $ProductVersion) "API release version=$($ApiVersionMatch.Groups[1].Value)."
if ($ExpectedProductVersion) {
    Add-Result 'Expected release version selected' ($ProductVersion -ceq $ExpectedProductVersion) "Expected=$ExpectedProductVersion, Candidate=$ProductVersion."
}

if ($ReleaseGate) {
    Add-Result 'Framework approval recorded' ([string]$Approval.status -ceq 'APPROVED') "Approval status=$($Approval.status)."
    Add-Result 'Approved PDF hash recorded' ([string]$Approval.approvedPdfSha256 -ceq $PdfHash) "Approved hash=$($Approval.approvedPdfSha256)."
    Add-Result 'Approved source commit recorded' (-not [string]::IsNullOrWhiteSpace([string]$Approval.approvedCommit)) "Commit=$($Approval.approvedCommit)."
    if ($ReleaseEvidencePath) {
        $ResolvedReleaseEvidencePath = (Resolve-Path -LiteralPath $ReleaseEvidencePath).Path
        $ReleaseEvidence = Get-Content -LiteralPath $ResolvedReleaseEvidencePath -Raw | ConvertFrom-Json
        $ReleaseRows = @($ReleaseEvidence.requirements)
        $ReleaseIds = @($ReleaseRows.requirementId)
        $UniqueReleaseIds = @($ReleaseIds | Sort-Object -Unique)
        $UnknownReleaseIds = @($UniqueReleaseIds | Where-Object { $_ -notin $UniqueIds })
        $UnpassedReleaseRows = @($ReleaseRows | Where-Object { [string]$_.status -cne 'PASSED' })
        $MissingReleaseEvidence = @($ReleaseRows | Where-Object {
            $Items = @($_.evidence)
            $Items.Count -eq 0 -or @($Items | Where-Object { [string]::IsNullOrWhiteSpace([string]$_) }).Count -gt 0
        })

        Add-Result 'Release evidence framework version' ([string]$ReleaseEvidence.frameworkVersion -ceq '1.0') "Framework=$($ReleaseEvidence.frameworkVersion)."
        Add-Result 'Release evidence change ID' (-not [string]::IsNullOrWhiteSpace([string]$ReleaseEvidence.changeId)) "Change=$($ReleaseEvidence.changeId)."
        Add-Result 'Release evidence scope' (-not [string]::IsNullOrWhiteSpace([string]$ReleaseEvidence.scope)) ([string]$ReleaseEvidence.scope)
        Add-Result 'Release evidence candidate version' (
            -not [string]::IsNullOrWhiteSpace([string]$ExpectedProductVersion) -and
            [string]$ReleaseEvidence.candidateVersion -ceq $ProductVersion -and
            [string]$ReleaseEvidence.candidateVersion -ceq $ExpectedProductVersion
        ) "Evidence=$($ReleaseEvidence.candidateVersion), Candidate=$ProductVersion, Expected=$ExpectedProductVersion."
        Add-Result 'Release evidence requirement coverage' ($ReleaseRows.Count -gt 0 -and $UniqueReleaseIds.Count -eq $ReleaseRows.Count) "Rows=$($ReleaseRows.Count), Unique=$($UniqueReleaseIds.Count)."
        Add-Result 'Release evidence requirement IDs are governed' ($UnknownReleaseIds.Count -eq 0) $(if ($UnknownReleaseIds.Count) { $UnknownReleaseIds -join ', ' } else { 'All release IDs exist in Framework v1.0.' })
        Add-Result 'Release evidence requirements passed' ($UnpassedReleaseRows.Count -eq 0) "Unpassed release requirements=$($UnpassedReleaseRows.Count)."
        Add-Result 'Release evidence references are complete' ($MissingReleaseEvidence.Count -eq 0) "Rows without evidence=$($MissingReleaseEvidence.Count)."
        Add-Result 'Release evidence integrity hash' $true ((Get-FileHash -LiteralPath $ResolvedReleaseEvidencePath -Algorithm SHA256).Hash.ToLowerInvariant())
    } else {
        $Unpassed = @($EvidenceRows | Where-Object { $_.applicability -eq 'APPLICABLE' -and $_.status -ne 'PASSED' })
        Add-Result 'All applicable requirements passed' ($Unpassed.Count -eq 0) "Unpassed requirements=$($Unpassed.Count)."
    }
}

$Results | Format-Table -AutoSize -Wrap
$Failed = @($Results | Where-Object Status -eq 'FAIL')
if ($Failed.Count -gt 0) {
    Write-Host "Framework conformance failed: $($Failed.Count) check(s)." -ForegroundColor Red
    exit 1
}

$Mode = if ($ReleaseGate) { 'release gate' } else { 'catalogue integrity' }
Write-Host "PASS: Framework v1.0 $Mode checks completed." -ForegroundColor Green
