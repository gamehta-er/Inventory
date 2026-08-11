param([string]$Root, [ValidateRange(1,1000)][int]$Tail=100)
. (Join-Path $PSScriptRoot 'Support.Common.ps1')
$Root = Get-InventoryRoot $Root
$Paths = @(
    Join-Path $Root 'Logs\Service\InventoryApiService.out.log'
    Join-Path $Root 'Logs\Service\InventoryApiService.err.log'
    Join-Path $Root 'Logs\Operations\operations.jsonl'
)
foreach ($Path in $Paths) {
    Write-Host "`n$Path" -ForegroundColor Cyan
    if (Test-Path -LiteralPath $Path) { Get-Content -LiteralPath $Path -Tail $Tail }
    else { Write-Host 'No log records yet.' -ForegroundColor DarkGray }
}
