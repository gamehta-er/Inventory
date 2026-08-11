param([string]$Root, [switch]$Confirmed)
. (Join-Path $PSScriptRoot 'Support.Common.ps1')
$Root = Get-InventoryRoot $Root
Assert-InventoryAdministrator
Confirm-InventoryAction 'Gracefully stop Inventory Project?' 'STOP' -Confirmed:$Confirmed
$Config = Get-InventoryDeployment $Root
try {
    Import-Module WebAdministration
    if ((Get-WebsiteState -Name ([string]$Config.IisSiteName)).Value -ne 'Stopped') { Stop-Website -Name ([string]$Config.IisSiteName) }
    $Api = Get-Service -Name ([string]$Config.ApiServiceName) -ErrorAction Stop
    if ($Api.Status -ne 'Stopped') {
        Stop-Service -Name $Api.Name
        $Api.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(45))
    }
    Write-InventoryOperation $Root 'STOP' 'SUCCESS' 'IIS stopped accepting traffic and the API completed graceful shutdown. PostgreSQL remains running.'
    & (Join-Path $Root 'Scripts\Status-Inventory.ps1') -Root $Root
} catch {
    Write-InventoryOperation $Root 'STOP' 'FAILED' $_.Exception.Message
    throw
}
