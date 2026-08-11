[CmdletBinding()]
param(
    [string]$Root,
    [string]$PostgreSqlAdminUser = 'postgres',
    [Security.SecureString]$PostgreSqlAdminPassword,
    [switch]$Confirmed
)

. (Join-Path $PSScriptRoot 'Support.Common.ps1')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function ConvertFrom-SecureValue([Security.SecureString]$Value) {
    $Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer) }
}

function Invoke-DatabaseCommand {
    param(
        [Parameter(Mandatory)][string]$Executable,
        [Parameter(Mandatory)][string]$Password,
        [Parameter(Mandatory)][string]$Database,
        [Parameter(Mandatory)][string[]]$Arguments
    )

    try {
        $env:PGPASSWORD = $Password
        $env:PGCONNECT_TIMEOUT = '10'
        $Output = & $Executable -h 127.0.0.1 -p 5432 -U $PostgreSqlAdminUser -d $Database -w -X -v ON_ERROR_STOP=1 @Arguments 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw (($Output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine)
        }
        return $Output
    } finally {
        Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
        Remove-Item Env:\PGCONNECT_TIMEOUT -ErrorAction SilentlyContinue
    }
}

$Root = Get-InventoryRoot $Root
Assert-InventoryAdministrator
Confirm-InventoryAction 'Apply pending Inventory database migrations?' 'MIGRATE' -Confirmed:$Confirmed

$Config = Get-InventoryDeployment $Root
$Psql = [string]$Config.PostgreSqlPsql
$DatabaseName = [string]$Config.DatabaseName
if (-not (Test-Path -LiteralPath $Psql -PathType Leaf)) { throw "psql.exe not found: $Psql" }
if ([string]::IsNullOrWhiteSpace($DatabaseName)) { throw 'DatabaseName is missing from deployment.json.' }

$Migrations = @(Get-ChildItem (Join-Path $Root 'Database\Migrations') -Filter '*.sql' -File -ErrorAction SilentlyContinue | Sort-Object Name)
if (-not $Migrations) {
    Write-Host 'No packaged migrations were found.'
    return
}

if (-not $PostgreSqlAdminPassword) {
    $PostgreSqlAdminPassword = Read-Host "PostgreSQL password for $PostgreSqlAdminUser" -AsSecureString
}
$AdminPassword = ConvertFrom-SecureValue $PostgreSqlAdminPassword
$Applied = [Collections.Generic.List[string]]::new()
$Skipped = [Collections.Generic.List[string]]::new()

try {
    $LedgerTable = (Invoke-DatabaseCommand -Executable $Psql -Password $AdminPassword -Database $DatabaseName -Arguments @(
        '-tAc', "SELECT CASE WHEN to_regclass('invmgmt.schema_migrations') IS NOT NULL THEN 'invmgmt.schema_migrations' WHEN to_regclass('public.schema_migrations') IS NOT NULL THEN 'public.schema_migrations' ELSE '' END;"
    ) | Out-String).Trim()
    if (-not $LedgerTable) { throw 'Inventory migration ledger was not found.' }

    foreach ($Migration in $Migrations) {
        $MigrationId = [IO.Path]::GetFileNameWithoutExtension($Migration.Name)
        $EscapedId = $MigrationId.Replace("'", "''")
        $Exists = (Invoke-DatabaseCommand -Executable $Psql -Password $AdminPassword -Database $DatabaseName -Arguments @(
            '-tAc', "SELECT 1 FROM $LedgerTable WHERE migration_key='$EscapedId';"
        ) | Out-String).Trim()

        if ($Exists -eq '1') {
            $Skipped.Add($MigrationId)
            Write-Host "SKIP: $MigrationId is already applied."
            continue
        }

        Write-Host "APPLY: $MigrationId" -ForegroundColor Cyan
        $MigrationArguments = if ($LedgerTable -eq 'invmgmt.schema_migrations') {
            @('-c', 'SET ROLE inventory_owner; SET search_path=invmgmt,public;', '-f', $Migration.FullName)
        } else {
            @('-f', $Migration.FullName)
        }
        [void](Invoke-DatabaseCommand -Executable $Psql -Password $AdminPassword -Database $DatabaseName -Arguments $MigrationArguments)
        $Applied.Add($MigrationId)

        if ($MigrationId -eq '006-invmgmt-schema') {
            $LedgerTable = 'invmgmt.schema_migrations'
        }
    }

    $Detail = "Applied=$($Applied.Count); Skipped=$($Skipped.Count); Migrations=$($Applied -join ',')"
    Write-InventoryOperation $Root 'MIGRATE' 'SUCCESS' $Detail
    Write-Host "PASS: $($Applied.Count) migration(s) applied; $($Skipped.Count) already present." -ForegroundColor Green
} catch {
    Write-InventoryOperation $Root 'MIGRATE' 'FAILED' $_.Exception.Message
    throw
} finally {
    $AdminPassword = $null
}
