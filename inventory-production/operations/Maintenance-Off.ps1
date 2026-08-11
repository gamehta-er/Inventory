param([string]$Root, [switch]$Confirmed)
. (Join-Path $PSScriptRoot 'Support.Common.ps1')
$Root = Get-InventoryRoot $Root
Assert-InventoryAdministrator
Confirm-InventoryAction 'Disable Inventory maintenance mode?' 'RESUME' -Confirmed:$Confirmed
$Flag = Join-Path $Root 'Application\web\maintenance.flag'
Remove-Item -LiteralPath $Flag -Force -ErrorAction SilentlyContinue
Write-InventoryOperation $Root 'MAINTENANCE_OFF' 'SUCCESS' 'Normal application routing restored.'
Write-Host 'Maintenance mode is disabled.' -ForegroundColor Green
