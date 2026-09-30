# QueueGuard demo video v2: hook animation first, spotlights during the live demo, animated results,
# "what is new" table, virtual trial, crossfades. Headless Edge (CDP) + ffmpeg.
# Usage: powershell -File tools\record2.ps1 [-Team "..."] [-Url "..."] [-Seed 9]
param([int]$Seed = 9, [string]$Team = '', [string]$Url = '', [int]$Fps = 30, [string]$Out = 'media\queueguard-demo.mp4')
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'cdp.ps1')
$pk = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages"
$ffmpeg = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
if (-not $ffmpeg) { $ffmpeg = Get-ChildItem $pk -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName }
$ffprobe = Join-Path (Split-Path $ffmpeg) 'ffprobe.exe'
$work = Join-Path $env:TEMP ('qg-v2-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $work | Out-Null
$base = 'file:///' + ($repo -replace '\\', '/')
$segs = New-Object System.Collections.ArrayList
function NewSeg([string]$kind) { $d = Join-Path $work ('s{0:D2}-{1}' -f $segs.Count, $kind); New-Item -ItemType Directory -Force $d | Out-Null; [void]$segs.Add($d); return $d }
function Nav([string]$url, [int]$waitMs = 1800) {
  Invoke-Cdp 'Page.navigate' @{ url = $url } | Out-Null
  Start-Sleep -Milliseconds $waitMs
  Invoke-CdpEval 'document.fonts.ready.then(function(){return 1})' | Out-Null
}
function Still([string]$url, [double]$sec, [string]$js = '') {
  $d = NewSeg 'still'; Nav $url
  if ($js) { Invoke-CdpEval $js | Out-Null; Start-Sleep -Milliseconds 400 }
  Save-CdpShot (Join-Path $d 'still.jpg'); Set-Content (Join-Path $d 'dur.txt') $sec
}
function Anim([string]$url, [double]$sec, [string]$fn = 'render') {
  $d = NewSeg 'anim'; Nav $url
  $n = [int]([math]::Round($sec * $Fps))
  for ($k = 0; $k -lt $n; $k++) {
    $t = ($k / $Fps).ToString('0.###', [Globalization.CultureInfo]::InvariantCulture)
    Invoke-CdpEval "$fn($t)" | Out-Null
    Save-CdpShot (Join-Path $d ('f{0:D5}.jpg' -f $k))
  }
}
function Cap([string]$html) { $h = $html -replace "'", "\'"; Invoke-CdpEval "QGApp.caption('$h')" | Out-Null }
function Spot($ids) {
  if (-not $ids) { Invoke-CdpEval 'QGApp.spotlight(null)' | Out-Null; return }
  $arr = '[' + (($ids | ForEach-Object { "'$_'" }) -join ',') + ']'
  Invoke-CdpEval "QGApp.spotlight($arr)" | Out-Null
}
function Sim([string]$query, $plan) {
  $d = NewSeg 'sim'; Nav "$base/index.html?record=1&$query" 2500
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

Start-CdpBrowser -Url "$base/tools/card.html?card=title"
Invoke-Cdp 'Emulation.setDeviceMetricsOverride' @{ width = 1920; height = 1080; deviceScaleFactor = 1; mobile = $false } | Out-Null
Invoke-Cdp 'Page.enable' | Out-Null
try {
  Still "$base/tools/card.html?card=title" 3.5
  Anim "$base/tools/explainer.html?t=0" 11.5
  Still "$base/tools/card.html?card=evidence" 8
  Still "$base/tools/card.html?card=method" 6
  Sim "seed=$Seed" @(
    @{ t0 = 540;  t1 = 900;  seconds = 5; spot = $null;               caption = 'Same traffic, same drivers. <b>Top: static signs only.</b> Bottom: QueueGuard.' },
    @{ t0 = 900;  t1 = 1150; seconds = 5; spot = $null;               caption = 'Demand rises above the work-zone capacity — a queue forms at the merge.' },
    @{ t0 = 1150; t1 = 1190; seconds = 6; spot = @('panel-a');        caption = 'Static signs: drivers reach the growing queue unwarned. <b>Red ring = severe conflict</b> (TTC ≤ 1 s).' },
    @{ t0 = 1190; t1 = 1450; seconds = 7; spot = @('panel-b');        caption = 'QueueGuard: radar sees the queue and estimates the tail <b>from detectors only</b>.' },
    @{ t0 = 1450; t1 = 1750; seconds = 7; spot = @('boards');         caption = 'It predicts the tail 90 s ahead and moves <b>STOPPED TRAFFIC</b> to the first board at stopping distance.' },
    @{ t0 = 1750; t1 = 2200; seconds = 7; spot = @('vsls');           caption = 'Variable speed limits step <b>100 → 80 → 60</b>, so drivers reach the tail slower.' },
    @{ t0 = 2200; t1 = 2290; seconds = 5; spot = @('panel-a');        caption = 'Static signs again: the tail has grown past them — another severe conflict.' },
    @{ t0 = 2290; t1 = 2700; seconds = 7; spot = @('uhf', 'feed');    caption = 'A UHF message for truckies is drafted and <b>confirmed by the supervisor</b>; workers get high-speed alerts.' },
    @{ t0 = 2700; t1 = 3400; seconds = 6; spot = $null;               caption = 'After the peak the queue shrinks. Boards relax only after a 60 s hold — no flicker, no false queue warnings.' },
    @{ t0 = 3400; t1 = 3400; seconds = 4; spot = @('score');          caption = 'Same hour of traffic: <b>static signs vs QueueGuard</b>.' }
  )
  Sim "seed=$Seed&failsafe=1" @(
    @{ t0 = 1700; t1 = 1880; seconds = 4; spot = $null;               caption = 'Fail-safe test: detector data is cut at 30 minutes…' },
    @{ t0 = 1880; t1 = 1960; seconds = 5; spot = @('boards', 'vsls'); caption = '…after 60 s every board shows <b>PREPARE TO STOP</b> and VSL drops to 80. A lost data link never fails silent.' }
  )
  Anim "$base/tools/card.html?card=bars&t=0" 7
  Anim "$base/tools/card.html?card=newcard&t=0" 8
  $trialJs = @'
new Promise(function (res) {
  (function wait() {
    var o = document.getElementById('trial-out');
    if (o && o.querySelector('table')) {
      o.scrollIntoView({ block: 'center' });
      var c = document.createElement('div');
      c.style.cssText = 'position:fixed;left:50%;bottom:30px;transform:translateX(-50%);background:rgba(10,12,15,0.93);border:1px solid #F5A623;color:#F2EFE8;font:26px "IBM Plex Sans",Arial,sans-serif;padding:12px 22px;border-radius:10px;z-index:9;max-width:1400px;text-align:center';
      c.innerHTML = 'Plan the site — and <b style="color:#F5A623">pre-test it</b>: a virtual trial with this site’s speed and demand, before a single sign goes out.';
      document.body.appendChild(c);
      setTimeout(function () { res(1); }, 300);
    } else setTimeout(wait, 250);
  })();
})
'@
  Still "$base/guideline.html?trial=1" 7 $trialJs
  Still "$base/tools/card.html?card=rollout" 10
  $endQ = 'card=end'
  if ($Team) { $endQ += '&team=' + [Uri]::EscapeDataString($Team) }
  if ($Url) { $endQ += '&url=' + [Uri]::EscapeDataString($Url) }
  Still "$base/tools/card.html?$endQ" 4.5
} finally { Stop-CdpBrowser }

# encode segments
$parts = @(); $durs = @()
foreach ($d in $segs) {
  $mp4 = "$d.mp4"
  if (Test-Path (Join-Path $d 'still.jpg')) {
    $sec = [double](Get-Content (Join-Path $d 'dur.txt'))
    & $ffmpeg -y -loglevel error -loop 1 -framerate $Fps -t $sec -i (Join-Path $d 'still.jpg') -c:v libx264 -pix_fmt yuv420p -r $Fps $mp4
  } else {
    & $ffmpeg -y -loglevel error -framerate $Fps -i (Join-Path $d 'f%05d.jpg') -c:v libx264 -pix_fmt yuv420p -r $Fps $mp4
  }
  $parts += $mp4
  $durs += [double](& $ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 $mp4)
}
# crossfade chain
$xf = 0.5
$inputs = @(); foreach ($p in $parts) { $inputs += '-i'; $inputs += $p }
$filter = ''; $L = $durs[0]; $prev = '[0:v]'
for ($k = 1; $k -lt $parts.Count; $k++) {
  $off = ($L - $xf).ToString('0.###', [Globalization.CultureInfo]::InvariantCulture)
  $lab = "[x$k]"
  $filter += "$prev[$($k):v]xfade=transition=fade:duration=$($xf):offset=$off$lab;"
  $prev = $lab; $L = $L + $durs[$k] - $xf
}
$filter = $filter.TrimEnd(';')
$outPath = if ([IO.Path]::IsPathRooted($Out)) { $Out } else { Join-Path $repo $Out }
New-Item -ItemType Directory -Force (Split-Path -Parent $outPath) | Out-Null
$tmpOut = Join-Path $work 'final.mp4'
& $ffmpeg -y -loglevel error @inputs -filter_complex $filter -map $prev -c:v libx264 -pix_fmt yuv420p -crf 21 -preset medium -r $Fps -movflags +faststart $tmpOut
if (-not (Test-Path $tmpOut)) { throw "Final encode failed; segments kept in $work" }
Copy-Item $tmpOut $outPath -Force
Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
Get-Item $outPath | Select-Object FullName, Length
