Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-InventoryRoot {
    param([string]$Root)
    if ($Root) { return [System.IO.Path]::GetFullPath($Root) }
    return Split-Path -Parent $PSScriptRoot
}

function Assert-InventoryAdministrator {
    $Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $Principal = [Security.Principal.WindowsPrincipal]::new($Identity)
    if (-not $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run this command from an elevated PowerShell window.'
    }
}

function Confirm-InventoryAction {
    param([string]$Prompt, [string]$Expected, [switch]$Confirmed)
    if ($Confirmed) { return }
    $Answer = Read-Host "$Prompt Type $Expected to continue"
    if ($Answer -cne $Expected) { throw 'No action was taken.' }
}

function Write-InventoryOperation {
    param([string]$Root, [string]$Action, [string]$Result, [string]$Detail)
    $Directory = Join-Path $Root 'Logs\Operations'
    New-Item -ItemType Directory -Force -Path $Directory | Out-Null
    $Record = [ordered]@{
        timestamp = (Get-Date).ToString('o')
        action = $Action
        result = $Result
        detail = $Detail
        operator = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        computer = $env:COMPUTERNAME
    }
    ($Record | ConvertTo-Json -Compress) | Add-Content -LiteralPath (Join-Path $Directory 'operations.jsonl') -Encoding UTF8
}

function Get-InventoryDeployment {
    param([string]$Root)
    $Path = Join-Path $Root 'Config\deployment.json'
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Deployment configuration not found: $Path" }
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Invoke-InventoryHttpCheck {
    param([string]$Name, [string]$Uri, [int[]]$ExpectedStatus = @(200))
    try {
        $Response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 10
        return [pscustomobject]@{ Check=$Name; StatusCode=[int]$Response.StatusCode; Passed=$ExpectedStatus -contains [int]$Response.StatusCode; Detail='Responded' }
    } catch {
        $Status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
        return [pscustomobject]@{ Check=$Name; StatusCode=$Status; Passed=$ExpectedStatus -contains $Status; Detail=$_.Exception.Message }
    }
}
