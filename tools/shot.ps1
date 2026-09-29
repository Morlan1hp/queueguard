# Screenshot a page of this repo with headless Edge.
# Usage: powershell -File tools\shot.ps1 -Page index.html -Query "record=1&t=1500&seed=3" -Out shots\a.png [-Width 1920 -Height 1080]
param(
  [Parameter(Mandatory = $true)][string]$Page,
  [string]$Query = '',
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Width = 1920, [int]$Height = 1080, [int]$Budget = 15000
)
$repo = Split-Path -Parent $PSScriptRoot
$edge = @('C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
          'C:\Program Files\Microsoft\Edge\Application\msedge.exe') | Where-Object { Test-Path $_ } | Select-Object -First 1
$url = 'file:///' + (($repo -replace '\\', '/') + '/' + $Page)
if ($Query) { $url += '?' + $Query }
if (-not [System.IO.Path]::IsPathRooted($Out)) { $Out = Join-Path $repo $Out }
New-Item -ItemType Directory -Force (Split-Path -Parent $Out) | Out-Null
$tmp = Join-Path $env:TEMP ('qg-edge-' + [guid]::NewGuid().ToString('N'))
$args = @('--headless', '--disable-gpu', '--no-first-run', '--hide-scrollbars', "--user-data-dir=`"$tmp`"",
  "--window-size=$Width,$Height", "--virtual-time-budget=$Budget", "--screenshot=`"$Out`"", "`"$url`"")
$p = Start-Process -FilePath $edge -ArgumentList $args -Wait -PassThru -WindowStyle Hidden
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
Get-Item $Out | Select-Object FullName, Length
