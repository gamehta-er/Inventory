[CmdletBinding()]
param(
    [string]$PackageRoot = $PSScriptRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $PackageRoot -PathType Container)) {
    throw "Package directory not found: $PackageRoot"
}
$PackageRoot = (Resolve-Path -LiteralPath $PackageRoot).Path

$ManifestPath = Join-Path $PackageRoot 'release-manifest.json'
if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
    throw "Release manifest not found: $ManifestPath"
}

$Manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
if ($Manifest.product -ne 'Inventory Project') { throw 'Release manifest product is invalid.' }
if (-not $Manifest.files -or $Manifest.files.Count -lt 1) { throw 'Release manifest contains no files.' }

$Expected = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($Entry in $Manifest.files) {
    $Relative = ([string]$Entry.path).Replace('/', [IO.Path]::DirectorySeparatorChar)
    if ([IO.Path]::IsPathRooted($Relative) -or $Relative.Split([IO.Path]::DirectorySeparatorChar) -contains '..') {
        throw "Release manifest contains an unsafe path: $($Entry.path)"
    }

    $FullPath = Join-Path $PackageRoot $Relative
    if (-not (Test-Path -LiteralPath $FullPath -PathType Leaf)) { throw "Package file is missing: $($Entry.path)" }
    $File = Get-Item -LiteralPath $FullPath
    if ($File.Length -ne [long]$Entry.bytes) { throw "Package file size mismatch: $($Entry.path)" }
    $Hash = (Get-FileHash -LiteralPath $FullPath -Algorithm SHA256).Hash
    if ($Hash -ine [string]$Entry.sha256) { throw "Package file hash mismatch: $($Entry.path)" }
    [void]$Expected.Add(([string]$Entry.path).Replace('\','/'))
}

$Actual = @(Get-ChildItem -LiteralPath $PackageRoot -Recurse -File | ForEach-Object {
    $_.FullName.Substring($PackageRoot.Length + 1).Replace('\','/')
} | Where-Object { $_ -ine 'release-manifest.json' })
$Unexpected = @($Actual | Where-Object { -not $Expected.Contains($_) })
if ($Unexpected.Count) { throw "Package contains files absent from the manifest: $($Unexpected -join ', ')" }
if ($Actual.Count -ne $Expected.Count) { throw 'Package file count does not match the release manifest.' }

Write-Host "PASS: Verified $($Expected.Count) package files against the release manifest." -ForegroundColor Green
