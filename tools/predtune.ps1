# Compares tail-prediction settings (QueueGuard only) over N seeds.
param([int]$Seeds = 10, [string[]]$Settings = @('trendWindow=180&trendDamping=1', 'trendWindow=300&trendDamping=1', 'trendWindow=300&trendDamping=0.6', 'trendWindow=180&trendDamping=0.5', 'trendWindow=420&trendDamping=0.8'))
$seedList = (1..$Seeds) -join ','
foreach ($s in $Settings) {
  $tmp = Join-Path $env:TEMP ('qg-pt-' + [guid]::NewGuid().ToString('N') + '.json')
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'headless.ps1') -Page tools/smoke.html -Query "s=queueguard&seeds=$seedList&$s" -OutFile $tmp 2>$null | Out-Null
  $j = [IO.File]::ReadAllText($tmp) | ConvertFrom-Json
  Remove-Item $tmp
  $p = ($j | Measure-Object tailPredMAE -Average).Average
  $n = ($j | Measure-Object tailNowMAE -Average).Average
  $c = ($j | Measure-Object eoqConflicts -Sum).Sum
  "{0,-40} predMAE={1,6:N1}  nowMAE={2,6:N1}  conflicts={3}" -f $s, $p, $n, $c
}
