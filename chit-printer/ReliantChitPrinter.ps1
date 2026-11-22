# Reliant Chit Printer (Windows)
# Runs quietly in the background and prints Ticket System chits straight to the chit printer,
# with no print window. It only listens on this computer (127.0.0.1) and only accepts chits
# from the Reliant Ticket System page.
#
#   Install (and start):  double-click "Install Reliant Chit Printer.bat"
#   Remove:               powershell -ExecutionPolicy Bypass -File ReliantChitPrinter.ps1 -Uninstall
#   Check it is running:  open http://127.0.0.1:17861 in a browser on this computer

param([switch]$Install, [switch]$Uninstall)

$Version = '1.0.0'
$Port = 17861
$AllowedOrigins = @('https://reliant-main.github.io')
$AppDir = Join-Path $env:LOCALAPPDATA 'ReliantChitPrinter'
$ScriptName = 'ReliantChitPrinter.ps1'
$ShortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'Reliant Chit Printer.lnk'
$SettingsPath = Join-Path $AppDir 'settings.json'
$LogPath = Join-Path $AppDir 'chit-printer.log'

Add-Type -AssemblyName System.Drawing

function Write-Log([string]$m) {
  try {
    if ((Test-Path $LogPath) -and ((Get-Item $LogPath).Length -gt 1MB)) { Move-Item $LogPath ($LogPath + '.old') -Force }
    Add-Content -Path $LogPath -Value ('{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $m)
  } catch {}
}

function Get-Printers { @([System.Drawing.Printing.PrinterSettings]::InstalledPrinters) }

function Get-ChitPrinter {
  if (Test-Path $SettingsPath) {
    try { $c = Get-Content $SettingsPath -Raw | ConvertFrom-Json; if ($c.printer) { return [string]$c.printer } } catch {}
  }
  foreach ($n in Get-Printers) { if ($n -match 'TSP|Star') { return $n } }
  return (New-Object System.Drawing.Printing.PrinterSettings).PrinterName
}

function Stop-OtherCopies {
  try {
    Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
      Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like "*$ScriptName*" -and $_.CommandLine -notlike '*-Install*' } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  } catch {}
}

# ------------------------------------------------------------------ install / remove
if ($Uninstall) {
  Stop-OtherCopies
  Remove-Item $ShortcutPath -Force -ErrorAction SilentlyContinue
  Write-Host 'Reliant Chit Printer is stopped and will no longer start with Windows.'
  exit
}

if ($Install) {
  Write-Host ''
  Write-Host "Installing Reliant Chit Printer $Version" -ForegroundColor Cyan
  New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
  Stop-OtherCopies
  Start-Sleep -Milliseconds 500
  Copy-Item -Path $MyInvocation.MyCommand.Path -Destination (Join-Path $AppDir $ScriptName) -Force
  Unblock-File -Path (Join-Path $AppDir $ScriptName) -ErrorAction SilentlyContinue

  # Pick the chit printer
  $printers = Get-Printers
  $pick = $null
  foreach ($n in $printers) { if ($n -match 'TSP|Star') { $pick = $n; break } }
  Write-Host ''
  Write-Host 'Printers on this computer:'
  for ($i = 0; $i -lt $printers.Count; $i++) { Write-Host ("  {0}. {1}" -f ($i + 1), $printers[$i]) }
  Write-Host ''
  if ($pick) {
    Write-Host "Chits will print on: $pick" -ForegroundColor Green
    $ans = Read-Host 'Press Enter to keep it, or type the number of a different printer'
  } else {
    $ans = Read-Host 'Type the number of the chit printer (the Star TSP700II)'
  }
  if ($ans -match '^\d+$' -and [int]$ans -ge 1 -and [int]$ans -le $printers.Count) { $pick = $printers[[int]$ans - 1] }
  if (-not $pick) { Write-Host 'No printer picked. Run the installer again.' -ForegroundColor Red; Read-Host 'Press Enter to close'; exit }
  @{ printer = $pick } | ConvertTo-Json | Set-Content -Path $SettingsPath -Encoding UTF8

  # Start with Windows (hidden)
  $target = Join-Path $AppDir $ScriptName
  $runArgs = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$target`""
  $ws = New-Object -ComObject WScript.Shell
  $lnk = $ws.CreateShortcut($ShortcutPath)
  $lnk.TargetPath = 'powershell.exe'
  $lnk.Arguments = $runArgs
  $lnk.WindowStyle = 7
  $lnk.WorkingDirectory = $AppDir
  $lnk.Save()

  # Start it now
  Start-Process -FilePath 'powershell.exe' -ArgumentList $runArgs -WindowStyle Hidden
  Start-Sleep -Seconds 2
  $ok = $false
  try { $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/" -TimeoutSec 5; $ok = $r.StatusCode -eq 200 } catch {}
  Write-Host ''
  if ($ok) {
    Write-Host 'Done. Reliant Chit Printer is running and will start by itself when Windows starts.' -ForegroundColor Green
    Write-Host 'Next: reload the Ticket System page, tick "This computer prints chits", then click Reprint last chit.'
  } else {
    Write-Host "Installed, but it didn't answer yet. Restart the computer, then check http://127.0.0.1:$Port" -ForegroundColor Yellow
  }
  Write-Host ''
  Read-Host 'Press Enter to close'
  exit
}

# ------------------------------------------------------------------ printing
function Send-ChitToPrinter([byte[]]$png, [double]$wIn, [double]$hIn, [string]$printer) {
  $ms = New-Object System.IO.MemoryStream(, $png)
  $img = [System.Drawing.Image]::FromStream($ms)
  $doc = New-Object System.Drawing.Printing.PrintDocument
  try {
    $doc.PrinterSettings.PrinterName = $printer
    if (-not $doc.PrinterSettings.IsValid) { throw "Printer '$printer' isn't on this computer" }
    $doc.DocumentName = 'Reliant chit'
    $doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController
    $w = [int][math]::Round($wIn * 100); $h = [int][math]::Round($hIn * 100)

    # Use the printer's own paper size for this chit (e.g. the "Chit 2x1" form) if there is one.
    $match = $null; $land = $false
    foreach ($ps in $doc.PrinterSettings.PaperSizes) {
      if ([math]::Abs($ps.Width - $w) -le 6 -and [math]::Abs($ps.Height - $h) -le 6) { $match = $ps; break }
    }
    if (-not $match) {
      foreach ($ps in $doc.PrinterSettings.PaperSizes) {
        if ([math]::Abs($ps.Width - $h) -le 6 -and [math]::Abs($ps.Height - $w) -le 6) { $match = $ps; $land = $true; break }
      }
    }
    if (-not $match) { $match = New-Object System.Drawing.Printing.PaperSize('Reliant chit', $w, $h) }
    $doc.DefaultPageSettings.PaperSize = $match
    $doc.DefaultPageSettings.Landscape = $land
    $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
    $doc.OriginAtMargins = $false

    $script:chitImg = $img; $script:chitW = $w; $script:chitH = $h
    $doc.add_PrintPage({
      param($s, $e)
      $g = $e.Graphics
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
      $g.TranslateTransform(-$e.PageSettings.HardMarginX, -$e.PageSettings.HardMarginY)
      $g.DrawImage($script:chitImg, (New-Object System.Drawing.RectangleF(0, 0, $script:chitW, $script:chitH)))
      $e.HasMorePages = $false
    })
    $doc.Print()
  } finally {
    $doc.Dispose(); $img.Dispose(); $ms.Dispose()
  }
}

# ------------------------------------------------------------------ tiny web server (this computer only)
function Send-Response($stream, [int]$code, [string]$type, [string]$text, [string]$origin) {
  $reason = @{ 200 = 'OK'; 204 = 'No Content'; 400 = 'Bad Request'; 403 = 'Forbidden'; 404 = 'Not Found'; 413 = 'Too Large'; 500 = 'Error' }[$code]
  $body = [System.Text.Encoding]::UTF8.GetBytes($text)
  $h = "HTTP/1.1 $code $reason`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n"
  if ($origin) {
    $h += "Access-Control-Allow-Origin: $origin`r`nVary: Origin`r`nAccess-Control-Allow-Methods: GET, POST, OPTIONS`r`n"
    $h += "Access-Control-Allow-Headers: Content-Type`r`nAccess-Control-Allow-Private-Network: true`r`nAccess-Control-Max-Age: 600`r`n"
  }
  $h += "`r`n"
  $hb = [System.Text.Encoding]::ASCII.GetBytes($h)
  $stream.Write($hb, 0, $hb.Length)
  if ($body.Length) { $stream.Write($body, 0, $body.Length) }
  $stream.Flush()
}

function Read-Request($client) {
  $client.ReceiveTimeout = 5000
  $st = $client.GetStream()
  $buf = New-Object byte[] 65536
  $data = New-Object System.IO.MemoryStream
  $headEnd = -1
  while ($headEnd -lt 0) {
    $n = $st.Read($buf, 0, $buf.Length)
    if ($n -le 0) { return $null }
    $data.Write($buf, 0, $n)
    if ($data.Length -gt 65536 * 4) { return $null }
    $headEnd = [System.Text.Encoding]::ASCII.GetString($data.ToArray()).IndexOf("`r`n`r`n")
  }
  $all = $data.ToArray()
  $lines = [System.Text.Encoding]::ASCII.GetString($all, 0, $headEnd) -split "`r`n"
  $first = $lines[0] -split ' '
  $hdr = @{}
  foreach ($l in ($lines | Select-Object -Skip 1)) {
    $i = $l.IndexOf(':')
    if ($i -gt 0) { $hdr[$l.Substring(0, $i).Trim().ToLower()] = $l.Substring($i + 1).Trim() }
  }
  $len = 0
  if ($hdr.ContainsKey('content-length')) { $len = [int]$hdr['content-length'] }
  $body = New-Object System.IO.MemoryStream
  $start = $headEnd + 4
  if ($all.Length -gt $start) { $body.Write($all, $start, $all.Length - $start) }
  while ($body.Length -lt $len -and $len -le 4MB) {
    $n = $st.Read($buf, 0, $buf.Length)
    if ($n -le 0) { break }
    $body.Write($buf, 0, $n)
  }
  return @{ Stream = $st; Method = $first[0]; Path = $first[1]; Headers = $hdr; Length = $len
            Body = [System.Text.Encoding]::UTF8.GetString($body.ToArray()) }
}

function Handle-Request($req) {
  $st = $req.Stream
  $origin = $req.Headers['origin']
  $okOrigin = $origin -and ($AllowedOrigins -contains $origin)
  $replyTo = if ($okOrigin) { $origin } else { $null }
  $path = ($req.Path -split '\?')[0]

  if ($req.Method -eq 'OPTIONS') {
    if ($okOrigin) { Send-Response $st 204 'text/plain' '' $origin } else { Send-Response $st 403 'text/plain' 'Not allowed' $null }
    return
  }
  if ($req.Method -eq 'GET' -and $path -eq '/') {
    $p = [System.Net.WebUtility]::HtmlEncode((Get-ChitPrinter))
    Send-Response $st 200 'text/html; charset=utf-8' "<!doctype html><meta charset=utf-8><title>Reliant Chit Printer</title><body style='font:16px Segoe UI,Arial;padding:24px'><h2>Reliant Chit Printer is running</h2><p>Version $Version. Chits print on <b>$p</b>.</p></body>" $replyTo
    return
  }
  if ($origin -and -not $okOrigin) { Send-Response $st 403 'text/plain' 'Not allowed' $null; return }
  if ($req.Method -eq 'GET' -and $path -eq '/status') {
    $j = @{ ok = $true; app = 'reliant-chit-printer'; version = $Version; printer = (Get-ChitPrinter) } | ConvertTo-Json -Compress
    Send-Response $st 200 'application/json' $j $replyTo
    return
  }
  if ($req.Method -eq 'POST' -and $path -eq '/print') {
    if (-not $okOrigin) { Send-Response $st 403 'text/plain' 'Not allowed' $null; return }
    if ($req.Length -gt 4MB) { Send-Response $st 413 'application/json' '{"ok":false,"error":"Chit too large"}' $replyTo; return }
    try {
      $j = $req.Body | ConvertFrom-Json
      $png = [Convert]::FromBase64String([string]$j.png)
      $printer = Get-ChitPrinter
      Send-ChitToPrinter $png ([double]$j.width) ([double]$j.height) $printer
      Send-Response $st 200 'application/json' (@{ ok = $true; printer = $printer } | ConvertTo-Json -Compress) $replyTo
    } catch {
      $msg = $_.Exception.Message
      Write-Log "Print failed: $msg"
      Send-Response $st 500 'application/json' (@{ ok = $false; error = $msg } | ConvertTo-Json -Compress) $replyTo
    }
    return
  }
  Send-Response $st 404 'text/plain' 'Not found' $replyTo
}

New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
try { $listener.Start() } catch { Write-Log "Port $Port is busy (another copy is probably running). Exiting."; exit }
Write-Log "Started version $Version. Chit printer: $(Get-ChitPrinter)"

while ($true) {
  $client = $null
  try {
    $client = $listener.AcceptTcpClient()
    $req = Read-Request $client
    if ($req) { Handle-Request $req }
  } catch {
    Write-Log "Error: $($_.Exception.Message)"
  } finally {
    if ($client) { $client.Close() }
  }
}
