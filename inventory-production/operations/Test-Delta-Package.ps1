[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$PackageRoot,
    [string]$InstalledVersion
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-SafeRelativePath([string]$Path) {
    $Normalized = $Path.Replace('/', [IO.Path]::DirectorySeparatorChar)
    if (-not $Normalized -or [IO.Path]::IsPathRooted($Normalized) -or $Normalized.Split([IO.Path]::DirectorySeparatorChar) -contains '..') {
        throw "Delta manifest contains an unsafe path: $Path"
    }
}

function Get-ComponentPrefix([string]$Component) {
    switch ($Component) {
        'web' { return 'Payload/Application/web/' }
        'api' { return 'Payload/Application/api/' }
        'database' { return 'Payload/Database/Migrations/' }
        'operations' { return 'Payload/Operations/' }
        default { throw "Unknown delta component: $Component" }
    }
}

function Assert-ComponentPath([string]$Path, [string]$Component) {
    $Prefix = Get-ComponentPrefix $Component
    if (-not $Path.StartsWith($Prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Delta path does not belong to its declared $Component component: $Path"
    }
}

if (-not (Test-Path -LiteralPath $PackageRoot -PathType Container)) {
    throw "Delta package directory not found: $PackageRoot"
}
$PackageRoot = (Resolve-Path -LiteralPath $PackageRoot).Path
$ManifestPath = Join-Path $PackageRoot 'delta-manifest.json'
if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
    throw "Delta manifest not found: $ManifestPath"
}

$Manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
if ($Manifest.product -ne 'Inventory Project' -or $Manifest.packageType -ne 'delta') {
    throw 'The package is not an Inventory Project delta.'
}
foreach ($Required in @('fromVersion','toVersion','requiredUpdaterVersion')) {
    if (-not [string]$Manifest.$Required) { throw "Delta manifest is missing $Required." }
}
if ([int]$Manifest.schemaVersion -lt 2) { throw 'Delta manifest schemaVersion 2 or newer is required.' }
foreach ($Required in @('package','web','api')) {
    if (-not [string]$Manifest.expectedVersions.$Required) { throw "Delta manifest is missing expectedVersions.$Required." }
    if ([string]$Manifest.expectedVersions.$Required -cne [string]$Manifest.toVersion) {
        throw "Expected $Required version does not match delta toVersion."
    }
}
if (-not [string]$Manifest.requiredImportContractVersion) { throw 'Delta manifest is missing requiredImportContractVersion.' }
if (@($Manifest.requiredSchemaMigrations) -notcontains [string]$Manifest.requiredImportContractVersion) {
    throw 'The required import contract must also be declared as a required schema migration.'
}
if ([version]$Manifest.toVersion -le [version]$Manifest.fromVersion) {
    throw 'Delta toVersion must be newer than fromVersion.'
}
if ($InstalledVersion -and [string]$InstalledVersion -cne [string]$Manifest.fromVersion) {
    throw "Installed version $InstalledVersion does not match delta source $($Manifest.fromVersion)."
}

$AllowedComponents = @('web','api','database','operations')
$Components = @($Manifest.components)
if (-not $Components.Count) { throw 'Delta manifest contains no changed components.' }
foreach ($Component in $Components) {
    if ($AllowedComponents -notcontains [string]$Component) { throw "Unknown delta component: $Component" }
}

$CompleteComponents = if ($Manifest.PSObject.Properties['completeComponents']) {
    @($Manifest.completeComponents)
} else {
    @()
}
foreach ($Component in $CompleteComponents) {
    if ($Components -notcontains [string]$Component) {
        throw "Complete component is not declared as changed: $Component"
    }
    if ([string]$Component -eq 'database') {
        throw 'Database migrations cannot be declared as a complete replaceable component.'
    }
}

$Expected = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$PayloadEntries = @($Manifest.files)
$VerifiedPayloadFiles = 0
Write-Host "Verifying $($PayloadEntries.Count) delta payload files..." -ForegroundColor Cyan
foreach ($Entry in $PayloadEntries) {
    $Path = ([string]$Entry.path).Replace('\','/')
    Assert-SafeRelativePath $Path
    if (@('added','replaced') -notcontains [string]$Entry.action) { throw "Invalid file action for $Path." }
    if ($Components -notcontains [string]$Entry.component) { throw "File component is not declared: $Path" }
    Assert-ComponentPath $Path ([string]$Entry.component)
    $FullPath = Join-Path $PackageRoot $Path
    if (-not (Test-Path -LiteralPath $FullPath -PathType Leaf)) { throw "Delta file is missing: $Path" }
    $File = Get-Item -LiteralPath $FullPath
    if ($File.Length -ne [long]$Entry.bytes) { throw "Delta file size mismatch: $Path" }
    $Hash = (Get-FileHash -LiteralPath $FullPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($Hash -ne ([string]$Entry.sha256).ToLowerInvariant()) { throw "Delta file hash mismatch: $Path" }
    if (-not $Expected.Add($Path)) { throw "Delta manifest repeats a file: $Path" }
    $VerifiedPayloadFiles++
    if (($VerifiedPayloadFiles % 250) -eq 0 -or $VerifiedPayloadFiles -eq $PayloadEntries.Count) {
        Write-Host "Verified $VerifiedPayloadFiles of $($PayloadEntries.Count) payload files."
    }
}

foreach ($Entry in @($Manifest.removedFiles)) {
    $Path = ([string]$Entry.path).Replace('\','/')
    Assert-SafeRelativePath $Path
    if ($Components -notcontains [string]$Entry.component) { throw "Removed file component is not declared: $Path" }
    Assert-ComponentPath $Path ([string]$Entry.component)
}

foreach ($Migration in @($Manifest.migrations)) {
    if ([string]$Migration.component -ne 'database') { throw "Migration has an invalid component: $($Migration.path)" }
    if ($Components -notcontains 'database') { throw 'A migration exists without the database component.' }
    Assert-ComponentPath ([string]$Migration.path).Replace('\','/') 'database'
    $Match = @($Manifest.files | Where-Object { $_.path -eq $Migration.path -and $_.sha256 -eq $Migration.sha256 })
    if ($Match.Count -ne 1) { throw "Migration is not represented by exactly one verified file: $($Migration.path)" }
}

foreach ($Component in @($Components | Where-Object { $_ -ne 'database' })) {
    $TargetMatches = @($Manifest.targetComponents | Where-Object { [string]$_.component -eq [string]$Component })
    if ($TargetMatches.Count -ne 1) { throw "Delta must contain exactly one complete target manifest for $Component." }
}
if (@($Manifest.targetComponents | Where-Object { [string]$_.component -eq 'database' }).Count) {
    throw 'Database migrations must not be represented as a replaceable target component.'
}

foreach ($Target in @($Manifest.targetComponents)) {
    if ($Components -notcontains [string]$Target.component) { throw "Target component is not declared: $($Target.component)" }
    $Seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($File in @($Target.files)) {
        Assert-SafeRelativePath ([string]$File.path)
        if (-not $Seen.Add([string]$File.path)) { throw "Target component repeats a file: $($File.path)" }
        if (-not [string]$File.sha256 -or [long]$File.bytes -lt 0) { throw "Target component metadata is incomplete: $($File.path)" }
    }
}

foreach ($Component in $CompleteComponents) {
    $Target = @($Manifest.targetComponents | Where-Object { [string]$_.component -eq [string]$Component })
    if ($Target.Count -ne 1) {
        throw "Complete component must have exactly one target manifest: $Component"
    }

    $Prefix = Get-ComponentPrefix ([string]$Component)
    $PayloadFiles = @($Manifest.files | Where-Object { [string]$_.component -eq [string]$Component })
    if ($PayloadFiles.Count -ne @($Target[0].files).Count) {
        throw "Complete $Component payload contains $($PayloadFiles.Count) files but its target manifest requires $(@($Target[0].files).Count)."
    }

    foreach ($TargetFile in @($Target[0].files)) {
        $ExpectedPath = "$Prefix$(([string]$TargetFile.path).Replace('\','/'))"
        $Matches = @($PayloadFiles | Where-Object {
            ([string]$_.path).Replace('\','/') -ieq $ExpectedPath -and
            ([string]$_.sha256) -ieq ([string]$TargetFile.sha256) -and
            [long]$_.bytes -eq [long]$TargetFile.bytes
        })
        if ($Matches.Count -ne 1) {
            throw "Complete $Component payload is missing or mismatches target file: $($TargetFile.path)"
        }
    }
}

$Actual = @(Get-ChildItem -LiteralPath $PackageRoot -Recurse -File | ForEach-Object {
    $_.FullName.Substring($PackageRoot.Length + 1).Replace('\','/')
} | Where-Object { $_ -ine 'delta-manifest.json' })
$Unexpected = @($Actual | Where-Object { -not $Expected.Contains($_) })
if ($Unexpected.Count) { throw "Delta contains unlisted files: $($Unexpected -join ', ')" }
if ($Actual.Count -ne $Expected.Count) { throw 'Delta file count does not match its manifest.' }

Write-Host "PASS: Verified Inventory Project delta $($Manifest.fromVersion) -> $($Manifest.toVersion)." -ForegroundColor Green
Write-Host "Components: $($Components -join ', ')"
Write-Host "Payload files: $($Expected.Count)"
