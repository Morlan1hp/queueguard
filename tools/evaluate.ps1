# Runs the full evaluation in headless Edge and writes results/results.js + results/results.json.
# Usage: powershell -File tools\evaluate.ps1 [-Seeds 40] [-Exps main,pNotice,recog,demand]
param([int]$Seeds = 40, [string[]]$Exps = @('main', 'pNotice', 'recog', 'demand'))
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$all = @()
$ms = 0
foreach ($exp in $Exps) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $tmp = Join-Path $env:TEMP ("qg-eval-$exp-" + [guid]::NewGuid().ToString('N') + '.json')
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'headless.ps1') -Page eval.html `
    -Query "headless=1&n=$Seeds&exp=$exp" -Budget 3600000 -OutFile $tmp 2>$null | Out-Null
  $j = [IO.File]::ReadAllText($tmp) | ConvertFrom-Json
  Remove-Item $tmp -ErrorAction SilentlyContinue
  $all += $j.results
  $ms += $j.ms
  Write-Host ("{0,-8} {1,4} cells  {2,6:N0} s" -f $exp, $j.results.Count, $sw.Elapsed.TotalSeconds)
}
$out = [ordered]@{ n = $Seeds; ms = $ms; generated = (Get-Date -Format 'yyyy-MM-dd HH:mm'); results = $all }
$json = $out | ConvertTo-Json -Depth 12 -Compress
New-Item -ItemType Directory -Force (Join-Path $repo 'results') | Out-Null
$enc = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $repo 'results\results.json'), $json, $enc)
[IO.File]::WriteAllText((Join-Path $repo 'results\results.js'), "window.QG_RESULTS = $json;`n", $enc)
Write-Host 'Wrote results/results.json and results/results.js'
