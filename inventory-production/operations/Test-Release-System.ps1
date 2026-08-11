[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$DeltaPackageRoot,
    [Parameter(Mandatory)][string]$ExpectedFromVersion,
    [Parameter(Mandatory)][string]$ExpectedToVersion,
    [string[]]$ExpectedComponents = @('web')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Verifier = Join-Path $PSScriptRoot 'Test-Delta-Package.ps1'
if (-not (Test-Path -LiteralPath $Verifier -PathType Leaf)) { throw "Delta verifier not found: $Verifier" }
$DeltaPackageRoot = (Resolve-Path -LiteralPath $DeltaPackageRoot -ErrorAction Stop).Path
$ManifestPath = Join-Path $DeltaPackageRoot 'delta-manifest.json'
$Manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json

& $Verifier -PackageRoot $DeltaPackageRoot -InstalledVersion $ExpectedFromVersion
if ([string]$Manifest.fromVersion -cne $ExpectedFromVersion) { throw "Unexpected fromVersion: $($Manifest.fromVersion)" }
if ([string]$Manifest.toVersion -cne $ExpectedToVersion) { throw "Unexpected toVersion: $($Manifest.toVersion)" }

$ActualComponents = @($Manifest.components | Sort-Object)
$WantedComponents = @($ExpectedComponents | Sort-Object)
if (($ActualComponents -join '|') -cne ($WantedComponents -join '|')) {
    throw "Unexpected component set. Expected $($WantedComponents -join ', '); found $($ActualComponents -join ', ')."
}

$Forbidden = @($Manifest.files | Where-Object {
    ([string]$_.path) -match '^Payload/(Application/api|Database|Operations)/'
})
if ($ExpectedComponents.Count -eq 1 -and $ExpectedComponents[0] -eq 'web' -and $Forbidden.Count) {
    throw "Web-only delta contains non-web payloads: $($Forbidden.path -join ', ')"
}

$VersionRejected = $false
try { & $Verifier -PackageRoot $DeltaPackageRoot -InstalledVersion $ExpectedToVersion *> $null }
catch { $VersionRejected = $_.Exception.Message -like 'Installed version*does not match delta source*' }
if (-not $VersionRejected) { throw 'Wrong installed-version rejection was not proven.' }
Write-Host 'PASS: Incorrect installed version is rejected.' -ForegroundColor Green

$TamperRoot = Join-Path ([IO.Path]::GetTempPath()) ("InventoryDeltaTamper-{0}" -f [guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Force -Path $TamperRoot | Out-Null
    Get-ChildItem -LiteralPath $DeltaPackageRoot -Force | Copy-Item -Destination $TamperRoot -Recurse -Force
    $Payload = Get-ChildItem -LiteralPath (Join-Path $TamperRoot 'Payload') -Recurse -File | Select-Object -First 1
    if (-not $Payload) { throw 'Delta has no payload file available for the tamper test.' }
    [IO.File]::AppendAllText($Payload.FullName, 'tampered')
    $TamperRejected = $false
    try { & $Verifier -PackageRoot $TamperRoot -InstalledVersion $ExpectedFromVersion *> $null }
    catch { $TamperRejected = $_.Exception.Message -like 'Delta file size mismatch:*' -or $_.Exception.Message -like 'Delta file hash mismatch:*' }
    if (-not $TamperRejected) { throw 'Tampered package rejection was not proven.' }
    Write-Host 'PASS: Tampered payload is rejected.' -ForegroundColor Green
}
finally {
    Remove-Item -LiteralPath $TamperRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "PASS: Release-system checks completed for $ExpectedFromVersion -> $ExpectedToVersion." -ForegroundColor Green
Write-Host "Components: $($ActualComponents -join ', ')"
Write-Host "Payload files: $(@($Manifest.files).Count)"
Write-Host "Removed files: $(@($Manifest.removedFiles).Count)"
Write-Host "Migrations: $(@($Manifest.migrations).Count)"
