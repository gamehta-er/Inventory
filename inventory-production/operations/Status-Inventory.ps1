param([string]$Root)
. (Join-Path $PSScriptRoot 'Support.Common.ps1')
$Root = Get-InventoryRoot $Root
$Config = Get-InventoryDeployment $Root
$Services = @(
    Get-Service -Name ([string]$Config.PostgreSqlServiceName) -ErrorAction SilentlyContinue
    Get-Service -Name ([string]$Config.ApiServiceName) -ErrorAction SilentlyContinue
) | Where-Object { $_ } | Select-Object Name,Status,StartType
$Checks = @(
    Invoke-InventoryHttpCheck 'API liveness' 'http://127.0.0.1:3020/api/v1/health/live'
    Invoke-InventoryHttpCheck 'API readiness' 'http://127.0.0.1:3020/api/v1/health/ready'
    Invoke-InventoryHttpCheck 'IIS application' 'http://127.0.0.1/'
)
Write-Host 'Inventory services' -ForegroundColor Cyan
$Services | Format-Table -AutoSize
Write-Host 'Inventory health' -ForegroundColor Cyan
$Checks | Format-Table -AutoSize
if ($Checks.Passed -contains $false) { exit 1 }
