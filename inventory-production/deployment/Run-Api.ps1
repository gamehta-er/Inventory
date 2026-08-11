Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$EnvironmentFile = Join-Path $Root 'Config\inventory.env'
$Node = Join-Path $Root 'Runtime\node.exe'
$Server = Join-Path $Root 'Application\api\dist\server.js'

if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) { throw "Environment file not found: $EnvironmentFile" }
if (-not (Test-Path -LiteralPath $Node -PathType Leaf)) { throw "Node runtime not found: $Node" }
if (-not (Test-Path -LiteralPath $Server -PathType Leaf)) { throw "API entrypoint not found: $Server" }

foreach ($Line in Get-Content -LiteralPath $EnvironmentFile) {
    $Trimmed = $Line.Trim()
    if (-not $Trimmed -or $Trimmed.StartsWith('#')) { continue }
    $Parts = $Trimmed.Split('=', 2)
    if ($Parts.Count -ne 2) { throw "Invalid configuration entry: $Line" }
    [Environment]::SetEnvironmentVariable($Parts[0].Trim(), $Parts[1], 'Process')
}

Set-Location (Split-Path -Parent $Server)
& $Node $Server
exit $LASTEXITCODE
