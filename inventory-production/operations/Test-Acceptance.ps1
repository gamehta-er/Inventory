param([string]$Root)
. (Join-Path $PSScriptRoot 'Support.Common.ps1')
$Root = Get-InventoryRoot $Root
$Config = Get-InventoryDeployment $Root
$ExpectedVersion = [string]$Config.Version
$Results = @(
    Invoke-InventoryHttpCheck 'API liveness' 'http://127.0.0.1:3020/api/v1/health/live'
    Invoke-InventoryHttpCheck 'API readiness' 'http://127.0.0.1:3020/api/v1/health/ready'
    Invoke-InventoryHttpCheck 'Public application' 'http://127.0.0.1/'
    Invoke-InventoryHttpCheck 'Public user directory' 'http://127.0.0.1/api/v1/auth/users'
    Invoke-InventoryHttpCheck 'Anonymous protected boundary' 'http://127.0.0.1/api/v1/session' @(401)
    Invoke-InventoryHttpCheck 'Version contract' 'http://127.0.0.1/api/v1/version'
    Invoke-InventoryHttpCheck 'Web version contract' 'http://127.0.0.1/version.json'
    Invoke-InventoryHttpCheck 'Inventory route' 'http://127.0.0.1/inventory'
    Invoke-InventoryHttpCheck 'Import route' 'http://127.0.0.1/import'
    Invoke-InventoryHttpCheck 'Reports route' 'http://127.0.0.1/reports'
    Invoke-InventoryHttpCheck 'Activity route' 'http://127.0.0.1/activity'
    Invoke-InventoryHttpCheck 'Admin route' 'http://127.0.0.1/admin'
)
$Results | Format-Table -AutoSize
if ($Results.Passed -contains $false) { Write-InventoryOperation $Root 'ACCEPTANCE' 'FAILED' 'One or more HTTP checks failed.'; exit 1 }
$ApiVersion = (Invoke-WebRequest 'http://127.0.0.1/api/v1/version' -UseBasicParsing -Headers @{ 'Cache-Control'='no-cache' }).Content | ConvertFrom-Json
$WebVersion = (Invoke-WebRequest 'http://127.0.0.1/version.json' -UseBasicParsing -Headers @{ 'Cache-Control'='no-cache' }).Content | ConvertFrom-Json
if ([string]$ApiVersion.packageVersion -cne $ExpectedVersion -or [string]$ApiVersion.apiVersion -cne $ExpectedVersion -or [string]$ApiVersion.webVersion -cne $ExpectedVersion) {
    throw "API component versions do not match installed version $ExpectedVersion."
}
if ([string]$WebVersion.packageVersion -cne $ExpectedVersion -or [string]$WebVersion.webVersion -cne $ExpectedVersion) {
    throw "Published web version does not match installed version $ExpectedVersion."
}
if (-not [bool]$ApiVersion.compatible) { throw 'API reports an incompatible database or import contract.' }
Write-InventoryOperation $Root 'ACCEPTANCE' 'SUCCESS' 'Runtime, routing, readiness, public login, and authentication boundary passed.'
Write-Host "Acceptance checks passed. Public URL: $($Config.PublicUrl)" -ForegroundColor Green
