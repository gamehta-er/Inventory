[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$PackagePath,
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
$UpdaterVersion = '1.2.2'

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

function Get-ComponentPrefix([string]$Component) {
    switch ($Component) {
        'web' { return 'Payload/Application/web/' }
        'api' { return 'Payload/Application/api/' }
        'operations' { return 'Payload/Operations/' }
        'database' { return 'Payload/Database/Migrations/' }
        default { throw "Unknown update component: $Component" }
    }
}

function Get-LiveComponentRoot([string]$Component) {
    switch ($Component) {
        'web' { return Join-Path $InstallRoot 'Application\web' }
        'api' { return Join-Path $InstallRoot 'Application\api' }
        'operations' { return Join-Path $InstallRoot 'Operations' }
        default { throw "Component has no publish directory: $Component" }
    }
}

function Copy-Tree([string]$Source, [string]$Destination) {
    if (-not (Test-Path -LiteralPath $Source -PathType Container)) { throw "Live component not found: $Source" }
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    Get-ChildItem -LiteralPath $Source -Force | Copy-Item -Destination $Destination -Recurse -Force
}

function Stop-InventoryApi {
    $Service = Get-Service -Name $ApiServiceName -ErrorAction Stop
    if ($Service.Status -ne 'Stopped') {
        Stop-Service -Name $ApiServiceName -Force
        $Service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(20))
    }

    $Deadline = (Get-Date).AddSeconds(20)
    do {
        $Listeners = @(Get-NetTCPConnection -State Listen -LocalPort 3020 -ErrorAction SilentlyContinue)
        if (-not $Listeners.Count) { return }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $Deadline)

    $Owners = @($Listeners.OwningProcess | Sort-Object -Unique)
    foreach ($ProcessId in $Owners) {
        $Process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
        if ($Process) {
            Write-Host "Stopping remaining port 3020 process $ProcessId ($($Process.ProcessName))." -ForegroundColor Yellow
            Stop-Process -Id $ProcessId -Force -ErrorAction Stop
        }
    }
    Start-Sleep -Seconds 2

    $UnexpectedListeners = @(Get-NetTCPConnection -State Listen -LocalPort 3020 -ErrorAction SilentlyContinue)
    if ($UnexpectedListeners.Count) {
        $Owners = $UnexpectedListeners.OwningProcess | Sort-Object -Unique
        throw "Port 3020 remains in use after the Inventory API service stopped. Process IDs: $($Owners -join ', ')."
    }
}

function Assert-ChildPath([string]$Parent, [string]$Child) {
    $ParentPath = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
    $ChildPath = [IO.Path]::GetFullPath($Child)
    if (-not $ChildPath.StartsWith($ParentPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path escapes its component root: $Child"
    }
}

function Test-Component([string]$Candidate, [object]$Target) {
    $Expected = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($Entry in @($Target.files)) {
        $Relative = ([string]$Entry.path).Replace('/', '\')
        $FullPath = Join-Path $Candidate $Relative
        Assert-ChildPath $Candidate $FullPath
        if (-not (Test-Path -LiteralPath $FullPath -PathType Leaf)) { throw "Staged component is missing: $($Entry.path)" }
        $File = Get-Item -LiteralPath $FullPath
        if ($File.Length -ne [long]$Entry.bytes) { throw "Staged component size mismatch: $($Entry.path)" }
        $Hash = (Get-FileHash -LiteralPath $FullPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($Hash -ne ([string]$Entry.sha256).ToLowerInvariant()) { throw "Staged component hash mismatch: $($Entry.path)" }
        [void]$Expected.Add(([string]$Entry.path).Replace('\','/'))
    }
    $Actual = @(Get-ChildItem -LiteralPath $Candidate -Recurse -File | ForEach-Object {
        $_.FullName.Substring($Candidate.Length + 1).Replace('\','/')
    } | Where-Object { $_ -ine 'maintenance.flag' })
    $Unexpected = @($Actual | Where-Object { -not $Expected.Contains($_) })
    if ($Unexpected.Count) { throw "Staged component contains unexpected files: $($Unexpected -join ', ')" }
    if ($Actual.Count -ne $Expected.Count) { throw "Staged component file count does not match the target manifest." }
}

function Invoke-ProcessCapture([string]$Executable, [string[]]$Arguments, [string]$Password) {
    $Quote = {
        param([string]$Value)
        if ($Value -notmatch '[\s"]') { return $Value }
        return '"' + $Value.Replace('"','\"') + '"'
    }
    $Info = [Diagnostics.ProcessStartInfo]::new()
    $Info.FileName = $Executable
    $Info.Arguments = (($Arguments | ForEach-Object { & $Quote ([string]$_) }) -join ' ')
    $Info.UseShellExecute = $false
    $Info.CreateNoWindow = $true
    $Info.RedirectStandardOutput = $true
    $Info.RedirectStandardError = $true
    if ($Password) { $Info.EnvironmentVariables['PGPASSWORD'] = $Password }
    $Info.EnvironmentVariables['PGCONNECT_TIMEOUT'] = '10'
    $Process = [Diagnostics.Process]::new()
    $Process.StartInfo = $Info
    [void]$Process.Start()
    $Standard = $Process.StandardOutput.ReadToEnd()
    $ErrorText = $Process.StandardError.ReadToEnd()
    $Process.WaitForExit()
    if ($Process.ExitCode -ne 0) { throw "Command failed with exit code $($Process.ExitCode): $ErrorText" }
    return [pscustomobject]@{ Output=$Standard; Error=$ErrorText; ExitCode=$Process.ExitCode }
}

function Invoke-HealthCheck([string]$Name, [string]$Uri) {
    $Response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 20
    if ($Response.StatusCode -ne 200) { throw "$Name returned HTTP $($Response.StatusCode)." }
    return [ordered]@{ name=$Name; uri=$Uri; status=200; result='passed' }
}

function Invoke-JsonContract([string]$Name, [string]$Uri) {
    $Response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 20 -Headers @{ 'Cache-Control'='no-cache' }
    if ($Response.StatusCode -ne 200) { throw "$Name returned HTTP $($Response.StatusCode)." }
    try { $Contract = $Response.Content | ConvertFrom-Json }
    catch { throw "$Name returned invalid JSON." }
    return [pscustomobject]@{ Name=$Name; Uri=$Uri; Contract=$Contract }
}

function Assert-VersionContract([object]$ApiContract, [object]$WebContract, [object]$Expected, [string]$RequiredImportContract) {
    foreach ($Property in @('packageVersion','webVersion','apiVersion','schemaVersion','importContractVersion','compatible')) {
        if (-not $ApiContract.PSObject.Properties[$Property]) { throw "API version contract is missing $Property." }
    }
    if ([string]$ApiContract.packageVersion -cne [string]$Expected.package) { throw "API package version $($ApiContract.packageVersion) does not match expected $($Expected.package)." }
    if ([string]$ApiContract.webVersion -cne [string]$Expected.web) { throw "API-declared web version $($ApiContract.webVersion) does not match expected $($Expected.web)." }
    if ([string]$ApiContract.apiVersion -cne [string]$Expected.api) { throw "API version $($ApiContract.apiVersion) does not match expected $($Expected.api)." }
    if ([string]$ApiContract.importContractVersion -cne $RequiredImportContract -or -not [bool]$ApiContract.compatible) {
        throw "Import contract is incompatible. Expected $RequiredImportContract; received $($ApiContract.importContractVersion)."
    }
    if (-not $WebContract.PSObject.Properties['packageVersion'] -or -not $WebContract.PSObject.Properties['webVersion']) {
        throw 'Web version contract is incomplete.'
    }
    if ([string]$WebContract.packageVersion -cne [string]$Expected.package -or [string]$WebContract.webVersion -cne [string]$Expected.web) {
        throw "Published web version does not match expected $($Expected.web)."
    }
}

function Write-ReleaseLedger([string]$Result, [string]$Detail, [object[]]$HealthChecks, [string[]]$AppliedMigrations) {
    $LedgerRoot = Join-Path $InstallRoot 'Logs\Releases'
    New-Item -ItemType Directory -Force -Path $LedgerRoot | Out-Null
    $Record = [ordered]@{
        timestamp = (Get-Date).ToUniversalTime().ToString('o')
        operator = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        fromVersion = [string]$Manifest.fromVersion
        toVersion = [string]$Manifest.toVersion
        updaterVersion = $UpdaterVersion
        packageHash = $PackageHash
        changedComponents = @($Manifest.components)
        migrationIds = @($AppliedMigrations)
        conformance = if ($Manifest.PSObject.Properties['conformance']) {
            [ordered]@{
                frameworkVersion = [string]$Manifest.conformance.frameworkVersion
                changeId = [string]$Manifest.conformance.changeId
                artifactHash = [string]$Manifest.conformance.sha256
                requirementIds = @($Manifest.conformance.requirementIds)
            }
        } else { $null }
        result = $Result
        healthChecks = @($HealthChecks)
        detail = $Detail
    }
    ($Record | ConvertTo-Json -Depth 8 -Compress) | Add-Content -LiteralPath (Join-Path $LedgerRoot 'release-ledger.jsonl') -Encoding UTF8
}

Assert-Administrator
Import-Module WebAdministration -ErrorAction Stop
if (-not $Confirmed) {
    $Answer = Read-Host 'Apply this Inventory Project delta? Type APPLY INVENTORY UPDATE'
    if ($Answer -cne 'APPLY INVENTORY UPDATE') { throw 'No update changes were made.' }
}

$PackagePath = (Resolve-Path -LiteralPath $PackagePath -ErrorAction Stop).Path
$DeploymentFile = Join-Path $InstallRoot 'Config\deployment.json'
$Verifier = Join-Path $PSScriptRoot 'Test-Delta-Package.ps1'
foreach ($Required in @($DeploymentFile,$Verifier)) {
    if (-not (Test-Path -LiteralPath $Required -PathType Leaf)) { throw "Required updater file not found: $Required" }
}
if (-not (Get-Website -Name $SiteName -ErrorAction SilentlyContinue)) { throw "IIS website not found: $SiteName" }
if (-not (Get-Service -Name $ApiServiceName -ErrorAction SilentlyContinue)) { throw "API service not found: $ApiServiceName" }

$WorkRoot = Join-Path $InstallRoot ("Temp\Updates\{0}" -f [guid]::NewGuid().ToString('N'))
$ExtractRoot = Join-Path $WorkRoot 'Package'
$CandidateRoot = Join-Path $WorkRoot 'Candidate'
$PreviousRoot = Join-Path $WorkRoot 'Previous'
New-Item -ItemType Directory -Force -Path $ExtractRoot,$CandidateRoot,$PreviousRoot | Out-Null
$SourceIsArchive = [IO.Path]::GetExtension($PackagePath) -ieq '.zip'
$DeleteSourceOnSuccess = $PackagePath.StartsWith('C:\InventoryProject-Install\', [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $PackagePath -Leaf) -like 'InventoryProject-Delta-*'

$Manifest = $null
$PackageHash = $null
$PackageRoot = $null
$AppliedMigrations = [Collections.Generic.List[string]]::new()
$HealthChecks = [Collections.Generic.List[object]]::new()
$Switched = [Collections.Generic.List[string]]::new()
$SwitchingComponent = $null
$MaintenanceFlag = Join-Path $InstallRoot 'Application\web\maintenance.flag'
$MaintenanceWasActive = Test-Path -LiteralPath $MaintenanceFlag -PathType Leaf
$OriginalMaintenanceContent = if ($MaintenanceWasActive) { Get-Content -LiteralPath $MaintenanceFlag -Raw } else { $null }
$ApiWasStopped = $false
$SiteWasStopped = $false
$Published = $false
$NeedsApiStop = $false
$AdminPassword = $null

function Restore-OriginalMaintenanceState {
    if ($MaintenanceWasActive) {
        if ([string]::IsNullOrEmpty($OriginalMaintenanceContent)) {
            New-Item -ItemType File -Force -Path $MaintenanceFlag | Out-Null
        } else {
            [IO.File]::WriteAllText($MaintenanceFlag, $OriginalMaintenanceContent, [Text.UTF8Encoding]::new($false))
        }
    } else {
        Remove-Item -LiteralPath $MaintenanceFlag -Force -ErrorAction SilentlyContinue
    }
}

try {
    if ($SourceIsArchive) {
        $PackageHash = (Get-FileHash -LiteralPath $PackagePath -Algorithm SHA256).Hash.ToLowerInvariant()
        Expand-Archive -LiteralPath $PackagePath -DestinationPath $ExtractRoot -Force
        $ManifestCandidates = @(Get-ChildItem -LiteralPath $ExtractRoot -Recurse -Filter 'delta-manifest.json' -File)
        if ($ManifestCandidates.Count -ne 1) { throw 'Delta archive must contain exactly one delta-manifest.json.' }
        $PackageRoot = Split-Path -Parent $ManifestCandidates[0].FullName
    } else {
        $PackageRoot = $PackagePath
        $ManifestFile = Join-Path $PackageRoot 'delta-manifest.json'
        if (-not (Test-Path -LiteralPath $ManifestFile -PathType Leaf)) { throw "Delta manifest not found: $ManifestFile" }
        $PackageHash = (Get-FileHash -LiteralPath $ManifestFile -Algorithm SHA256).Hash.ToLowerInvariant()
    }

    $Deployment = Get-Content -LiteralPath $DeploymentFile -Raw | ConvertFrom-Json
    Write-Host 'Verifying update package integrity. No services have been stopped.' -ForegroundColor Cyan
    & $Verifier -PackageRoot $PackageRoot -InstalledVersion ([string]$Deployment.Version)
    $Manifest = Get-Content -LiteralPath (Join-Path $PackageRoot 'delta-manifest.json') -Raw | ConvertFrom-Json
    if ([string]$Deployment.Version -cne [string]$Manifest.fromVersion) {
        throw "Installed version $($Deployment.Version) does not match delta source $($Manifest.fromVersion)."
    }
    if ([version]$UpdaterVersion -lt [version]$Manifest.requiredUpdaterVersion) {
        throw "Updater $UpdaterVersion is too old. Install updater $($Manifest.requiredUpdaterVersion) or newer."
    }

    $Components = @($Manifest.components)
    $CompleteComponents = if ($Manifest.PSObject.Properties['completeComponents']) { @($Manifest.completeComponents) } else { @() }
    Write-Host "Preparing components: $($Components -join ', ')" -ForegroundColor Cyan
    foreach ($Component in @($Components | Where-Object { $_ -ne 'database' })) {
        $Live = Get-LiveComponentRoot $Component
        $Candidate = Join-Path $CandidateRoot $Component
        if ($CompleteComponents -contains $Component) {
            New-Item -ItemType Directory -Force -Path $Candidate | Out-Null
        } else {
            Copy-Tree $Live $Candidate
        }
        $Prefix = Get-ComponentPrefix $Component
        foreach ($Entry in @($Manifest.files | Where-Object { $_.component -eq $Component })) {
            $EntryPath = ([string]$Entry.path).Replace('\','/')
            if (-not $EntryPath.StartsWith($Prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Invalid $Component payload path: $EntryPath" }
            $Relative = $EntryPath.Substring($Prefix.Length).Replace('/','\')
            $Target = Join-Path $Candidate $Relative
            Assert-ChildPath $Candidate $Target
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Target) | Out-Null
            Copy-Item -LiteralPath (Join-Path $PackageRoot ([string]$Entry.path).Replace('/','\')) -Destination $Target -Force
        }
        foreach ($Entry in @($Manifest.removedFiles | Where-Object { $_.component -eq $Component })) {
            $EntryPath = ([string]$Entry.path).Replace('\','/')
            if (-not $EntryPath.StartsWith($Prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Invalid $Component removal path: $EntryPath" }
            $Relative = $EntryPath.Substring($Prefix.Length).Replace('/','\')
            $Target = Join-Path $Candidate $Relative
            Assert-ChildPath $Candidate $Target
            Remove-Item -LiteralPath $Target -Force -ErrorAction SilentlyContinue
        }
        $TargetManifest = @($Manifest.targetComponents | Where-Object { $_.component -eq $Component })
        if ($TargetManifest.Count -ne 1) { throw "Delta is missing the complete target manifest for $Component." }
        Test-Component $Candidate $TargetManifest[0]
        Write-Host "PASS: Staged $Component component matches its complete target manifest." -ForegroundColor Green
    }

    # Collect database credentials while the current application is still online.
    $Psql = $null
    if ($Components -contains 'database') {
        $Psql = Join-Path $PostgreSqlBin 'psql.exe'
        if (-not (Test-Path -LiteralPath $Psql -PathType Leaf)) { throw "psql.exe not found: $Psql" }
        if (-not $PostgreSqlAdminPassword) {
            $PostgreSqlAdminPassword = Read-Host "PostgreSQL password for $PostgreSqlAdminUser" -AsSecureString
        }
        $AdminPassword = ConvertFrom-SecureValue $PostgreSqlAdminPassword
        Write-Host 'PASS: Database credential received. Beginning the controlled update window.' -ForegroundColor Green
    }

    $NeedsApiStop = $Components -contains 'api' -or $Components -contains 'database'
    $NeedsMaintenance = $Components -contains 'web' -or $NeedsApiStop
    if ($NeedsMaintenance) { New-Item -ItemType File -Force -Path $MaintenanceFlag | Out-Null }
    if ($NeedsApiStop) {
        $ApiWasStopped = $true
        Stop-InventoryApi
    }

    if ($Components -contains 'database') {
        $LedgerResult = Invoke-ProcessCapture $Psql @(
            '-h','127.0.0.1','-p','5432','-U',$PostgreSqlAdminUser,'-d',$DatabaseName,'-w','-X','-tAc',
            "SELECT CASE WHEN to_regclass('invmgmt.schema_migrations') IS NOT NULL THEN 'invmgmt.schema_migrations' WHEN to_regclass('public.schema_migrations') IS NOT NULL THEN 'public.schema_migrations' ELSE '' END;"
        ) $AdminPassword
        $LedgerTable = $LedgerResult.Output.Trim()
        if (-not $LedgerTable) { throw 'Inventory migration ledger was not found.' }

        foreach ($Migration in @($Manifest.migrations)) {
            $EscapedId = ([string]$Migration.id).Replace("'", "''")
            $ExistsResult = Invoke-ProcessCapture $Psql @('-h','127.0.0.1','-p','5432','-U',$PostgreSqlAdminUser,'-d',$DatabaseName,'-w','-X','-tAc',"SELECT 1 FROM $LedgerTable WHERE migration_key='$EscapedId';") $AdminPassword
            if ($ExistsResult.Output.Trim() -eq '1') {
                Write-Host "Skipping previously applied migration: $($Migration.id)"
                continue
            }
            $MigrationPath = Join-Path $PackageRoot ([string]$Migration.path).Replace('/','\')
            Write-Host "Applying migration: $($Migration.id)" -ForegroundColor Cyan
            $MigrationArguments = @('-h','127.0.0.1','-p','5432','-U',$PostgreSqlAdminUser,'-d',$DatabaseName,'-w','-X','-v','ON_ERROR_STOP=1')
            if ($LedgerTable -eq 'invmgmt.schema_migrations') {
                $MigrationArguments += @('-c','SET ROLE inventory_owner; SET search_path=invmgmt,public;')
            }
            $MigrationArguments += @('-f',$MigrationPath)
            [void](Invoke-ProcessCapture $Psql $MigrationArguments $AdminPassword)
            $AppliedMigrations.Add([string]$Migration.id)
            if ([string]$Migration.id -eq '006-invmgmt-schema') {
                $LedgerTable = 'invmgmt.schema_migrations'
            }
        }

        foreach ($RequiredMigration in @($Manifest.requiredSchemaMigrations)) {
            $EscapedRequiredMigration = ([string]$RequiredMigration).Replace("'", "''")
            $RequiredResult = Invoke-ProcessCapture $Psql @(
                '-h','127.0.0.1','-p','5432','-U',$PostgreSqlAdminUser,'-d',$DatabaseName,'-w','-X','-tAc',
                "SELECT 1 FROM $LedgerTable WHERE migration_key='$EscapedRequiredMigration';"
            ) $AdminPassword
            if ($RequiredResult.Output.Trim() -ne '1') {
                throw "Required database migration is not installed: $RequiredMigration"
            }
        }
        Write-Host 'PASS: Required database migrations are installed.' -ForegroundColor Green
    }

    foreach ($Component in @($Components | Where-Object { $_ -ne 'database' })) {
        $Live = Get-LiveComponentRoot $Component
        $Previous = Join-Path $PreviousRoot $Component
        if ($Component -eq 'web') {
            Stop-Website -Name $SiteName
            $SiteWasStopped = $true
            New-Item -ItemType File -Force -Path (Join-Path $CandidateRoot 'web\maintenance.flag') | Out-Null
        }
        Copy-Tree $Live $Previous
        $SwitchingComponent = [string]$Component
        Remove-Item -LiteralPath $Live -Recurse -Force
        Move-Item -LiteralPath (Join-Path $CandidateRoot $Component) -Destination $Live
        $Switched.Add([string]$Component)
        $SwitchingComponent = $null
        if ($Component -eq 'web') {
            $AppPoolName = [string](Get-Website -Name $SiteName).applicationPool
            & icacls.exe $Live /grant 'SYSTEM:(OI)(CI)(M)' "IIS AppPool\${AppPoolName}:(OI)(CI)(RX)" /T /C | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Maintenance control and IIS application pool permissions could not be applied.' }
            Start-Website -Name $SiteName
            $SiteWasStopped = $false
        }
    }
    $Published = $true

    if ($NeedsApiStop) {
        Start-Service -Name $ApiServiceName
        $ApiWasStopped = $false
        Start-Sleep -Seconds 3
    }
    $HealthChecks.Add((Invoke-HealthCheck 'Direct API readiness' 'http://127.0.0.1:3020/api/v1/health/ready'))
    Restore-OriginalMaintenanceState
    $HealthChecks.Add((Invoke-HealthCheck 'IIS API readiness' 'http://127.0.0.1/api/v1/health/ready'))
    $HealthChecks.Add((Invoke-HealthCheck 'IIS application' 'http://127.0.0.1/'))
    $DirectVersion = Invoke-JsonContract 'Direct API version contract' 'http://127.0.0.1:3020/api/v1/version'
    $IisVersion = Invoke-JsonContract 'IIS API version contract' 'http://127.0.0.1/api/v1/version'
    $WebVersion = Invoke-JsonContract 'Published web version contract' 'http://127.0.0.1/version.json'
    Assert-VersionContract $DirectVersion.Contract $WebVersion.Contract $Manifest.expectedVersions ([string]$Manifest.requiredImportContractVersion)
    Assert-VersionContract $IisVersion.Contract $WebVersion.Contract $Manifest.expectedVersions ([string]$Manifest.requiredImportContractVersion)
    $HealthChecks.Add([ordered]@{ name='Component compatibility'; uri='/api/v1/version + /version.json'; status=200; result='passed' })
    foreach ($Route in @('/','/inventory','/import','/reports','/activity','/admin')) {
        $HealthChecks.Add((Invoke-HealthCheck "IIS route $Route" ("http://127.0.0.1{0}" -f $Route)))
    }

    $Deployment.Version = [string]$Manifest.toVersion
    $Deployment | Add-Member -NotePropertyName UpdaterVersion -NotePropertyValue $UpdaterVersion -Force
    $Deployment | Add-Member -NotePropertyName UpdatedAt -NotePropertyValue (Get-Date).ToUniversalTime().ToString('o') -Force
    $Deployment | Add-Member -NotePropertyName LastPackageHash -NotePropertyValue $PackageHash -Force
    $Deployment | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $DeploymentFile -Encoding UTF8

    $LedgerManifestRoot = Join-Path $InstallRoot 'Logs\Releases\Manifests'
    New-Item -ItemType Directory -Force -Path $LedgerManifestRoot | Out-Null
    Copy-Item -LiteralPath (Join-Path $PackageRoot 'delta-manifest.json') -Destination (Join-Path $LedgerManifestRoot ("{0}.json" -f $Manifest.toVersion)) -Force
    Write-ReleaseLedger 'SUCCESS' 'Delta published and all health checks passed.' @($HealthChecks) @($AppliedMigrations)

    Remove-Item -LiteralPath $PreviousRoot -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "PASS: Inventory Project $($Manifest.toVersion) is operational." -ForegroundColor Green
    Write-Host "Components changed: $($Components -join ', ')"
    Write-Host "Release ledger: $(Join-Path $InstallRoot 'Logs\Releases\release-ledger.jsonl')"
    if ($DeleteSourceOnSuccess) {
        if (Test-Path -LiteralPath $PackagePath -PathType Container) { Remove-Item -LiteralPath $PackagePath -Recurse -Force -ErrorAction Stop }
        else { Remove-Item -LiteralPath $PackagePath -Force -ErrorAction Stop }
    }
}
catch {
    $Failure = $_.Exception.Message
    if ($Switched.Count -or $SwitchingComponent) {
        try {
            New-Item -ItemType File -Force -Path $MaintenanceFlag | Out-Null
            if ($NeedsApiStop) { Stop-InventoryApi }
            if (Get-Website -Name $SiteName -ErrorAction SilentlyContinue | Where-Object State -eq 'Started') { Stop-Website -Name $SiteName }
            $ReverseSwitched = @($Switched)
            if ($SwitchingComponent -and $ReverseSwitched -notcontains $SwitchingComponent) {
                $ReverseSwitched += [string]$SwitchingComponent
            }
            [array]::Reverse($ReverseSwitched)
            foreach ($Component in $ReverseSwitched) {
                $Live = Get-LiveComponentRoot $Component
                $Previous = Join-Path $PreviousRoot $Component
                Remove-Item -LiteralPath $Live -Recurse -Force -ErrorAction SilentlyContinue
                if (Test-Path -LiteralPath $Previous) { Move-Item -LiteralPath $Previous -Destination $Live }
            }
            if ($NeedsApiStop) { Start-Service -Name $ApiServiceName -ErrorAction SilentlyContinue }
            Start-Website -Name $SiteName -ErrorAction SilentlyContinue
            Restore-OriginalMaintenanceState
        } catch { $Failure = "$Failure Rollback also reported: $($_.Exception.Message)" }
    } else {
        if ($ApiWasStopped) { Start-Service -Name $ApiServiceName -ErrorAction SilentlyContinue }
        if ($SiteWasStopped) { Start-Website -Name $SiteName -ErrorAction SilentlyContinue }
        Restore-OriginalMaintenanceState
    }
    if ($Manifest) { Write-ReleaseLedger 'FAILED' $Failure @($HealthChecks) @($AppliedMigrations) }
    throw $Failure
}
finally {
    $AdminPassword = $null
    Remove-Item -LiteralPath $WorkRoot -Recurse -Force -ErrorAction SilentlyContinue
}
