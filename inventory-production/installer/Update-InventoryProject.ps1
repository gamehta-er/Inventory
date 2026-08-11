[CmdletBinding()]
param(
    [string]$PackageRoot = $PSScriptRoot,
    [string]$InstallRoot = 'D:\Inventory Project',
    [string]$PostgreSqlBin = 'C:\Program Files\PostgreSQL\18\bin',
    [string]$PostgreSqlAdminUser = 'postgres',
    [string]$DatabaseName = 'inventory_project',
    [string]$SiteName = 'Inventory Project',
    [string]$ApiServiceName = 'InventoryProjectApi',
    [Security.SecureString]$PostgreSqlAdminPassword,
    [switch]$Confirmed
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-Administrator {
    $Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $Principal = [Security.Principal.WindowsPrincipal]::new($Identity)
    if (-not $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run the updater from an elevated PowerShell window.'
    }
}

function ConvertFrom-SecureValue([Security.SecureString]$Value) {
    $Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer) }
}

function Sync-Directory([string]$Source, [string]$Destination) {
    if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
        throw "Update payload directory not found: $Source"
    }
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    & robocopy.exe $Source $Destination /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Application file update failed for: $Destination" }
}

Assert-Administrator

if (-not $Confirmed) {
    $Answer = Read-Host "Update the live Inventory Project application and database contract? Type UPDATE INVENTORY PROJECT"
    if ($Answer -cne 'UPDATE INVENTORY PROJECT') { throw 'No update changes were made.' }
}

$Verifier = Join-Path $PackageRoot 'Test-Production-Package.ps1'
$PayloadRoot = Join-Path $PackageRoot 'Payload'
$Psql = Join-Path $PostgreSqlBin 'psql.exe'
$EnvironmentFile = Join-Path $InstallRoot 'Config\inventory.env'
$DeploymentFile = Join-Path $InstallRoot 'Config\deployment.json'
$LogRoot = Join-Path $InstallRoot 'Logs\Updates'
$MigrationRoot = Join-Path $PayloadRoot 'Database\Migrations'

foreach ($RequiredFile in @($Verifier, $Psql, $EnvironmentFile, $DeploymentFile)) {
    if (-not (Test-Path -LiteralPath $RequiredFile -PathType Leaf)) { throw "Required file not found: $RequiredFile" }
}
if (-not (Get-Service -Name $ApiServiceName -ErrorAction SilentlyContinue)) { throw "API service not found: $ApiServiceName" }

Import-Module WebAdministration
if (-not (Test-Path "IIS:\Sites\$SiteName")) { throw "IIS site not found: $SiteName" }

& $Verifier -PackageRoot $PackageRoot
New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null
$Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Write-Host 'PASS: Package verified. Preparing the database update.' -ForegroundColor Green
if (-not $PostgreSqlAdminPassword) {
    Write-Host 'Enter the PostgreSQL administrator password in this PowerShell window.' -ForegroundColor Cyan
    $PostgreSqlAdminPassword = Read-Host "PostgreSQL password for $PostgreSqlAdminUser" -AsSecureString
}
$AdminPassword = ConvertFrom-SecureValue $PostgreSqlAdminPassword
$ServiceStopped = $false
$SiteStopped = $false

try {
    Stop-Website -Name $SiteName
    $SiteStopped = $true
    Stop-Service -Name $ApiServiceName -Force
    $ServiceStopped = $true

    $Migrations = @(Get-ChildItem -LiteralPath $MigrationRoot -Filter '*.sql' -File | Sort-Object Name)
    foreach ($Migration in $Migrations) {
        Write-Host "Applying database migration: $($Migration.Name)" -ForegroundColor Cyan
        $BaseName = [IO.Path]::GetFileNameWithoutExtension($Migration.Name)
        $StandardLog = Join-Path $LogRoot "$Timestamp-$BaseName.out.log"
        $ErrorLog = Join-Path $LogRoot "$Timestamp-$BaseName.err.log"
        try {
            $env:PGPASSWORD = $AdminPassword
            $env:PGCONNECT_TIMEOUT = '10'
            $Arguments = @(
                '-h', '127.0.0.1', '-p', '5432',
                '-U', $PostgreSqlAdminUser, '-d', $DatabaseName,
                '-w', '-X', '-v', 'ON_ERROR_STOP=1',
                '-f', ('"{0}"' -f $Migration.FullName)
            )
            $Process = Start-Process -FilePath $Psql -ArgumentList $Arguments -Wait -PassThru -NoNewWindow `
                -RedirectStandardOutput $StandardLog -RedirectStandardError $ErrorLog
            if ($Process.ExitCode -ne 0) {
                $Details = if (Test-Path $ErrorLog) { (Get-Content -LiteralPath $ErrorLog -Raw).Trim() } else { '' }
                throw "Database migration failed: $($Migration.Name). $Details"
            }
        }
        finally {
            Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
            Remove-Item Env:\PGCONNECT_TIMEOUT -ErrorAction SilentlyContinue
        }
    }

    Sync-Directory (Join-Path $PayloadRoot 'Application\api') (Join-Path $InstallRoot 'Application\api')
    Write-Host 'Publishing the API and web application.' -ForegroundColor Cyan
    Sync-Directory (Join-Path $PayloadRoot 'Application\web') (Join-Path $InstallRoot 'Application\web')
    Sync-Directory $MigrationRoot (Join-Path $InstallRoot 'Database\Migrations')

    $Manifest = Get-Content -LiteralPath (Join-Path $PackageRoot 'release-manifest.json') -Raw | ConvertFrom-Json
    $Deployment = Get-Content -LiteralPath $DeploymentFile -Raw | ConvertFrom-Json
    $Deployment.Version = [string]$Manifest.version
    $Deployment | Add-Member -NotePropertyName UpdatedAt -NotePropertyValue (Get-Date).ToString('o') -Force
    $Deployment | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $DeploymentFile -Encoding UTF8

    Start-Service -Name $ApiServiceName
    $ServiceStopped = $false
    Start-Website -Name $SiteName
    $SiteStopped = $false
    Start-Sleep -Seconds 5

    $Direct = Invoke-WebRequest 'http://127.0.0.1:3020/api/v1/health/ready' -UseBasicParsing -TimeoutSec 15
    $Public = Invoke-WebRequest 'http://127.0.0.1/api/v1/health/ready' -UseBasicParsing -TimeoutSec 15
    if ($Direct.StatusCode -ne 200 -or $Public.StatusCode -ne 200) { throw 'Post-update health verification failed.' }

    Write-Host "PASS: Inventory Project $($Manifest.version) is operational." -ForegroundColor Green
    Write-Host "Open: http://10.176.177.149/" -ForegroundColor Cyan
    Write-Host "Update logs: $LogRoot" -ForegroundColor Cyan
}
catch {
    if ($ServiceStopped) { Start-Service -Name $ApiServiceName -ErrorAction SilentlyContinue }
    if ($SiteStopped) { Start-Website -Name $SiteName -ErrorAction SilentlyContinue }
    throw
}
finally {
    $AdminPassword = $null
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:\PGCONNECT_TIMEOUT -ErrorAction SilentlyContinue
}
