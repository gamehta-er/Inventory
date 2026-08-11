[CmdletBinding()]
param(
    [string]$InstallerRoot = 'C:\InventoryProject-Install',
    [switch]$PlanOnly,
    [switch]$Confirmed
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $InstallerRoot -PathType Container)) {
    throw "Installer folder does not exist: $InstallerRoot"
}

$ResolvedRoot = (Resolve-Path -LiteralPath $InstallerRoot).Path.TrimEnd('\')
if ([IO.Path]::GetFileName($ResolvedRoot) -cne 'InventoryProject-Install') {
    throw "Safety check failed. The target folder must be named InventoryProject-Install: $ResolvedRoot"
}

$VersionedDirectoryPattern = '^InventoryProject-[0-9]+\.[0-9]+\.[0-9]+$'
$PackagePattern = '^InventoryProject-(?:[0-9]+\.[0-9]+\.[0-9]+|Delta-.+|ReleaseTools-.+)\.zip$'
$Candidates = @(
    Get-ChildItem -LiteralPath $ResolvedRoot -Force | Where-Object {
        ($_.PSIsContainer -and $_.Name -match $VersionedDirectoryPattern) -or
        (-not $_.PSIsContainer -and $_.Name -match $PackagePattern)
    }
)

Write-Host 'Inventory Project installer cleanup' -ForegroundColor Cyan
Write-Host "Target: $ResolvedRoot"
Write-Host 'Preserved: Prerequisites and every nonmatching item.'
Write-Host ''

if ($Candidates.Count -eq 0) {
    Write-Host 'PASS: No versioned installer folders or packages need cleanup.' -ForegroundColor Green
    exit 0
}

$Candidates |
    Sort-Object PSIsContainer, Name |
    Select-Object Name, @{Name='Type';Expression={if ($_.PSIsContainer) {'Folder'} else {'ZIP package'}}}, LastWriteTime |
    Format-Table -AutoSize

if ($PlanOnly) {
    Write-Host "PLAN: $($Candidates.Count) item(s) would be removed. No files were changed." -ForegroundColor Yellow
    exit 0
}

$Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$Principal = [Security.Principal.WindowsPrincipal]::new($Identity)
if (-not $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this cleanup from an elevated PowerShell window.'
}

if (-not $Confirmed) {
    $Answer = Read-Host 'Permanently remove only the listed items? Type DELETE INSTALLER CLUTTER'
    if ($Answer -cne 'DELETE INSTALLER CLUTTER') {
        throw 'No files were removed.'
    }
}

$LogPath = Join-Path $ResolvedRoot 'Cleanup-InventoryProjectInstall.log'
$Removed = [Collections.Generic.List[string]]::new()
foreach ($Candidate in $Candidates) {
    $CandidatePath = [IO.Path]::GetFullPath($Candidate.FullName)
    if (-not $CandidatePath.StartsWith($ResolvedRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Safety check failed for cleanup target: $CandidatePath"
    }

    Remove-Item -LiteralPath $CandidatePath -Recurse -Force
    $Removed.Add($CandidatePath)
}

$Remaining = @(
    Get-ChildItem -LiteralPath $ResolvedRoot -Force | Where-Object {
        ($_.PSIsContainer -and $_.Name -match $VersionedDirectoryPattern) -or
        (-not $_.PSIsContainer -and $_.Name -match $PackagePattern)
    }
)
if ($Remaining.Count -gt 0) {
    throw "Cleanup verification failed. $($Remaining.Count) matching item(s) remain."
}

$LogLines = @(
    "Inventory Project installer cleanup"
    "Completed: $((Get-Date).ToString('o'))"
    "Operator: $([Security.Principal.WindowsIdentity]::GetCurrent().Name)"
    "Target: $ResolvedRoot"
    "Removed: $($Removed.Count)"
    $Removed
)
[IO.File]::WriteAllLines($LogPath, $LogLines, [Text.UTF8Encoding]::new($false))

Write-Host "PASS: Removed $($Removed.Count) obsolete installer item(s)." -ForegroundColor Green
Write-Host "Log: $LogPath"
Write-Host 'The live application and PostgreSQL were not accessed.' -ForegroundColor Green
