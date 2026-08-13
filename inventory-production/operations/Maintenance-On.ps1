param(
    [string]$Root,
    [Parameter(Mandatory)][ValidateLength(3,512)][string]$Reason,
    [switch]$Confirmed
)
. (Join-Path $PSScriptRoot 'Support.Common.ps1')
$Root = Get-InventoryRoot $Root
Assert-InventoryAdministrator
Confirm-InventoryAction 'Enable Inventory maintenance mode?' 'MAINTENANCE' -Confirmed:$Confirmed
$Flag = Join-Path $Root 'Application\web\maintenance.flag'
@{
    enabled = $true
    enabledAt = (Get-Date).ToUniversalTime().ToString('o')
    enabledBy = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    reason = $Reason.Trim()
    source = 'operations'
} | ConvertTo-Json | Set-Content -LiteralPath $Flag -Encoding UTF8
Write-InventoryOperation $Root 'MAINTENANCE_ON' 'SUCCESS' "IIS now serves the maintenance page. Reason: $($Reason.Trim())"
Write-Host 'Maintenance mode is active.' -ForegroundColor Yellow
