param([string]$Root, [switch]$Confirmed)
. (Join-Path $PSScriptRoot 'Support.Common.ps1')
$Root = Get-InventoryRoot $Root
Assert-InventoryAdministrator
Confirm-InventoryAction 'Apply pending Inventory database migrations?' 'MIGRATE' -Confirmed:$Confirmed
$Config = Get-InventoryDeployment $Root
$EnvironmentFile = Join-Path $Root 'Config\inventory.env'
$DatabaseUrlLine = Get-Content -LiteralPath $EnvironmentFile | Where-Object { $_ -like 'DATABASE_URL=*' } | Select-Object -First 1
if (-not $DatabaseUrlLine) { throw 'DATABASE_URL is missing from inventory.env.' }
$DatabaseUrl = $DatabaseUrlLine.Substring('DATABASE_URL='.Length)
$Psql = [string]$Config.PostgreSqlPsql
if (-not (Test-Path -LiteralPath $Psql)) { throw "psql.exe not found: $Psql" }
$Migrations = @(Get-ChildItem (Join-Path $Root 'Database\Migrations') -Filter '*.sql' -File -ErrorAction SilentlyContinue | Sort-Object Name)
if (-not $Migrations) { Write-Host 'No pending migration files were packaged.'; return }
try {
    foreach ($Migration in $Migrations) {
        & $Psql $DatabaseUrl -X -v ON_ERROR_STOP=1 -f $Migration.FullName
        if ($LASTEXITCODE -ne 0) { throw "Migration failed: $($Migration.Name)" }
    }
    Write-InventoryOperation $Root 'MIGRATE' 'SUCCESS' "$($Migrations.Count) packaged migrations applied."
} catch {
    Write-InventoryOperation $Root 'MIGRATE' 'FAILED' $_.Exception.Message
    throw
}
