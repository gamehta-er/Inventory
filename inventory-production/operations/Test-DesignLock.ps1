[CmdletBinding()]
param(
    [string]$ProjectRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Split-Path -Parent $PSScriptRoot
}

$LockPath = Join-Path $ProjectRoot 'framework\design-lock.json'
$ApprovalPath = Join-Path $ProjectRoot 'framework\design-approval.json'
$DocumentPath = Join-Path $ProjectRoot 'framework\design-system-v1.1.md'
$ChangeRequestPath = Join-Path $ProjectRoot 'framework\design-change-requests\DCR-2026-001-reports-intelligence.md'
$CommandCenterRequestPath = Join-Path $ProjectRoot 'framework\design-change-requests\DCR-2026-002-management-command-center.md'
$StylesPath = Join-Path $ProjectRoot 'frontend\src\styles.css'
$AppPath = Join-Path $ProjectRoot 'frontend\src\App.tsx'
$Results = [System.Collections.Generic.List[object]]::new()

function Add-Result([string]$Check, [bool]$Passed, [string]$Detail) {
    $Results.Add([pscustomobject]@{
        Check = $Check
        Status = if ($Passed) { 'PASS' } else { 'FAIL' }
        Detail = $Detail
    })
}

foreach ($Path in @($LockPath, $ApprovalPath, $DocumentPath, $ChangeRequestPath, $CommandCenterRequestPath, $StylesPath, $AppPath)) {
    Add-Result "Required design artifact: $(Split-Path -Leaf $Path)" (Test-Path -LiteralPath $Path -PathType Leaf) $Path
}

if ($Results.Status -contains 'FAIL') {
    $Results | Format-Table -AutoSize -Wrap
    exit 1
}

$Lock = Get-Content -LiteralPath $LockPath -Raw | ConvertFrom-Json
$Approval = Get-Content -LiteralPath $ApprovalPath -Raw | ConvertFrom-Json
$Styles = Get-Content -LiteralPath $StylesPath -Raw
$App = Get-Content -LiteralPath $AppPath -Raw

Add-Result 'Design System status' ([string]$Lock.status -ceq 'APPROVED_AND_LOCKED') "Status=$($Lock.status)."
Add-Result 'Design System version' ([string]$Lock.designSystemVersion -ceq '1.1') "Version=$($Lock.designSystemVersion)."
Add-Result 'Locked product baseline' ([string]$Lock.baselineProductVersion -ceq '1.3.10') "Baseline=$($Lock.baselineProductVersion)."
Add-Result 'Design approval owner' ([string]$Approval.approvedBy -ceq 'Gaurav Mehta') "Owner=$($Approval.approvedBy)."
Add-Result 'Design approval status' ([string]$Approval.status -ceq 'APPROVED') "Status=$($Approval.status)."
$ChangeRequest = Get-Content -LiteralPath $ChangeRequestPath -Raw
Add-Result 'Approved Reports design change' ($ChangeRequest.Contains('| Status | APPROVED |') -and $ChangeRequest.Contains('| Approved by | Gaurav Mehta |')) 'DCR-2026-001'
$CommandCenterRequest = Get-Content -LiteralPath $CommandCenterRequestPath -Raw
Add-Result 'Approved Management Command Center design change' ($CommandCenterRequest.Contains('| Status | APPROVED |') -and $CommandCenterRequest.Contains('| Approved by | Gaurav Mehta |')) 'DCR-2026-002'

$DocumentHash = (Get-FileHash -LiteralPath $DocumentPath -Algorithm SHA256).Hash.ToLowerInvariant()
$LockHash = (Get-FileHash -LiteralPath $LockPath -Algorithm SHA256).Hash.ToLowerInvariant()
Add-Result 'Approved design document integrity' ([string]$Approval.designDocumentSha256 -ceq $DocumentHash) $DocumentHash
Add-Result 'Approved lock manifest integrity' ([string]$Approval.designLockSha256 -ceq $LockHash) $LockHash

foreach ($Entry in @($Lock.lockedFiles)) {
    $Path = Join-Path $ProjectRoot ([string]$Entry.path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        Add-Result "Locked file: $($Entry.path)" $false 'File is missing.'
        continue
    }

    $Item = Get-Item -LiteralPath $Path
    $Hash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    $Matches = ($Item.Length -eq [long]$Entry.bytes) -and ($Hash -ceq [string]$Entry.sha256)
    Add-Result "Locked file: $($Entry.path)" $Matches "Bytes=$($Item.Length); SHA256=$Hash"
}

foreach ($Property in $Lock.tokens.PSObject.Properties) {
    $Expected = "$($Property.Name): $($Property.Value);"
    Add-Result "Design token: $($Property.Name)" $Styles.Contains($Expected) $Expected
}

foreach ($Breakpoint in @($Lock.breakpoints)) {
    $Expected = "@media (max-width: $($Breakpoint)px)"
    Add-Result "Responsive breakpoint: $($Breakpoint)px" $Styles.Contains($Expected) $Expected
}

$CssFiles = @(Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'frontend\src') -Recurse -Filter '*.css' -File)
Add-Result 'Single frontend stylesheet' ($CssFiles.Count -eq 1 -and $CssFiles[0].FullName -ceq $StylesPath) "Found $($CssFiles.Count) CSS file(s)."

$TsxFiles = @(Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'frontend\src') -Recurse -File |
    Where-Object Extension -in @('.ts', '.tsx'))
$SourcePaths = @($TsxFiles | ForEach-Object FullName)
$InlineStyleCount = 0
$RawColorCount = 0
foreach ($SourcePath in $SourcePaths) {
    $SourceText = [System.IO.File]::ReadAllText($SourcePath)
    $InlineStyleCount += [regex]::Matches($SourceText, 'style\s*=\s*\{\{').Count
    $RawColorCount += [regex]::Matches($SourceText, '#[0-9A-Fa-f]{3,8}\b|rgba?\(').Count
}
Add-Result 'No inline TSX visual styles' ($InlineStyleCount -eq 0) "Matches=$InlineStyleCount."
Add-Result 'No raw TSX color values' ($RawColorCount -eq 0) "Matches=$RawColorCount."

foreach ($Pattern in @('AppShell', 'RouteErrorBoundary', 'ToastRegion')) {
    Add-Result "Application composes $Pattern" $App.Contains($Pattern) $Pattern
}

Add-Result 'Reduced-motion support' $Styles.Contains('@media (prefers-reduced-motion: reduce)') 'Required media query is present.'
Add-Result 'Print isolation' ($Styles.Contains('@media print') -and $Styles.Contains('@page { size: 2.125in 1in; margin: 0; }')) 'Label page contract is present.'
Add-Result 'Sites hosting remains disabled' (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot '.openai\hosting.json'))) 'IIS remains the production host.'

$Results | Format-Table -AutoSize -Wrap
$Failed = @($Results | Where-Object Status -eq 'FAIL')
if ($Failed.Count -gt 0) {
    Write-Host "Design lock failed: $($Failed.Count) check(s)." -ForegroundColor Red
    Write-Host 'Stop packaging. Restore the approved baseline or obtain an approved Design Change Request.' -ForegroundColor Red
    exit 1
}

Write-Host 'PASS: Inventory Project Design System v1.1 is intact.' -ForegroundColor Green
Write-Host 'Baseline: Inventory Project 1.3.10' -ForegroundColor Green
