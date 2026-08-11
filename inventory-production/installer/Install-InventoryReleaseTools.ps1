[CmdletBinding()]
param(
    [string]$PackageRoot = $PSScriptRoot,
    [string]$InstallRoot = 'D:\Inventory Project',
    [switch]$Confirmed
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$Principal = [Security.Principal.WindowsPrincipal]::new($Identity)
if (-not $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run the release-tools installer from an elevated PowerShell window.'
}
if (-not $Confirmed) {
    $Answer = Read-Host 'Install the permanent Inventory Project delta updater? Type INSTALL INVENTORY RELEASE TOOLS'
    if ($Answer -cne 'INSTALL INVENTORY RELEASE TOOLS') { throw 'No files were changed.' }
}

$ManifestPath = Join-Path $PackageRoot 'release-tools-manifest.json'
$DeploymentPath = Join-Path $InstallRoot 'Config\deployment.json'
$PayloadRoot = Join-Path $PackageRoot 'Payload\Operations'
foreach ($Required in @($ManifestPath,$DeploymentPath)) {
    if (-not (Test-Path -LiteralPath $Required -PathType Leaf)) { throw "Required file not found: $Required" }
}
if (-not (Test-Path -LiteralPath $PayloadRoot -PathType Container)) { throw "Release-tools payload not found: $PayloadRoot" }

$Manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
if ($Manifest.product -ne 'Inventory Project' -or $Manifest.packageType -ne 'release-tools') { throw 'Invalid release-tools package.' }
$Expected = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($Entry in @($Manifest.files)) {
    $Relative = ([string]$Entry.path).Replace('/','\')
    if ([IO.Path]::IsPathRooted($Relative) -or $Relative.Split('\') -contains '..') { throw "Unsafe package path: $($Entry.path)" }
    $FilePath = Join-Path $PackageRoot $Relative
    if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) { throw "Release-tools file missing: $($Entry.path)" }
    $File = Get-Item -LiteralPath $FilePath
    if ($File.Length -ne [long]$Entry.bytes) { throw "Release-tools file size mismatch: $($Entry.path)" }
    if ((Get-FileHash -LiteralPath $FilePath -Algorithm SHA256).Hash -ine [string]$Entry.sha256) { throw "Release-tools hash mismatch: $($Entry.path)" }
    [void]$Expected.Add(([string]$Entry.path).Replace('\','/'))
}
$Actual = @(Get-ChildItem -LiteralPath $PackageRoot -Recurse -File | ForEach-Object { $_.FullName.Substring($PackageRoot.Length + 1).Replace('\','/') } | Where-Object { $_ -ine 'release-tools-manifest.json' -and $_ -ine 'Install-InventoryReleaseTools.ps1' })
$Unexpected = @($Actual | Where-Object { -not $Expected.Contains($_) })
if ($Unexpected.Count -or $Actual.Count -ne $Expected.Count) { throw 'Release-tools package contents do not match its manifest.' }

$OperationsRoot = Join-Path $InstallRoot 'Operations'
New-Item -ItemType Directory -Force -Path $OperationsRoot | Out-Null
Get-ChildItem -LiteralPath $PayloadRoot -File | Copy-Item -Destination $OperationsRoot -Force

$Deployment = Get-Content -LiteralPath $DeploymentPath -Raw | ConvertFrom-Json
$Deployment | Add-Member -NotePropertyName UpdaterVersion -NotePropertyValue ([string]$Manifest.version) -Force
$Deployment | Add-Member -NotePropertyName UpdaterInstalledAt -NotePropertyValue (Get-Date).ToUniversalTime().ToString('o') -Force
$Deployment | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $DeploymentPath -Encoding UTF8

$LedgerRoot = Join-Path $InstallRoot 'Logs\Releases'
New-Item -ItemType Directory -Force -Path $LedgerRoot | Out-Null
$Record = [ordered]@{
    timestamp=(Get-Date).ToUniversalTime().ToString('o')
    operator=$Identity.Name
    action='INSTALL_RELEASE_TOOLS'
    updaterVersion=[string]$Manifest.version
    result='SUCCESS'
}
($Record | ConvertTo-Json -Compress) | Add-Content -LiteralPath (Join-Path $LedgerRoot 'release-ledger.jsonl') -Encoding UTF8

Write-Host "PASS: Inventory Project release updater $($Manifest.version) installed." -ForegroundColor Green
Write-Host "Updater: $(Join-Path $OperationsRoot 'Invoke-InventoryUpdate.ps1')"
Write-Host "Cleanup: $(Join-Path $OperationsRoot 'Remove-InventoryUpdateCache.ps1')"

