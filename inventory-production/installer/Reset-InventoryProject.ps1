[CmdletBinding()]
param(
    [string]$InstallRoot = 'D:\Inventory Project',
    [string]$PostgreSqlBin,
    [string]$PostgreSqlAdminUser = 'postgres',
    [string]$DatabaseName = 'inventory_project',
    [string]$ApplicationRole = 'inventory_app',
    [string]$SiteName = 'Inventory Project',
    [string]$ApiServiceName = 'InventoryProjectApi',
    [switch]$Confirmed
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$Principal = [Security.Principal.WindowsPrincipal]::new($Identity)
if (-not $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run from elevated PowerShell.' }
if (-not $Confirmed) {
    $Answer = Read-Host "Permanently delete Inventory Project files and PostgreSQL data? Type RESET INVENTORY PROJECT"
    if ($Answer -cne 'RESET INVENTORY PROJECT') { throw 'No reset changes were made.' }
}

Import-Module WebAdministration -ErrorAction SilentlyContinue
if (Test-Path "IIS:\Sites\$SiteName") { Remove-Website -Name $SiteName }
if (Test-Path 'IIS:\AppPools\InventoryProjectAppPool') { Remove-WebAppPool -Name 'InventoryProjectAppPool' }
Get-NetFirewallRule -DisplayName 'Inventory Project HTTP' -ErrorAction SilentlyContinue | Remove-NetFirewallRule

$ServiceExecutable = Join-Path $InstallRoot 'Runtime\InventoryApiService.exe'
if (Get-Service -Name $ApiServiceName -ErrorAction SilentlyContinue) {
    if (Test-Path $ServiceExecutable) { & $ServiceExecutable stop; & $ServiceExecutable uninstall }
    else { Stop-Service $ApiServiceName -Force -ErrorAction SilentlyContinue; sc.exe delete $ApiServiceName | Out-Null }
}

Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*$InstallRoot*" -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

if (-not $PostgreSqlBin) {
    $Candidates = @(Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue | Sort-Object { [version]$_.Name } -Descending | ForEach-Object { Join-Path $_.FullName 'bin' } | Where-Object { Test-Path (Join-Path $_ 'psql.exe') })
    if ($Candidates.Count -ne 1) { throw 'Supply -PostgreSqlBin to reset PostgreSQL safely.' }
    $PostgreSqlBin = $Candidates[0]
}
$PasswordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR((Read-Host 'PostgreSQL postgres password' -AsSecureString))
try {
    $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($PasswordPointer)
    $Psql = Join-Path $PostgreSqlBin 'psql.exe'
    & $Psql -h 127.0.0.1 -p 5432 -U $PostgreSqlAdminUser -d postgres -w -X -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DatabaseName' AND pid <> pg_backend_pid();"
    & $Psql -h 127.0.0.1 -p 5432 -U $PostgreSqlAdminUser -d postgres -w -X -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $DatabaseName;"
    & $Psql -h 127.0.0.1 -p 5432 -U $PostgreSqlAdminUser -d postgres -w -X -v ON_ERROR_STOP=1 -c "DROP ROLE IF EXISTS $ApplicationRole;"
} finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($PasswordPointer)
}
if (Test-Path -LiteralPath $InstallRoot) { Remove-Item -LiteralPath $InstallRoot -Recurse -Force }
Write-Host 'Inventory Project application and database were removed. Windows, IIS, and PostgreSQL remain installed.' -ForegroundColor Green
