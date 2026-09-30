# QueueGuard pitch clip (~42 s): the side-by-side simulation only, captioned, for the live pitch's demo slide.
# Headless Edge (CDP) + ffmpeg, same machinery as record2.ps1.
# Usage: powershell -File tools\pitchclip.ps1 [-Seed 9] [-Out media\queueguard-pitch-clip.mp4]
param([int]$Seed = 9, [int]$Fps = 30, [string]$Out = 'media\queueguard-pitch-clip.mp4')
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'cdp.ps1')
$pk = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages"
$ffmpeg = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
if (-not $ffmpeg) { $ffmpeg = Get-ChildItem $pk -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName }
$ffprobe = Join-Path (Split-Path $ffmpeg) 'ffprobe.exe'
$work = Join-Path $env:TEMP ('qg-clip-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $work | Out-Null
$base = 'file:///' + ($repo -replace '\\', '/')
$segs = New-Object System.Collections.ArrayList
function NewSeg([string]$kind) { $d = Join-Path $work ('s{0:D2}-{1}' -f $segs.Count, $kind); New-Item -ItemType Directory -Force $d | Out-Null; [void]$segs.Add($d); return $d }
function Nav([string]$url, [int]$waitMs = 2500) {
  Invoke-Cdp 'Page.navigate' @{ url = $url } | Out-Null
  Start-Sleep -Milliseconds $waitMs
  Invoke-CdpEval 'document.fonts.ready.then(function(){return 1})' | Out-Null
}
function Cap([string]$html) { $h = $html -replace "'", "\'"; Invoke-CdpEval "QGApp.caption('$h')" | Out-Null }
function Spot($ids) {
  if (-not $ids) { Invoke-CdpEval 'QGApp.spotlight(null)' | Out-Null; return }
  $arr = '[' + (($ids | ForEach-Object { "'$_'" }) -join ',') + ']'
  Invoke-CdpEval "QGApp.spotlight($arr)" | Out-Null
}
function Sim([string]$query, $plan) {
  $d = NewSeg 'sim'; Nav "$base/index.html?record=1&$query"
  $i = 0
  foreach ($p in $plan) {
    Invoke-CdpEval ("QGApp.advanceTo({0})" -f $p.t0) | Out-Null
    Cap $p.caption; Spot $p.spot
    $n = [int]([math]::Round($p.seconds * $Fps))
    for ($k = 0; $k -lt $n; $k++) {
      $t = $p.t0 + ($p.t1 - $p.t0) * $k / [math]::Max(1, $n)
      Invoke-CdpEval ("QGApp.advanceTo({0})" -f [math]::Round($t, 2).ToString([Globalization.CultureInfo]::InvariantCulture)) | Out-Null
      Save-CdpShot (Join-Path $d ('f{0:D5}.jpg' -f $i)); $i++
    }
  }
}

Start-CdpBrowser -Url "$base/index.html?record=1&seed=$Seed"
Invoke-Cdp 'Emulation.setDeviceMetricsOverride' @{ width = 1920; height = 1080; deviceScaleFactor = 1; mobile = $false } | Out-Null
Invoke-Cdp 'Page.enable' | Out-Null
try {
  Sim "seed=$Seed" @(
    @{ t0 = 540;  t1 = 1150; seconds = 5; spot = $null;            caption = 'Same traffic, same drivers. <b>Top: static signs.</b> Bottom: QueueGuard.' },
    @{ t0 = 1150; t1 = 1190; seconds = 5; spot = @('panel-a');     caption = 'Static signs: drivers reach the growing queue unwarned. <b>Red ring = severe conflict</b> (TTC ≤ 1 s).' },
    @{ t0 = 1190; t1 = 1450; seconds = 5; spot = @('panel-b');     caption = 'QueueGuard finds the queue tail <b>from roadside radar speeds only</b>.' },
    @{ t0 = 1450; t1 = 1750; seconds = 6; spot = @('boards');      caption = 'It predicts the tail 90 s ahead and moves <b>STOPPED TRAFFIC</b> to the board at stopping distance.' },
    @{ t0 = 1750; t1 = 2200; seconds = 5; spot = @('vsls');        caption = 'Speed limits step <b>100 → 80 → 60</b>, so drivers reach the tail slower.' },
    @{ t0 = 2290; t1 = 2700; seconds = 5; spot = @('uhf', 'feed'); caption = 'UHF message for truckies <b>confirmed by the supervisor</b>; workers get high-speed alerts.' },
    @{ t0 = 3400; t1 = 3400; seconds = 4; spot = @('score');       caption = 'Same hour of traffic: <b>static signs vs QueueGuard</b>.' }
  )
  Sim "seed=$Seed&failsafe=1" @(
    @{ t0 = 1700; t1 = 1880; seconds = 3; spot = $null;               caption = 'Fail-safe test: radar data is cut at 30 minutes…' },
    @{ t0 = 1880; t1 = 1960; seconds = 4; spot = @('boards', 'vsls'); caption = '…after 60 s every board shows <b>PREPARE TO STOP</b> and VSL drops to 80. A lost data link never fails silent.' }
  )
} finally { Stop-CdpBrowser }

$parts = @(); $durs = @()
foreach ($d in $segs) {
  $mp4 = "$d.mp4"
  & $ffmpeg -y -loglevel error -framerate $Fps -i (Join-Path $d 'f%05d.jpg') -c:v libx264 -pix_fmt yuv420p -r $Fps $mp4
  $parts += $mp4
  $durs += [double](& $ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 $mp4)
}
$xf = 0.5
$off = ($durs[0] - $xf).ToString('0.###', [Globalization.CultureInfo]::InvariantCulture)
$total = ($durs[0] + $durs[1] - $xf)
$fo = ($total - 0.6).ToString('0.###', [Globalization.CultureInfo]::InvariantCulture)
$filter = "[0:v][1:v]xfade=transition=fade:duration=$($xf):offset=$off,fade=t=in:st=0:d=0.4,fade=t=out:st=$($fo):d=0.6[v]"
$outPath = if ([IO.Path]::IsPathRooted($Out)) { $Out } else { Join-Path $repo $Out }
New-Item -ItemType Directory -Force (Split-Path -Parent $outPath) | Out-Null
$tmpOut = Join-Path $work 'clip.mp4'
& $ffmpeg -y -loglevel error -i $parts[0] -i $parts[1] -filter_complex $filter -map '[v]' -c:v libx264 -pix_fmt yuv420p -crf 21 -preset medium -r $Fps -movflags +faststart $tmpOut
if (-not (Test-Path $tmpOut)) { throw "Final encode failed; segments kept in $work" }
Copy-Item $tmpOut $outPath -Force
Get-Item $outPath | Select-Object FullName, Length
