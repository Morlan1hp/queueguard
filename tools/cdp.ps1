# Minimal Chrome DevTools Protocol client for headless Microsoft Edge (Windows PowerShell 5.1).
# Dot-source it:  . .\tools\cdp.ps1
Add-Type -AssemblyName System.Net.Http

function Start-CdpBrowser([string]$Url, [int]$Port = 9333, [int]$Width = 1920, [int]$Height = 1080) {
  $edge = @('C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
            'C:\Program Files\Microsoft\Edge\Application\msedge.exe') | Where-Object { Test-Path $_ } | Select-Object -First 1
  $script:CdpProfile = Join-Path $env:TEMP ('qg-cdp-' + [guid]::NewGuid().ToString('N'))
  $args = @('--headless', '--disable-gpu', '--no-first-run', '--hide-scrollbars', "--remote-debugging-port=$Port",
            "--user-data-dir=`"$script:CdpProfile`"", "--window-size=$Width,$Height", "`"$Url`"")
  $script:CdpProc = Start-Process -FilePath $edge -ArgumentList $args -PassThru -WindowStyle Hidden
  $list = $null
  for ($i = 0; $i -lt 60 -and -not $list; $i++) {
    Start-Sleep -Milliseconds 250
    try { $list = Invoke-RestMethod "http://127.0.0.1:$Port/json/list" -TimeoutSec 2 } catch {}
  }
  $page = @($list | Where-Object { $_.type -eq 'page' })[0]
  $script:CdpWs = New-Object System.Net.WebSockets.ClientWebSocket
  $script:CdpWs.Options.KeepAliveInterval = [TimeSpan]::FromSeconds(30)
  $script:CdpWs.ConnectAsync([Uri]$page.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait()
  $script:CdpId = 0
  $script:CdpBuf = New-Object byte[] (1024 * 1024)
}

function Invoke-Cdp([string]$Method, $Params = @{}) {
  $script:CdpId++
  $id = $script:CdpId
  $msg = @{ id = $id; method = $Method; params = $Params } | ConvertTo-Json -Depth 10 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($msg)
  $seg = New-Object 'System.ArraySegment[byte]' -ArgumentList @(, $bytes)
  $script:CdpWs.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).Wait()
  while ($true) {
    $ms = New-Object System.IO.MemoryStream
    do {
      $rseg = New-Object 'System.ArraySegment[byte]' -ArgumentList @(, $script:CdpBuf)
      $res = $script:CdpWs.ReceiveAsync($rseg, [Threading.CancellationToken]::None).Result
      $ms.Write($script:CdpBuf, 0, $res.Count)
    } while (-not $res.EndOfMessage)
    $text = [Text.Encoding]::UTF8.GetString($ms.ToArray())
    if ($text.StartsWith('{"id":' + $id + ',')) {
      $obj = $text | ConvertFrom-Json
      if ($obj.error) { throw "CDP $Method failed: $($obj.error.message)" }
      return $obj.result
    }
  }
}

function Invoke-CdpEval([string]$Expression) {
  $r = Invoke-Cdp 'Runtime.evaluate' @{ expression = $Expression; awaitPromise = $true; returnByValue = $true }
  if ($r.exceptionDetails) { throw "JS error: $($r.exceptionDetails.exception.description)" }
  return $r.result.value
}

function Save-CdpShot([string]$Path, [int]$Quality = 92) {
  $r = Invoke-Cdp 'Page.captureScreenshot' @{ format = 'jpeg'; quality = $Quality }
  [IO.File]::WriteAllBytes($Path, [Convert]::FromBase64String($r.data))
}

function Stop-CdpBrowser {
  try { $script:CdpWs.Dispose() } catch {}
  try { Stop-Process -Id $script:CdpProc.Id -Force -ErrorAction SilentlyContinue } catch {}
  Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like "*$script:CdpProfile*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 500
  Remove-Item -Recurse -Force $script:CdpProfile -ErrorAction SilentlyContinue
}
