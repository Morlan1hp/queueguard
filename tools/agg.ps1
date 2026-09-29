# Quick aggregate check: runs tools/smoke.html for N seeds and prints per-strategy totals.
# Usage: powershell -File tools\agg.ps1 [-Seeds 10] [-Extra "pNotice=0.4"]
param([int]$Seeds = 10, [string]$Extra = '')
$q = 'seeds=' + ((1..$Seeds) -join ',')
if ($Extra) { $q += '&' + $Extra }
$raw = powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'headless.ps1') -Page tools/smoke.html -Query $q 2>$null |
  Select-String -NotMatch 'ERROR:' | Out-String
$j = $raw | ConvertFrom-Json
$j | Group-Object strategy | ForEach-Object {
  $g = $_.Group
  [pscustomobject]@{
    strategy  = $_.Name
    conflicts = ($g | Measure-Object eoqConflicts -Sum).Sum
    coll      = ($g | Measure-Object collisions -Sum).Sum
    mergeColl = ($g | Measure-Object mergeCollisions -Sum).Sum
    TET_s     = [math]::Round(($g | Measure-Object ttcExposure -Sum).Sum, 0)
    approach  = [math]::Round(($g | Measure-Object approachSpeedMean -Average).Average, 1)
    p85       = [math]::Round(($g | Measure-Object approachSpeedP85 -Average).Average, 1)
    timely    = [math]::Round(($g | Measure-Object timelyWarningShare -Average).Average, 3)
    uncov     = [math]::Round(($g | Measure-Object queueTimeUncoveredShare -Average).Average, 3)
    dynCred   = [math]::Round(($g | Measure-Object dynamicWarningCredibility -Average).Average, 3)
    thru      = [math]::Round(($g | Measure-Object throughputPerHour -Average).Average, 0)
    maxQ      = [math]::Round(($g | Measure-Object maxQueueLength -Average).Average, 0)
    qMin      = [math]::Round(($g | Measure-Object queueMinutes -Average).Average, 1)
    predMAE   = [math]::Round(($g | Measure-Object tailPredMAE -Average).Average, 0)
    nowMAE    = [math]::Round(($g | Measure-Object tailNowMAE -Average).Average, 0)
  }
} | Format-Table -AutoSize | Out-String -Width 300
foreach ($s in ($j | Select-Object -ExpandProperty strategy -Unique)) {
  "$s conflict x: " + ((($j | Where-Object strategy -eq $s) | ForEach-Object { $_.conflictXs }) -join ',')
}
