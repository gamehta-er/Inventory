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
$MaintenanceFlag = Join-Path $Root 'Application\web\maintenance.flag'
$Maintenance = if (Test-Path -LiteralPath $MaintenanceFlag -PathType Leaf) {
    try {
        $State = Get-Content -LiteralPath $MaintenanceFlag -Raw | ConvertFrom-Json
        [pscustomobject]@{ State='ACTIVE'; EnabledBy=[string]$State.enabledBy; Reason=[string]$State.reason }
    } catch {
        [pscustomobject]@{ State='ACTIVE'; EnabledBy='Operations'; Reason='Legacy maintenance flag' }
    }
} else {
    [pscustomobject]@{ State='OFF'; EnabledBy=''; Reason='Normal application access' }
}
Write-Host 'Inventory services' -ForegroundColor Cyan
$Services | Format-Table -AutoSize
Write-Host 'Maintenance mode' -ForegroundColor Cyan
$Maintenance | Format-Table -AutoSize
Write-Host 'Inventory health' -ForegroundColor Cyan
$Checks | Format-Table -AutoSize
if ($Checks.Passed -contains $false) { exit 1 }
