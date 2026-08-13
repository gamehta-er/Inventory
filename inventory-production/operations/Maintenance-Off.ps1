param(
    [string]$Root,
    [Parameter(Mandatory)][ValidateLength(3,512)][string]$Reason,
    [switch]$Confirmed
)
. (Join-Path $PSScriptRoot 'Support.Common.ps1')
$Root = Get-InventoryRoot $Root
Assert-InventoryAdministrator
Confirm-InventoryAction 'Disable Inventory maintenance mode?' 'RESUME' -Confirmed:$Confirmed
$Flag = Join-Path $Root 'Application\web\maintenance.flag'
Remove-Item -LiteralPath $Flag -Force -ErrorAction SilentlyContinue
Write-InventoryOperation $Root 'MAINTENANCE_OFF' 'SUCCESS' "Normal application routing restored. Reason: $($Reason.Trim())"
Write-Host 'Maintenance mode is disabled.' -ForegroundColor Green
