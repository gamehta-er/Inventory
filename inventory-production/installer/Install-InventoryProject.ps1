[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$PublicHost,
    [string]$InstallRoot = 'D:\Inventory Project',
    [string]$PostgreSqlBin,
    [string]$PostgreSqlServiceName,
    [string]$PostgreSqlAdminUser = 'postgres',
    [string]$DatabaseName = 'inventory_project',
    [string]$ApplicationRole = 'inventory_app',
    [string]$SiteName = 'Inventory Project',
    [string]$ApiServiceName = 'InventoryProjectApi',
    [switch]$ReplaceDefaultWebsite,
    [switch]$Confirmed
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$PackageRoot = $PSScriptRoot
$PayloadRoot = Join-Path $PackageRoot 'Payload'

function Assert-Administrator {
    $Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $Principal = [Security.Principal.WindowsPrincipal]::new($Identity)
    if (-not $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run the installer from an elevated PowerShell window.'
    }
}

function ConvertFrom-SecureValue([Security.SecureString]$Value) {
    $Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer) }
}

function New-UrlSafeSecret([int]$Bytes = 48) {
    $Buffer = New-Object byte[] $Bytes
    $Generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $Generator.GetBytes($Buffer) }
    finally { $Generator.Dispose() }
    return [Convert]::ToBase64String($Buffer).TrimEnd('=').Replace('+','A').Replace('/','B')
}

function Invoke-Psql {
    param([string]$Executable,[string]$Password,[string]$User,[string]$Database,[string[]]$Arguments)
    try {
        $env:PGPASSWORD = $Password
        $env:PGCONNECT_TIMEOUT = '10'
        & $Executable -h 127.0.0.1 -p 5432 -U $User -d $Database -w -X -v ON_ERROR_STOP=1 @Arguments
        if ($LASTEXITCODE -ne 0) { throw "PostgreSQL command failed with exit code $LASTEXITCODE." }
    } finally {
        Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
        Remove-Item Env:\PGCONNECT_TIMEOUT -ErrorAction SilentlyContinue
    }
}

Assert-Administrator
if (-not $Confirmed) {
    $Answer = Read-Host "Install fresh Inventory Project at '$InstallRoot'? Type INSTALL INVENTORY PROJECT"
    if ($Answer -cne 'INSTALL INVENTORY PROJECT') { throw 'No installation changes were made.' }
}
$Verifier = Join-Path $PackageRoot 'Test-Production-Package.ps1'
if (-not (Test-Path -LiteralPath $Verifier -PathType Leaf)) { throw "Package verifier not found: $Verifier" }
& $Verifier -PackageRoot $PackageRoot
$ReleaseManifest = Get-Content -LiteralPath (Join-Path $PackageRoot 'release-manifest.json') -Raw | ConvertFrom-Json
if ($ReleaseManifest.packageType -and $ReleaseManifest.packageType -ne 'baseline') { throw 'Fresh installation requires a baseline package.' }
if (-not (Test-Path -LiteralPath $PayloadRoot -PathType Container)) { throw "Package payload not found: $PayloadRoot" }
if (Test-Path -LiteralPath $InstallRoot) { throw "Install root already exists. Run Reset-InventoryProject.ps1 first: $InstallRoot" }

if (-not $PostgreSqlBin) {
    $Candidates = @(Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue | Sort-Object { [version]$_.Name } -Descending | ForEach-Object { Join-Path $_.FullName 'bin' } | Where-Object { Test-Path (Join-Path $_ 'psql.exe') })
    if ($Candidates.Count -ne 1) { throw 'PostgreSQL bin directory could not be selected unambiguously. Supply -PostgreSqlBin.' }
    $PostgreSqlBin = $Candidates[0]
}
$Psql = Join-Path $PostgreSqlBin 'psql.exe'
if (-not (Test-Path -LiteralPath $Psql -PathType Leaf)) { throw "psql.exe not found: $Psql" }

if (-not $PostgreSqlServiceName) {
    $Services = @(Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue)
    if ($Services.Count -ne 1) { throw 'PostgreSQL service could not be selected unambiguously. Supply -PostgreSqlServiceName.' }
    $PostgreSqlServiceName = $Services[0].Name
}
$PostgreSqlService = Get-Service -Name $PostgreSqlServiceName -ErrorAction Stop
if ($PostgreSqlService.Status -ne 'Running') { Start-Service -Name $PostgreSqlServiceName }

Import-Module WebAdministration
$Rewrite = Get-WebGlobalModule | Where-Object Name -eq 'RewriteModule'
if (-not $Rewrite) { throw 'IIS URL Rewrite 2.0 is required before installation.' }
try { Get-WebConfiguration -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -ErrorAction Stop | Out-Null }
catch { throw 'IIS Application Request Routing is required before installation.' }

$AdminPassword = ConvertFrom-SecureValue (Read-Host 'PostgreSQL postgres password' -AsSecureString)
$ApplicationPassword = New-UrlSafeSecret
$CookieSecret = New-UrlSafeSecret 64
$SqlApplicationPassword = $ApplicationPassword.Replace("'", "''")

$DatabaseExists = (Invoke-Psql $Psql $AdminPassword $PostgreSqlAdminUser 'postgres' @('-tAc', "SELECT 1 FROM pg_database WHERE datname='$DatabaseName';") | Out-String).Trim()
$RoleExists = (Invoke-Psql $Psql $AdminPassword $PostgreSqlAdminUser 'postgres' @('-tAc', "SELECT 1 FROM pg_roles WHERE rolname='$ApplicationRole';") | Out-String).Trim()
if ($DatabaseExists -eq '1' -or $RoleExists -eq '1') { throw 'Fresh database or application role already exists. Run the reset command before installation.' }

try {
    Invoke-Psql $Psql $AdminPassword $PostgreSqlAdminUser 'postgres' @('-c', "CREATE ROLE $ApplicationRole LOGIN PASSWORD '$SqlApplicationPassword';")
    Invoke-Psql $Psql $AdminPassword $PostgreSqlAdminUser 'postgres' @('-c', "CREATE DATABASE $DatabaseName OWNER $ApplicationRole ENCODING 'UTF8' TEMPLATE template0;")

    New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
    Copy-Item -Path (Join-Path $PayloadRoot '*') -Destination $InstallRoot -Recurse -Force

    $Baseline = Join-Path $InstallRoot 'Database\001-production-baseline.sql'
    Invoke-Psql $Psql $ApplicationPassword $ApplicationRole $DatabaseName @('-f', $Baseline)

    $ConfigDirectory = Join-Path $InstallRoot 'Config'
    $LogDirectory = Join-Path $InstallRoot 'Logs\Service'
    $UploadDirectory = Join-Path $InstallRoot 'Uploads'
    New-Item -ItemType Directory -Force -Path $ConfigDirectory,$LogDirectory,$UploadDirectory | Out-Null
    $DatabaseUrl = "postgresql://${ApplicationRole}:$ApplicationPassword@127.0.0.1:5432/$DatabaseName"
    @(
        'NODE_ENV=production'
        'HOST=127.0.0.1'
        'PORT=3020'
        "DATABASE_URL=$DatabaseUrl"
        "COOKIE_SECRET=$CookieSecret"
        'COOKIE_SECURE=false'
        'SESSION_HOURS=8'
        "ALLOWED_ORIGIN=http://$PublicHost"
        "UPLOAD_ROOT=$UploadDirectory"
        'MAX_IMAGE_BYTES=5242880'
    ) | Set-Content -LiteralPath (Join-Path $ConfigDirectory 'inventory.env') -Encoding UTF8
    @{
        Product='Inventory Project'; Version=[string]$ReleaseManifest.version; UpdaterVersion=if ($ReleaseManifest.updaterVersion) { [string]$ReleaseManifest.updaterVersion } else { '1.0.0' }; PublicUrl="http://$PublicHost/"; ApiServiceName=$ApiServiceName;
        IisSiteName=$SiteName; PostgreSqlServiceName=$PostgreSqlServiceName; PostgreSqlPsql=$Psql; DatabaseName=$DatabaseName; InstalledAt=(Get-Date).ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $ConfigDirectory 'deployment.json') -Encoding UTF8

    & icacls.exe (Join-Path $ConfigDirectory 'inventory.env') /inheritance:r /grant:r 'SYSTEM:(R)' 'BUILTIN\Administrators:(R)' | Out-Null

    $ServiceExecutable = Join-Path $InstallRoot 'Runtime\InventoryApiService.exe'
    $ServiceXml = Join-Path $InstallRoot 'Runtime\InventoryApiService.xml'
    $RunApi = Join-Path $InstallRoot 'Runtime\Run-Api.ps1'
    @"
<service>
  <id>$ApiServiceName</id>
  <name>Inventory Project API</name>
  <description>Fastify API for Inventory Project.</description>
  <executable>powershell.exe</executable>
  <arguments>-NoProfile -ExecutionPolicy Bypass -File &quot;$RunApi&quot;</arguments>
  <workingdirectory>$(Join-Path $InstallRoot 'Runtime')</workingdirectory>
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
  <depend>$PostgreSqlServiceName</depend>
  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="30 sec" />
  <resetfailure>1 hour</resetfailure>
  <stoptimeout>30 sec</stoptimeout>
  <logpath>$LogDirectory</logpath>
  <log mode="roll-by-size-time">
    <sizeThreshold>10485760</sizeThreshold>
    <pattern>yyyyMMdd</pattern>
    <autoRollAtTime>00:00:00</autoRollAtTime>
    <zipOlderThanNumDays>7</zipOlderThanNumDays>
    <keepFiles>14</keepFiles>
  </log>
</service>
"@ | Set-Content -LiteralPath $ServiceXml -Encoding UTF8
    & $ServiceExecutable install
    if ($LASTEXITCODE -ne 0) { throw 'API Windows service installation failed.' }

    $AppPoolName = 'InventoryProjectAppPool'
    if (-not (Test-Path "IIS:\AppPools\$AppPoolName")) { New-WebAppPool -Name $AppPoolName | Out-Null }
    Set-ItemProperty "IIS:\AppPools\$AppPoolName" -Name managedRuntimeVersion -Value ''
    Set-ItemProperty "IIS:\AppPools\$AppPoolName" -Name processModel.identityType -Value ApplicationPoolIdentity
    & icacls.exe (Join-Path $InstallRoot 'Application\web') /grant "IIS AppPool\${AppPoolName}:(OI)(CI)(RX)" /T /C | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'IIS application pool read permission could not be applied.' }

    $Port80Sites = @(Get-Website | Where-Object { $_.Bindings.Collection.bindingInformation -contains '*:80:' -or $_.Bindings.Collection.bindingInformation -match ':80:' })
    foreach ($Existing in $Port80Sites) {
        if ($Existing.Name -eq $SiteName) { continue }
        if ($Existing.Name -eq 'Default Web Site' -and $ReplaceDefaultWebsite) { Remove-Website -Name $Existing.Name; continue }
        throw "Port 80 is already assigned to IIS site '$($Existing.Name)'. Resolve it or explicitly use -ReplaceDefaultWebsite for the untouched default site."
    }
    if (Test-Path "IIS:\Sites\$SiteName") { throw "IIS site already exists: $SiteName" }
    New-Website -Name $SiteName -Port 80 -IPAddress '*' -PhysicalPath (Join-Path $InstallRoot 'Application\web') -ApplicationPool $AppPoolName | Out-Null
    Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name enabled -Value True

    $FirewallName = 'Inventory Project HTTP'
    if (-not (Get-NetFirewallRule -DisplayName $FirewallName -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $FirewallName -Direction Inbound -Action Allow -Protocol TCP -LocalPort 80 -Profile Domain | Out-Null
    }

    & $ServiceExecutable start
    Start-Website -Name $SiteName
    Start-Sleep -Seconds 5
    $Ready = Invoke-WebRequest 'http://127.0.0.1:3020/api/v1/health/ready' -UseBasicParsing -TimeoutSec 15
    $Public = Invoke-WebRequest 'http://127.0.0.1/' -UseBasicParsing -TimeoutSec 15
    if ($Ready.StatusCode -ne 200 -or $Public.StatusCode -ne 200) { throw 'Post-install health verification failed.' }
    Write-Host "Inventory Project installed: http://$PublicHost/" -ForegroundColor Green
    Write-Host "Configuration: $ConfigDirectory" -ForegroundColor Cyan
    Write-Host "Logs: $(Join-Path $InstallRoot 'Logs')" -ForegroundColor Cyan
} catch {
    Write-Error $_
    throw
} finally {
    $AdminPassword = $null
}
