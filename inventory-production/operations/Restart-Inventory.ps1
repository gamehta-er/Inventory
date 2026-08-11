param([string]$Root, [switch]$Confirmed)
. (Join-Path $PSScriptRoot 'Support.Common.ps1')
$Root = Get-InventoryRoot $Root
Assert-InventoryAdministrator
Confirm-InventoryAction 'Restart Inventory Project?' 'RESTART' -Confirmed:$Confirmed
& (Join-Path $Root 'Scripts\Stop-Inventory.ps1') -Root $Root -Confirmed
& (Join-Path $Root 'Scripts\Start-Inventory.ps1') -Root $Root -Confirmed
