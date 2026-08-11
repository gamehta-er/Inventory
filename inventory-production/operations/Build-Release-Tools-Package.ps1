[CmdletBinding()]
param(
    [string]$Version = '1.0.0',
    [string]$OutputRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputRoot) { $OutputRoot = Join-Path $ProjectRoot 'artifacts' }
$PackageName = "InventoryProject-ReleaseTools-$Version"
$Staging = Join-Path $OutputRoot $PackageName
$Archive = Join-Path $OutputRoot "$PackageName.zip"
Remove-Item -LiteralPath $Staging -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $Archive -Force -ErrorAction SilentlyContinue
$Payload = Join-Path $Staging 'Payload\Operations'
New-Item -ItemType Directory -Force -Path $Payload | Out-Null

foreach ($Name in @('Invoke-InventoryUpdate.ps1','Remove-InventoryUpdateCache.ps1','Test-Delta-Package.ps1','Test-Release-System.ps1')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $Name) -Destination $Payload
}
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'installer\Install-InventoryReleaseTools.ps1') -Destination $Staging

foreach ($File in Get-ChildItem -LiteralPath $Staging -Recurse -Filter '*.ps1' -File) {
    [void][scriptblock]::Create((Get-Content -LiteralPath $File.FullName -Raw))
}
$Files = @(Get-ChildItem -LiteralPath $Payload -Recurse -File | Sort-Object FullName | ForEach-Object {
    [ordered]@{
        path=$_.FullName.Substring($Staging.Length + 1).Replace('\','/')
        bytes=$_.Length
        sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
})
$Manifest = [ordered]@{
    schemaVersion=1
    product='Inventory Project'
    packageType='release-tools'
    version=$Version
    createdAt=(Get-Date).ToUniversalTime().ToString('o')
    files=$Files
}
$Manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $Staging 'release-tools-manifest.json') -Encoding UTF8

Compress-Archive -Path (Join-Path $Staging '*') -DestinationPath $Archive -CompressionLevel Optimal
Write-Host 'Inventory Project release-tools package created.' -ForegroundColor Green
Write-Host "Archive: $Archive"
Write-Host "SHA-256: $((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash)"
