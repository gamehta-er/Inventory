[CmdletBinding()]
param(
    [string]$Root,
    [string]$PostgreSqlAdminUser = 'postgres',
    [Security.SecureString]$PostgreSqlAdminPassword
)

. (Join-Path $PSScriptRoot 'Support.Common.ps1')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function ConvertFrom-SecureValue([Security.SecureString]$Value) {
    $Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer) }
}

$Root = Get-InventoryRoot $Root
$Config = Get-InventoryDeployment $Root
$Psql = [string]$Config.PostgreSqlPsql
$DatabaseName = [string]$Config.DatabaseName
$ContractFile = Join-Path $Root 'Database\Test-DatabaseContract.sql'

if (-not (Test-Path -LiteralPath $Psql -PathType Leaf)) { throw "psql.exe not found: $Psql" }
if (-not (Test-Path -LiteralPath $ContractFile -PathType Leaf)) { throw "Database contract test not found: $ContractFile" }
if (-not $PostgreSqlAdminPassword) {
    $PostgreSqlAdminPassword = Read-Host "PostgreSQL password for $PostgreSqlAdminUser" -AsSecureString
}

$Password = ConvertFrom-SecureValue $PostgreSqlAdminPassword
try {
    $env:PGPASSWORD = $Password
    $env:PGCONNECT_TIMEOUT = '10'
    & $Psql -h 127.0.0.1 -p 5432 -U $PostgreSqlAdminUser -d $DatabaseName -w -X -v ON_ERROR_STOP=1 -f $ContractFile
    if ($LASTEXITCODE -ne 0) { throw 'Framework v1.0 database contract failed.' }
    Write-InventoryOperation $Root 'DATABASE_CONTRACT' 'SUCCESS' 'Framework v1.0 database contract passed.'
    Write-Host 'PASS: Framework v1.0 database contract passed.' -ForegroundColor Green
} catch {
    Write-InventoryOperation $Root 'DATABASE_CONTRACT' 'FAILED' $_.Exception.Message
    throw
} finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:\PGCONNECT_TIMEOUT -ErrorAction SilentlyContinue
    $Password = $null
}
