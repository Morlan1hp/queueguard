# Records the QueueGuard demo video frame by frame through headless Edge (CDP) and encodes it with ffmpeg.
# Usage: powershell -File tools\record.ps1 -Seed 3 -Team "Team name" -Url "https://github.com/..." [-Fps 30]
param(
  [int]$Seed = 9,
  [string]$Team = '',
  [string]$Url = '',
  [int]$Fps = 30,
  [string]$ResultsHeadline = '',
  [string]$ResultsText = '',
  [string]$Out = 'media\queueguard-demo.mp4'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'cdp.ps1')
$ffmpeg = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
if (-not $ffmpeg) {
  $ffmpeg = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $ffmpeg) { throw 'ffmpeg not found' }
$work = Join-Path $env:TEMP ('qg-video-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $work | Out-Null
$base = 'file:///' + ($repo -replace '\\', '/')
$segments = New-Object System.Collections.ArrayList
$frameNo = 0

function New-Segment([string]$name) {
  $dir = Join-Path $work $name
  New-Item -ItemType Directory -Force $dir | Out-Null
  [void]$segments.Add($dir)
  return $dir
}
function Enc([string]$s) { [Uri]::EscapeDataString($s) }

function Add-Card([string]$query, [double]$seconds) {
  $dir = New-Segment ('s{0:D2}-card' -f $segments.Count)
  Invoke-Cdp 'Page.navigate' @{ url = "$base/tools/card.html?$query" } | Out-Null
  Start-Sleep -Milliseconds 1500
  Invoke-CdpEval 'document.fonts.ready.then(function(){return 1})' | Out-Null
  Save-CdpShot (Join-Path $dir 'still.jpg')
  Set-Content -Path (Join-Path $dir 'duration.txt') -Value $seconds
}

function Add-Page([string]$page, [double]$seconds, [string]$scrollJs = '') {
  $dir = New-Segment ('s{0:D2}-page' -f $segments.Count)
  Invoke-Cdp 'Page.navigate' @{ url = "$base/$page" } | Out-Null
  Start-Sleep -Milliseconds 2500
  Invoke-CdpEval 'document.fonts.ready.then(function(){return 1})' | Out-Null
  if ($scrollJs) { Invoke-CdpEval $scrollJs | Out-Null; Start-Sleep -Milliseconds 300 }
  Save-CdpShot (Join-Path $dir 'still.jpg')
  Set-Content -Path (Join-Path $dir 'duration.txt') -Value $seconds
}

# Dashboard timelapse: $plan = list of @{ t0; t1; seconds; caption }
function Add-Sim([string]$query, $plan) {
  $dir = New-Segment ('s{0:D2}-sim' -f $segments.Count)
  Invoke-Cdp 'Page.navigate' @{ url = "$base/index.html?record=1&$query" } | Out-Null
  Start-Sleep -Milliseconds 2500
  Invoke-CdpEval 'document.fonts.ready.then(function(){return 1})' | Out-Null
  $i = 0
  foreach ($p in $plan) {
    $cap = ($p.caption -replace "'", "\'")
    Invoke-CdpEval "QGApp.caption('$cap')" | Out-Null
    $n = [int]([math]::Round($p.seconds * $Fps))
    for ($k = 0; $k -lt $n; $k++) {
      $t = $p.t0 + ($p.t1 - $p.t0) * $k / [math]::Max(1, $n)
      Invoke-CdpEval ("QGApp.advanceTo({0})" -f [math]::Round($t, 2).ToString([Globalization.CultureInfo]::InvariantCulture)) | Out-Null
      Save-CdpShot (Join-Path $dir ('f{0:D5}.jpg' -f $i))
      $i++
    }
  }
}

Start-CdpBrowser -Url "$base/tools/card.html?card=title"
Invoke-Cdp 'Emulation.setDeviceMetricsOverride' @{ width = 1920; height = 1080; deviceScaleFactor = 1; mobile = $false } | Out-Null
Invoke-Cdp 'Page.enable' | Out-Null
try {
  Add-Card ("card=title") 4
  Add-Card ("card=problem") 6
  Add-Card ("card=evidence") 9
  Add-Card ("card=how") 7
  Add-Card ("card=method") 7
  $plan = @(
    @{ t0 = 540;  t1 = 900;  seconds = 6;  caption = 'Same traffic, same drivers. <b>Top: static signs only.</b> Bottom: QueueGuard.' },
    @{ t0 = 900;  t1 = 1150; seconds = 7;  caption = 'Demand rises above the work-zone capacity — a queue starts to form at the merge.' },
    @{ t0 = 1150; t1 = 1190; seconds = 6;  caption = 'Top: drivers reach the growing queue with no warning. <b>Red ring = severe conflict</b> (TTC ≤ 1 s or DRAC ≥ 3.4 m/s²).' },
    @{ t0 = 1190; t1 = 1450; seconds = 8;  caption = 'Bottom: radar on the VMS trailers sees the queue. QueueGuard estimates the tail <b>from detectors only</b>.' },
    @{ t0 = 1450; t1 = 1750; seconds = 9;  caption = 'It predicts the tail 90 s ahead and moves <b>STOPPED TRAFFIC</b> to the first board at stopping distance.' },
    @{ t0 = 1750; t1 = 2200; seconds = 9;  caption = 'Variable speed limits step <b>100 → 80 → 60</b>, so drivers reach the tail slower.' },
    @{ t0 = 2200; t1 = 2290; seconds = 6;  caption = 'Top again: the tail has grown past the fixed signs — another severe conflict.' },
    @{ t0 = 2290; t1 = 2700; seconds = 9;  caption = 'Queue growing → a UHF CB 40 message for truckies is drafted; the supervisor confirms it.' },
    @{ t0 = 2700; t1 = 3400; seconds = 9;  caption = 'The queue clears. Messages relax only after a 60 s hold — no flicker, no false queue warnings.' },
    @{ t0 = 3400; t1 = 3400; seconds = 3;  caption = 'Top row: <b>static vs QueueGuard</b> for the same hour of traffic.' }
  )
  Add-Sim ("seed=$Seed") $plan
  $fail = @(
    @{ t0 = 1700; t1 = 1880; seconds = 4; caption = 'Fail-safe test: detector data is cut at 30 min…' },
    @{ t0 = 1880; t1 = 1960; seconds = 5; caption = '…after 60 s every board shows <b>PREPARE TO STOP</b> and VSL drops to 80. It never fails silent.' }
  )
  Add-Sim ("seed=$Seed&failsafe=1") $fail
  if ($ResultsHeadline) { Add-Card ("card=results&rh=" + (Enc $ResultsHeadline) + "&rp=" + (Enc $ResultsText)) 10 }
  Add-Page 'eval.html' 7
  Add-Page 'guideline.html' 7
  Add-Card ("card=rollout") 8
  $endQ = 'card=end'
  if ($Team) { $endQ += '&team=' + (Enc $Team) }
  if ($Url) { $endQ += '&url=' + (Enc $Url) }
  Add-Card $endQ 5
} finally { Stop-CdpBrowser }

# encode each segment, then concatenate
$parts = @()
foreach ($dir in $segments) {
  $mp4 = "$dir.mp4"
  if (Test-Path (Join-Path $dir 'still.jpg')) {
    $sec = [double](Get-Content (Join-Path $dir 'duration.txt'))
    & $ffmpeg -y -loglevel error -loop 1 -framerate $Fps -t $sec -i (Join-Path $dir 'still.jpg') -c:v libx264 -pix_fmt yuv420p -r $Fps -vf "fade=t=in:st=0:d=0.4" $mp4
  } else {
    & $ffmpeg -y -loglevel error -framerate $Fps -i (Join-Path $dir 'f%05d.jpg') -c:v libx264 -pix_fmt yuv420p -r $Fps $mp4
  }
  $parts += $mp4
}
$list = Join-Path $work 'list.txt'
($parts | ForEach-Object { "file '" + ($_ -replace '\\', '/') + "'" }) | Set-Content -Encoding ascii $list
$outPath = if ([IO.Path]::IsPathRooted($Out)) { $Out } else { Join-Path $repo $Out }
New-Item -ItemType Directory -Force (Split-Path -Parent $outPath) | Out-Null
& $ffmpeg -y -loglevel error -f concat -safe 0 -i $list -c:v libx264 -pix_fmt yuv420p -crf 22 -preset medium -movflags +faststart $outPath
Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
Get-Item $outPath | Select-Object FullName, Length
