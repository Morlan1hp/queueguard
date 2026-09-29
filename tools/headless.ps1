# Runs a page of this repo in headless Microsoft Edge and prints the text of #out.
# Usage: powershell -File tools\headless.ps1 -Page tools/smoke.html -Query "seeds=1,2" [-Budget 600000]
param(
  [Parameter(Mandatory = $true)][string]$Page,
  [string]$Query = '',
  [int]$Budget = 600000,
  [string]$OutFile = ''
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$edge = @('C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
          'C:\Program Files\Microsoft\Edge\Application\msedge.exe') | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw 'Microsoft Edge not found' }
$url = 'file:///' + (($repo -replace '\\', '/') + '/' + $Page)
if ($Query) { $url += '?' + $Query }
$tmp = Join-Path $env:TEMP ('qg-edge-' + [guid]::NewGuid().ToString('N'))
$out = Join-Path $env:TEMP ('qg-dom-' + [guid]::NewGuid().ToString('N') + '.html')
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $edge
$psi.Arguments = "--headless --disable-gpu --no-first-run --user-data-dir=`"$tmp`" --virtual-time-budget=$Budget --dump-dom `"$url`""
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true          # Edge logs harmless errors to stderr; keep them out of the caller
$psi.UseShellExecute = $false
$psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
$p = [System.Diagnostics.Process]::Start($psi)
$errTask = $p.StandardError.ReadToEndAsync()
$dom = $p.StandardOutput.ReadToEnd()
$p.WaitForExit()
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
$m = [regex]::Match($dom, '(?s)<pre id="out"[^>]*>(.*?)</pre>')
$text = if ($m.Success) { [System.Net.WebUtility]::HtmlDecode($m.Groups[1].Value) } else { $dom }
if ($OutFile) { [IO.File]::WriteAllText($OutFile, $text, (New-Object System.Text.UTF8Encoding($false))) } else { $text }
