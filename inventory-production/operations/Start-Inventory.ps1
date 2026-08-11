param([string]$Root, [switch]$Confirmed)
. (Join-Path $PSScriptRoot 'Support.Common.ps1')
$Root = Get-InventoryRoot $Root
Assert-InventoryAdministrator
Confirm-InventoryAction 'Start Inventory Project?' 'START' -Confirmed:$Confirmed
$Config = Get-InventoryDeployment $Root
try {
    $Postgres = Get-Service -Name ([string]$Config.PostgreSqlServiceName) -ErrorAction Stop
    if ($Postgres.Status -ne 'Running') { Start-Service -Name $Postgres.Name }
    $Api = Get-Service -Name ([string]$Config.ApiServiceName) -ErrorAction Stop
    if ($Api.Status -ne 'Running') { Start-Service -Name $Api.Name }
    Import-Module WebAdministration
    if ((Get-WebsiteState -Name ([string]$Config.IisSiteName)).Value -ne 'Started') { Start-Website -Name ([string]$Config.IisSiteName) }
    Write-InventoryOperation $Root 'START' 'SUCCESS' 'PostgreSQL, API, and IIS started in dependency order.'
    & (Join-Path $Root 'Scripts\Status-Inventory.ps1') -Root $Root
} catch {
    Write-InventoryOperation $Root 'START' 'FAILED' $_.Exception.Message
    throw
}
