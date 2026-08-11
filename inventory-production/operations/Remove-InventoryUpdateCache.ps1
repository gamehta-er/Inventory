[CmdletBinding()]
param(
    [string]$InstallerRoot = 'C:\InventoryProject-Install',
    [string]$InstallRoot = 'D:\Inventory Project',
    [int]$AbandonedAfterHours = 24,
    [switch]$Confirmed
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$Principal = [Security.Principal.WindowsPrincipal]::new($Identity)
if (-not $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run cleanup from an elevated PowerShell window.'
}
if (-not $Confirmed) {
    $Answer = Read-Host 'Remove Inventory installer extractions, applied update ZIPs, and abandoned update workspaces? Type CLEAN INVENTORY UPDATES'
    if ($Answer -cne 'CLEAN INVENTORY UPDATES') { throw 'No files were removed.' }
}

$Removed = [Collections.Generic.List[string]]::new()
if (Test-Path -LiteralPath $InstallerRoot -PathType Container) {
    $InstallerRoot = (Resolve-Path -LiteralPath $InstallerRoot).Path
    foreach ($Directory in @(Get-ChildItem -LiteralPath $InstallerRoot -Directory -Force | Where-Object Name -like 'InventoryProject-*')) {
        if (-not $Directory.FullName.StartsWith($InstallerRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe cleanup target: $($Directory.FullName)" }
        Remove-Item -LiteralPath $Directory.FullName -Recurse -Force
        $Removed.Add($Directory.FullName)
    }

    $SuccessfulHashes = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $Ledger = Join-Path $InstallRoot 'Logs\Releases\release-ledger.jsonl'
    if (Test-Path -LiteralPath $Ledger -PathType Leaf) {
        foreach ($Line in Get-Content -LiteralPath $Ledger) {
            try {
                $Record = $Line | ConvertFrom-Json
                if ($Record.result -eq 'SUCCESS' -and $Record.packageHash) { [void]$SuccessfulHashes.Add([string]$Record.packageHash) }
            } catch { }
        }
    }
    foreach ($Archive in @(Get-ChildItem -LiteralPath $InstallerRoot -File -Filter 'InventoryProject-*.zip' -Force)) {
        $Hash = (Get-FileHash -LiteralPath $Archive.FullName -Algorithm SHA256).Hash
        if ($SuccessfulHashes.Contains($Hash)) {
            Remove-Item -LiteralPath $Archive.FullName -Force
            $Removed.Add($Archive.FullName)
        }
    }
}

$UpdateTemp = Join-Path $InstallRoot 'Temp\Updates'
if (Test-Path -LiteralPath $UpdateTemp -PathType Container) {
    $Cutoff = (Get-Date).AddHours(-1 * [Math]::Abs($AbandonedAfterHours))
    foreach ($Directory in @(Get-ChildItem -LiteralPath $UpdateTemp -Directory -Force | Where-Object LastWriteTime -lt $Cutoff)) {
        if (-not $Directory.FullName.StartsWith([IO.Path]::GetFullPath($UpdateTemp).TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe cleanup target: $($Directory.FullName)" }
        Remove-Item -LiteralPath $Directory.FullName -Recurse -Force
        $Removed.Add($Directory.FullName)
    }
}

Write-Host "PASS: Inventory update cleanup completed. Removed $($Removed.Count) item(s)." -ForegroundColor Green
$Removed | ForEach-Object { Write-Host $_ }
