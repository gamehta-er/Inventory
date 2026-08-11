[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$FromPackageRoot,
    [Parameter(Mandatory)][string]$ToPackageRoot,
    [string]$OutputRoot,
    [string]$RequiredUpdaterVersion = '1.2.0',
    [string[]]$CompleteComponents = @(),
    [switch]$VerifySourcePackages
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputRoot) { $OutputRoot = Join-Path $ProjectRoot 'artifacts' }
$FullVerifier = Join-Path $ProjectRoot 'installer\Test-Production-Package.ps1'
$DeltaVerifier = Join-Path $PSScriptRoot 'Test-Delta-Package.ps1'

function Read-Release([string]$Root) {
    if (-not (Test-Path -LiteralPath $Root -PathType Container)) { throw "Baseline package not found: $Root" }
    $Resolved = (Resolve-Path -LiteralPath $Root).Path
    if ($VerifySourcePackages) { & $FullVerifier -PackageRoot $Resolved }
    return [pscustomobject]@{
        Root = $Resolved
        Manifest = Get-Content -LiteralPath (Join-Path $Resolved 'release-manifest.json') -Raw | ConvertFrom-Json
    }
}

function Get-Component([string]$Path) {
    $Normalized = $Path.Replace('\','/')
    if ($Normalized.StartsWith('Payload/Application/web/', [StringComparison]::OrdinalIgnoreCase)) { return 'web' }
    if ($Normalized.StartsWith('Payload/Application/api/', [StringComparison]::OrdinalIgnoreCase)) { return 'api' }
    if ($Normalized.StartsWith('Payload/Database/Migrations/', [StringComparison]::OrdinalIgnoreCase)) { return 'database' }
    if ($Normalized.StartsWith('Payload/Operations/', [StringComparison]::OrdinalIgnoreCase)) { return 'operations' }
    return $null
}

function Test-VersionOnlyApiMetadata([string]$Path, [string]$OldFile, [string]$NewFile) {
    $Normalized = $Path.Replace('\','/')
    $Supported = @(
        'Payload/Application/api/package.json',
        'Payload/Application/api/package-lock.json',
        'Payload/Application/api/node_modules/.package-lock.json'
    )
    if ($Supported -notcontains $Normalized) { return $false }
    try {
        $OldText = Get-Content -LiteralPath $OldFile -Raw
        $NewText = Get-Content -LiteralPath $NewFile -Raw
        $OldVersionMatch = [regex]::Match($OldText, '"version"\s*:\s*"([^"]+)"')
        $NewVersionMatch = [regex]::Match($NewText, '"version"\s*:\s*"([^"]+)"')
        if (-not $OldVersionMatch.Success -or -not $NewVersionMatch.Success) { return $false }
        $OldVersion = $OldVersionMatch.Groups[1].Value
        $NewVersion = $NewVersionMatch.Groups[1].Value
        $OldText = [regex]::Replace($OldText, '("version"\s*:\s*")' + [regex]::Escape($OldVersion) + '(")', '$1<release-version>$2')
        $NewText = [regex]::Replace($NewText, '("version"\s*:\s*")' + [regex]::Escape($NewVersion) + '(")', '$1<release-version>$2')
        return ($OldText.Replace("`r`n","`n").Trim() -ceq $NewText.Replace("`r`n","`n").Trim())
    } catch { return $false }
}

function Get-TargetComponentManifest([object]$Release, [string]$Component) {
    $Prefix = switch ($Component) {
        'web' { 'Payload/Application/web/' }
        'api' { 'Payload/Application/api/' }
        'operations' { 'Payload/Operations/' }
        default { return $null }
    }
    $Files = @($Release.Manifest.files | Where-Object { ([string]$_.path).Replace('\','/').StartsWith($Prefix, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object {
        [ordered]@{
            path = ([string]$_.path).Replace('\','/').Substring($Prefix.Length)
            bytes = [long]$_.bytes
            sha256 = ([string]$_.sha256).ToLowerInvariant()
        }
    } | Sort-Object path)
    return [ordered]@{ component=$Component; files=$Files }
}

$From = Read-Release $FromPackageRoot
$To = Read-Release $ToPackageRoot
if ($From.Manifest.product -ne 'Inventory Project' -or $To.Manifest.product -ne 'Inventory Project') { throw 'Both inputs must be Inventory Project releases.' }
$FromVersion = [string]$From.Manifest.version
$ToVersion = [string]$To.Manifest.version
if ([version]$ToVersion -le [version]$FromVersion) { throw 'The target release must be newer than the source release.' }

$FromMap = @{}
foreach ($File in $From.Manifest.files) { $FromMap[[string]$File.path] = $File }
$ToMap = @{}
foreach ($File in $To.Manifest.files) { $ToMap[[string]$File.path] = $File }

$Changes = [Collections.Generic.List[object]]::new()
foreach ($Path in $ToMap.Keys) {
    $Action = if (-not $FromMap.ContainsKey($Path)) { 'added' } elseif ([string]$FromMap[$Path].sha256 -ine [string]$ToMap[$Path].sha256) { 'replaced' } else { $null }
    if (-not $Action) { continue }
    if ($Action -eq 'replaced' -and (Test-VersionOnlyApiMetadata $Path (Join-Path $From.Root $Path) (Join-Path $To.Root $Path))) { continue }
    $Component = Get-Component $Path
    if (-not $Component) { throw "A changed baseline file cannot be delivered as a delta: $Path. Promote a new baseline or publish an explicit operations update." }
    if ($Component -eq 'database' -and $Action -ne 'added') { throw "Existing migrations are immutable and cannot be $Action`: $Path" }
    $Changes.Add([pscustomobject]@{ path=$Path; action=$Action; component=$Component; source=$ToMap[$Path] })
}
foreach ($Path in $FromMap.Keys) {
    if ($ToMap.ContainsKey($Path)) { continue }
    $Component = Get-Component $Path
    if (-not $Component) { throw "A removed baseline file cannot be delivered as a delta: $Path" }
    if ($Component -eq 'database') { throw "Database migrations cannot be removed: $Path" }
    $Changes.Add([pscustomobject]@{ path=$Path; action='removed'; component=$Component; source=$null })
}

# When API code changed, keep its release metadata aligned with the complete
# target API manifest. Metadata-only release version changes remain excluded.
if (@($Changes | Where-Object { $_.component -eq 'api' }).Count) {
    foreach ($Path in @(
        'Payload/Application/api/package.json',
        'Payload/Application/api/package-lock.json',
        'Payload/Application/api/node_modules/.package-lock.json'
    )) {
        if (-not $FromMap.ContainsKey($Path) -or -not $ToMap.ContainsKey($Path)) { continue }
        if ([string]$FromMap[$Path].sha256 -ieq [string]$ToMap[$Path].sha256) { continue }
        if (@($Changes | Where-Object { $_.path -eq $Path }).Count) { continue }
        $Changes.Add([pscustomobject]@{ path=$Path; action='replaced'; component='api'; source=$ToMap[$Path] })
    }
}

# Operations updates are deliberately self-contained. Production may have an
# older release-tools installation even when the application version matches,
# so staging only changed scripts would make complete-component validation
# depend on files that are not guaranteed to exist on the server.
if (@($Changes | Where-Object { $_.component -eq 'operations' }).Count) {
    foreach ($Path in @($ToMap.Keys | Where-Object { (Get-Component $_) -eq 'operations' })) {
        if (@($Changes | Where-Object { $_.path -eq $Path }).Count) { continue }
        $Changes.Add([pscustomobject]@{ path=$Path; action='replaced'; component='operations'; source=$ToMap[$Path] })
    }
}

# Recovery deltas may declare any replaceable component as complete. Include
# every target file so staging never depends on the condition of the live
# component being repaired.
foreach ($CompleteComponent in $CompleteComponents) {
    if ($CompleteComponent -notin @('web','api','operations')) {
        throw "Unsupported complete component: $CompleteComponent"
    }
    foreach ($Path in @($ToMap.Keys | Where-Object { (Get-Component $_) -eq $CompleteComponent })) {
        if (@($Changes | Where-Object { $_.path -eq $Path }).Count) { continue }
        $Changes.Add([pscustomobject]@{ path=$Path; action='replaced'; component=$CompleteComponent; source=$ToMap[$Path] })
    }
}
if (-not $Changes.Count) { throw 'The releases contain no deployable component changes.' }

$Components = @($Changes.component | Sort-Object -Unique)
$DeclaredCompleteComponents = [Collections.Generic.List[string]]::new()
foreach ($Component in $CompleteComponents) {
    if ($Components -notcontains [string]$Component) { throw "Complete component is not changed: $Component" }
    if ([string]$Component -eq 'database') { throw 'Database cannot be a complete replaceable component.' }
    if (-not $DeclaredCompleteComponents.Contains([string]$Component)) { $DeclaredCompleteComponents.Add([string]$Component) }
}
if ($Components -contains 'operations' -and -not $DeclaredCompleteComponents.Contains('operations')) {
    $DeclaredCompleteComponents.Add('operations')
}
$PackageName = "InventoryProject-Delta-$FromVersion-to-$ToVersion"
$Staging = Join-Path $OutputRoot $PackageName
$Archive = Join-Path $OutputRoot "$PackageName.zip"
New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
Remove-Item -LiteralPath $Staging -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $Archive -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Staging | Out-Null

$ManifestFiles = [Collections.Generic.List[object]]::new()
$RemovedFiles = [Collections.Generic.List[object]]::new()
$Migrations = [Collections.Generic.List[object]]::new()
foreach ($Change in ($Changes | Sort-Object path)) {
    if ($Change.action -eq 'removed') {
        $RemovedFiles.Add([ordered]@{ path=$Change.path; component=$Change.component })
        continue
    }
    $Source = Join-Path $To.Root $Change.path
    $Destination = Join-Path $Staging $Change.path
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
    $File = Get-Item -LiteralPath $Destination
    $Hash = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($File.Length -ne [long]$Change.source.bytes -or $Hash -ne ([string]$Change.source.sha256).ToLowerInvariant()) {
        throw "Target baseline file does not match its release manifest: $($Change.path)"
    }
    $Entry = [ordered]@{ path=$Change.path.Replace('\','/'); component=$Change.component; action=$Change.action; bytes=$File.Length; sha256=$Hash }
    $ManifestFiles.Add($Entry)
    if ($Change.component -eq 'database') {
        $MigrationId = [IO.Path]::GetFileNameWithoutExtension($Change.path)
        $Sql = Get-Content -LiteralPath $Destination -Raw
        if ($Sql -notmatch '(?im)^\s*BEGIN\s*;' -or $Sql -notmatch '(?im)^\s*COMMIT\s*;' -or $Sql -notmatch [regex]::Escape($MigrationId)) {
            throw "Migration is not transactionally journaled with its filename ID: $($Change.path)"
        }
        $Migrations.Add([ordered]@{ id=$MigrationId; path=$Entry.path; component='database'; sha256=$Hash })
    }
}

$TargetComponents = [Collections.Generic.List[object]]::new()
foreach ($Component in $Components) {
    $Target = Get-TargetComponentManifest $To $Component
    if ($Target) { $TargetComponents.Add($Target) }
}

$Manifest = [ordered]@{
    schemaVersion = 2
    product = 'Inventory Project'
    packageType = 'delta'
    fromVersion = $FromVersion
    toVersion = $ToVersion
    requiredUpdaterVersion = $RequiredUpdaterVersion
    expectedVersions = [ordered]@{
        package = $ToVersion
        web = $ToVersion
        api = $ToVersion
    }
    requiredImportContractVersion = '005-complete-import-workflow'
    requiredSchemaMigrations = @('005-complete-import-workflow')
    createdAt = (Get-Date).ToUniversalTime().ToString('o')
    components = $Components
    completeComponents = @($DeclaredCompleteComponents)
    files = @($ManifestFiles)
    removedFiles = @($RemovedFiles)
    migrations = @($Migrations)
    targetComponents = @($TargetComponents)
}
$Manifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $Staging 'delta-manifest.json') -Encoding UTF8
& $DeltaVerifier -PackageRoot $Staging

Compress-Archive -Path (Join-Path $Staging '*') -DestinationPath $Archive -CompressionLevel Optimal
$ArchiveHash = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash
Write-Host 'Inventory Project delta created.' -ForegroundColor Green
Write-Host "From: $FromVersion"
Write-Host "To: $ToVersion"
Write-Host "Components: $($Components -join ', ')"
Write-Host "Changed payload files: $($ManifestFiles.Count)"
Write-Host "Removed files: $($RemovedFiles.Count)"
Write-Host "Archive: $Archive"
Write-Host "SHA-256: $ArchiveHash"
