[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('APPROVED','REJECTED','APPROVED_WITH_CHANGES')]
    [string]$Decision,

    [Parameter(Mandatory)]
    [string]$ProductOwner,

    [string]$Comments = '',

    [switch]$Confirmed
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $Confirmed) {
    throw 'No decision was recorded. Re-run with -Confirmed only after the Product Owner makes the decision.'
}
if ($ProductOwner -cne 'Gaurav Mehta') {
    throw 'Framework v1.0 approval authority is Gaurav Mehta.'
}

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ApprovalPath = Join-Path $ProjectRoot 'framework\approval.json'
$PdfPath = Join-Path $ProjectRoot 'output\pdf\Inventory-Project-Product-and-Engineering-Framework-v1.0.pdf'
if (-not (Test-Path -LiteralPath $PdfPath -PathType Leaf)) { throw "Framework PDF not found: $PdfPath" }

$Git = (Get-Command git.exe -ErrorAction Stop).Source
$Commit = (& $Git -C $ProjectRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($Commit)) { throw 'Unable to resolve the candidate source commit.' }
$PdfHash = (Get-FileHash -LiteralPath $PdfPath -Algorithm SHA256).Hash.ToLowerInvariant()
$Status = if ($Decision -eq 'APPROVED') { 'APPROVED' } elseif ($Decision -eq 'APPROVED_WITH_CHANGES') { 'APPROVED_WITH_CHANGES' } else { 'REJECTED' }

$Record = [ordered]@{
    frameworkVersion = '1.0'
    productOwner = $ProductOwner
    status = $Status
    decision = $Decision
    approvedAt = (Get-Date).ToUniversalTime().ToString('o')
    approvedPdfSha256 = $PdfHash
    approvedCommit = $Commit
    approvalEvidence = "Recorded by $env:USERDOMAIN\$env:USERNAME using Record-FrameworkApproval.ps1"
    comments = $Comments
}
$Record | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ApprovalPath -Encoding UTF8

Write-Host "Framework v1.0 decision recorded: $Decision" -ForegroundColor Green
Write-Host "PDF SHA-256: $PdfHash"
Write-Host "Candidate commit: $Commit"
if ($Decision -ne 'APPROVED') {
    Write-Host 'Release packaging remains blocked.' -ForegroundColor Yellow
}
