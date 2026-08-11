param([string]$Root, [switch]$Confirmed)
. (Join-Path $PSScriptRoot 'Support.Common.ps1')
$Root = Get-InventoryRoot $Root
Assert-InventoryAdministrator
Confirm-InventoryAction 'Enable Inventory maintenance mode?' 'MAINTENANCE' -Confirmed:$Confirmed
$Flag = Join-Path $Root 'Application\web\maintenance.flag'
New-Item -ItemType File -Force -Path $Flag | Out-Null
Write-InventoryOperation $Root 'MAINTENANCE_ON' 'SUCCESS' 'IIS now serves the maintenance page.'
Write-Host 'Maintenance mode is active.' -ForegroundColor Yellow
