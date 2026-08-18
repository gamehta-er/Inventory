[CmdletBinding()]
param(
    [string]$Version = '1.4.1',
    [string]$OutputRoot,
    [Parameter(Mandatory)][string]$ReleaseEvidencePath
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ConformanceGate = Join-Path $PSScriptRoot 'Test-FrameworkConformance.ps1'
& $ConformanceGate -ReleaseGate -ExpectedProductVersion $Version -ReleaseEvidencePath $ReleaseEvidencePath
if (-not $?) { throw 'Framework release gate failed. No baseline package was created.' }
$ReleaseEvidencePath = (Resolve-Path -LiteralPath $ReleaseEvidencePath).Path
if (-not $OutputRoot) { $OutputRoot = Join-Path $ProjectRoot 'artifacts' }
New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
$OutputRoot = (Resolve-Path -LiteralPath $OutputRoot).Path
$Npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$Node = (Get-Command node.exe -ErrorAction Stop).Source
$PackageName = "InventoryProject-$Version"
$Staging = Join-Path $OutputRoot $PackageName
$Archive = Join-Path $OutputRoot "$PackageName.zip"

function Copy-DirectoryContents([string]$Source,[string]$Destination) {
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    Copy-Item -Path (Join-Path $Source '*') -Destination $Destination -Recurse -Force
}

function Invoke-Npm([string[]]$Arguments,[string]$WorkingDirectory) {
    Push-Location $WorkingDirectory
    try {
        & $Npm @Arguments
        if ($LASTEXITCODE -ne 0) { throw "npm failed: $($Arguments -join ' ')" }
    } finally { Pop-Location }
}

Write-Host 'Running source checks and production builds.' -ForegroundColor Cyan
Invoke-Npm @('run','check') $ProjectRoot
Invoke-Npm @('run','test') $ProjectRoot
Invoke-Npm @('run','build') $ProjectRoot

$BuiltWebVersionPath = Join-Path $ProjectRoot 'frontend\dist\version.json'
if (-not (Test-Path -LiteralPath $BuiltWebVersionPath -PathType Leaf)) {
    throw 'Frontend build did not produce version.json.'
}
$BuiltWebVersion = Get-Content -LiteralPath $BuiltWebVersionPath -Raw | ConvertFrom-Json
if ([string]$BuiltWebVersion.packageVersion -cne $Version -or [string]$BuiltWebVersion.webVersion -cne $Version) {
    throw "Frontend build version contract does not match package version $Version."
}

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
Remove-Item -LiteralPath $Staging -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $Archive -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Staging | Out-Null

$Payload = Join-Path $Staging 'Payload'
$Api = Join-Path $Payload 'Application\api'
$Web = Join-Path $Payload 'Application\web'
$Runtime = Join-Path $Payload 'Runtime'
$Operations = Join-Path $Payload 'Operations'
$Database = Join-Path $Payload 'Database'
$Config = Join-Path $Payload 'Config'
$Logs = Join-Path $Payload 'Logs'
$Uploads = Join-Path $Payload 'Uploads'
New-Item -ItemType Directory -Force -Path $Api,$Web,$Runtime,$Operations,$Database,$Config,$Logs,$Uploads | Out-Null

Copy-DirectoryContents (Join-Path $ProjectRoot 'backend\dist') (Join-Path $Api 'dist')
Copy-Item (Join-Path $ProjectRoot 'backend\package.json') (Join-Path $Api 'package.json')
$ApiPackagePath = Join-Path $Api 'package.json'
$ApiPackageDefinition = Get-Content -LiteralPath $ApiPackagePath -Raw | ConvertFrom-Json
$ApiPackageDefinition.PSObject.Properties.Remove('devDependencies')
$ApiPackageDefinition.scripts = @{ start = 'node dist/server.js' }
$ApiPackageDefinition | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $ApiPackagePath -Encoding UTF8
Invoke-Npm @('install','--omit=dev','--ignore-scripts','--no-audit','--no-fund') $Api

Copy-DirectoryContents (Join-Path $ProjectRoot 'frontend\dist') $Web
$PackagedWebVersion = Get-Content -LiteralPath (Join-Path $Web 'version.json') -Raw | ConvertFrom-Json
if ([string]$PackagedWebVersion.packageVersion -cne $Version -or [string]$PackagedWebVersion.webVersion -cne $Version) {
    throw "Packaged web version contract does not match package version $Version."
}
Copy-Item (Join-Path $ProjectRoot 'deployment\web.config') (Join-Path $Web 'web.config')
Copy-Item (Join-Path $ProjectRoot 'deployment\maintenance.html') (Join-Path $Web 'maintenance.html')
Copy-Item (Join-Path $ProjectRoot 'database\001-production-baseline.sql') $Database
Copy-Item (Join-Path $ProjectRoot 'database\Test-DatabaseContract.sql') $Database
$MigrationDestination = Join-Path $Database 'Migrations'
New-Item -ItemType Directory -Force -Path $MigrationDestination | Out-Null
$MigrationSources = @(
    Get-ChildItem (Join-Path $ProjectRoot 'database\Migrations') -Filter '*.sql' -File
    Get-Item (Join-Path $ProjectRoot 'database\005-complete-import-workflow.sql')
) | Sort-Object Name
$MigrationSources | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $MigrationDestination
}
Copy-Item $Node (Join-Path $Runtime 'node.exe')
Copy-Item (Join-Path $ProjectRoot 'deployment\InventoryApiService.exe') (Join-Path $Runtime 'InventoryApiService.exe')
Copy-Item (Join-Path $ProjectRoot 'deployment\Run-Api.ps1') (Join-Path $Runtime 'Run-Api.ps1')
Get-ChildItem (Join-Path $ProjectRoot 'operations') -File | Where-Object Name -notin @('Build-Production-Package.ps1','Build-Delta-Package.ps1','Build-Release-Tools-Package.ps1') | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $Operations
}
$ConformanceDestination = Join-Path $Operations 'Conformance'
New-Item -ItemType Directory -Force -Path $ConformanceDestination | Out-Null
Copy-Item -LiteralPath $ReleaseEvidencePath -Destination $ConformanceDestination -Force
Copy-Item (Join-Path $ProjectRoot 'docs\README.md') (Join-Path $Payload 'README.md')
Copy-Item (Join-Path $ProjectRoot 'docs\SUPPORT.md') (Join-Path $Payload 'SUPPORT.md')
Copy-Item (Join-Path $ProjectRoot 'docs\IMPORT-WORKFLOW.md') (Join-Path $Payload 'IMPORT-WORKFLOW.md')
Copy-Item (Join-Path $ProjectRoot 'docs\RELEASES.md') (Join-Path $Payload 'RELEASES.md')
Copy-Item (Join-Path $ProjectRoot 'installer\Install-InventoryProject.ps1') $Staging
Copy-Item (Join-Path $ProjectRoot 'installer\Reset-InventoryProject.ps1') $Staging
Copy-Item (Join-Path $ProjectRoot 'installer\Test-Production-Package.ps1') $Staging

$PowerShellFiles = @(Get-ChildItem $Staging -Recurse -Filter '*.ps1' -File)
foreach ($File in $PowerShellFiles) {
    [void][scriptblock]::Create((Get-Content -LiteralPath $File.FullName -Raw))
}
[xml](Get-Content -LiteralPath (Join-Path $Web 'web.config') -Raw) | Out-Null
$WebConfigSource = Get-Content -LiteralPath (Join-Path $Web 'web.config') -Raw
if ($WebConfigSource -notmatch 'Content-Security-Policy') { throw 'Packaged IIS configuration is missing Content-Security-Policy.' }
& (Join-Path $Runtime 'node.exe') --check (Join-Path $Api 'dist\server.js')
if ($LASTEXITCODE -ne 0) { throw 'Packaged API entrypoint failed JavaScript validation.' }

$ForbiddenFiles = @(Get-ChildItem $Staging -Recurse -Force | Where-Object { $_.Name -match '(?i)(vite|gateway|presentation|backup|snapshot)' })
if ($ForbiddenFiles) { throw "Forbidden prototype files were packaged: $($ForbiddenFiles.FullName -join ', ')" }
$ApiPackage = Get-Content -LiteralPath (Join-Path $Api 'package.json') -Raw | ConvertFrom-Json
if ($ApiPackage.PSObject.Properties['devDependencies']) { throw 'Packaged API contains development dependencies.' }
if (Test-Path (Join-Path $Api 'node_modules\vite')) { throw 'Vite was found in the production API payload.' }

$ManifestFiles = @(Get-ChildItem $Staging -Recurse -File | Sort-Object FullName | ForEach-Object {
    [ordered]@{
        path = $_.FullName.Substring($Staging.Length + 1).Replace('\','/')
        bytes = $_.Length
        sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
})
$Manifest = [ordered]@{
    schemaVersion = 1
    product = 'Inventory Project'
    packageType = 'baseline'
    version = $Version
    updaterVersion = '1.1.0'
    architecture = 'IIS static React -> Fastify 3020 -> PostgreSQL 5432'
    createdAt = (Get-Date).ToUniversalTime().ToString('o')
    sourceChecks = 'passed'
    sourceTests = 'passed'
    forbiddenRuntimeComponents = @('Vite server','gateway','memory repository','presentation mode','backup tooling')
    files = $ManifestFiles
}
$Manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $Staging 'release-manifest.json') -Encoding UTF8

Compress-Archive -Path (Join-Path $Staging '*') -DestinationPath $Archive -CompressionLevel Optimal
$ArchiveHash = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash
Write-Host 'Production package created.' -ForegroundColor Green
Write-Host "Directory: $Staging"
Write-Host "Archive: $Archive"
Write-Host "SHA-256: $ArchiveHash"
