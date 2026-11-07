param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 8765
)

$ErrorActionPreference = 'Stop'
$script:LogPath = Join-Path $PSScriptRoot 'launcher.log'
$script:Root = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$script:RootPrefix = $script:Root
if (-not $script:RootPrefix.EndsWith([System.IO.Path]::DirectorySeparatorChar.ToString())) {
    $script:RootPrefix += [System.IO.Path]::DirectorySeparatorChar
}

function Write-Log {
    param(
        [Parameter(Mandatory = $true)][string]$Message,
        [ValidateSet('INFO', 'WARN', 'ERROR')][string]$Level = 'INFO'
    )
    $line = '[{0}] [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Write-Host $line
    try {
        Add-Content -LiteralPath $script:LogPath -Value $line -Encoding UTF8 -ErrorAction Stop
    }
    catch {
        Write-Host ('[WARN] Could not write launcher.log: ' + $_.Exception.Message) -ForegroundColor Yellow
    }
}

function Send-Response {
    param(
        [Parameter(Mandatory = $true)][System.IO.Stream]$Stream,
        [Parameter(Mandatory = $true)][int]$Status,
        [Parameter(Mandatory = $true)][string]$Reason,
        [Parameter(Mandatory = $true)][string]$ContentType,
        [byte[]]$Body = $null,
        [bool]$HeadOnly = $false
    )

    if ($null -eq $Body) { $Body = [byte[]]@() }
    $header = "HTTP/1.1 $Status $Reason`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nConnection: close`r`nCache-Control: no-cache`r`nX-Content-Type-Options: nosniff`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
    $Stream.Write($headerBytes, 0, $headerBytes.Length)
    if (-not $HeadOnly -and $Body.Length -gt 0) {
        $Stream.Write($Body, 0, $Body.Length)
    }
    $Stream.Flush()
}

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.htm'  = 'text/html; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.mjs'  = 'text/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.map'  = 'application/json; charset=utf-8'
    '.txt'  = 'text/plain; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.webp' = 'image/webp'
    '.gif'  = 'image/gif'
    '.ico'  = 'image/x-icon'
    '.woff' = 'font/woff'
    '.woff2'= 'font/woff2'
}

$listener = $null
$exitCode = 0

try {
    if (-not (Test-Path -LiteralPath (Join-Path $script:Root 'index.html') -PathType Leaf)) {
        throw 'index.html is missing. Extract the entire ZIP and keep all game files together.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $script:Root 'game.js') -PathType Leaf)) {
        throw 'game.js is missing. Extract the entire ZIP again.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $script:Root 'style.css') -PathType Leaf)) {
        throw 'style.css is missing. Extract the entire ZIP again.'
    }

    # Start with a fresh log, then append all important startup/runtime messages.
    try {
        Set-Content -LiteralPath $script:LogPath -Value ('NEON DISTRICT launcher log - ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) -Encoding UTF8 -ErrorAction Stop
    }
    catch {
        Write-Host ('[WARN] Could not initialize launcher.log: ' + $_.Exception.Message) -ForegroundColor Yellow
    }

    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    try {
        $listener.Start()
    }
    catch {
        if ($_.Exception.ToString() -match '10048|Only one usage|address already in use') {
            throw "Port $Port is already in use. Close the other app using port $Port, or restart Windows and try again."
        }
        throw ('Could not start the local server on port ' + $Port + ': ' + $_.Exception.Message)
    }

    $url = "http://127.0.0.1:$Port/"
    Write-Log 'NEON DISTRICT 3D server started.'
    Write-Log ('Game folder: ' + $script:Root)
    Write-Log ('Local URL: ' + $url)
    Write-Log 'Keep this window open while playing. Press Ctrl+C to stop the server.'

    try {
        Start-Process -FilePath $url -ErrorAction Stop | Out-Null
        Write-Log 'Requested the default browser to open the game.'
    }
    catch {
        Write-Log -Message ('Could not open the browser automatically: ' + $_.Exception.Message) -Level 'WARN'
        Write-Host ('Open this address manually: ' + $url) -ForegroundColor Yellow
    }

    while ($true) {
        # Accept errors are fatal; per-request errors are handled inside the client block.
        $client = $listener.AcceptTcpClient()
        $stream = $null
        $reader = $null
        try {
            $client.ReceiveTimeout = 5000
            $client.SendTimeout = 5000
            $stream = $client.GetStream()
            $stream.ReadTimeout = 5000
            $stream.WriteTimeout = 5000
            $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
            $requestLine = $reader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($requestLine)) { continue }

            # Consume request headers; this small local server serves static files only.
            while ($true) {
                $headerLine = $reader.ReadLine()
                if ($null -eq $headerLine -or $headerLine.Length -eq 0) { break }
            }

            $parts = $requestLine -split '\s+'
            if ($parts.Length -lt 2) {
                $body = [System.Text.Encoding]::UTF8.GetBytes('400 Bad Request')
                Send-Response -Stream $stream -Status 400 -Reason 'Bad Request' -ContentType 'text/plain; charset=utf-8' -Body $body
                continue
            }

            $method = $parts[0].ToUpperInvariant()
            $headOnly = $method -eq 'HEAD'
            if ($method -ne 'GET' -and $method -ne 'HEAD') {
                $body = [System.Text.Encoding]::UTF8.GetBytes('405 Method Not Allowed')
                Send-Response -Stream $stream -Status 405 -Reason 'Method Not Allowed' -ContentType 'text/plain; charset=utf-8' -Body $body -HeadOnly $headOnly
                continue
            }

            $rawPath = ($parts[1] -split '\?')[0]
            $urlPath = [System.Uri]::UnescapeDataString($rawPath)
            if ($urlPath -eq '/') { $urlPath = '/index.html' }
            $relative = $urlPath.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
            $filePath = [System.IO.Path]::GetFullPath((Join-Path $script:RootPrefix $relative))

            if (-not $filePath.StartsWith($script:RootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                $body = [System.Text.Encoding]::UTF8.GetBytes('403 Forbidden')
                Send-Response -Stream $stream -Status 403 -Reason 'Forbidden' -ContentType 'text/plain; charset=utf-8' -Body $body -HeadOnly $headOnly
                continue
            }

            if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
                $body = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
                Send-Response -Stream $stream -Status 404 -Reason 'Not Found' -ContentType 'text/plain; charset=utf-8' -Body $body -HeadOnly $headOnly
                continue
            }

            $body = [System.IO.File]::ReadAllBytes($filePath)
            $extension = [System.IO.Path]::GetExtension($filePath).ToLowerInvariant()
            $contentType = if ($mime.ContainsKey($extension)) { $mime[$extension] } else { 'application/octet-stream' }
            Send-Response -Stream $stream -Status 200 -Reason 'OK' -ContentType $contentType -Body $body -HeadOnly $headOnly
        }
        catch {
            Write-Log -Message ('Request error: ' + $_.Exception.Message) -Level 'WARN'
            if ($null -ne $stream) {
                try {
                    $body = [System.Text.Encoding]::UTF8.GetBytes('500 Internal Server Error')
                    Send-Response -Stream $stream -Status 500 -Reason 'Internal Server Error' -ContentType 'text/plain; charset=utf-8' -Body $body
                }
                catch { }
            }
        }
        finally {
            if ($null -ne $reader) { $reader.Dispose() }
            if ($null -ne $stream) { $stream.Dispose() }
            if ($null -ne $client) { $client.Close() }
        }
    }
}
catch {
    $exitCode = 1
    $errorMessage = $_.Exception.Message
    Write-Log -Message ('FATAL: ' + $errorMessage) -Level 'ERROR'
    Write-Host ''
    Write-Host 'The game server could not continue.' -ForegroundColor Red
    Write-Host ('Reason: ' + $errorMessage) -ForegroundColor Yellow
    Write-Host ('Log file: ' + $script:LogPath) -ForegroundColor Yellow
    Write-Host 'If port 8765 is already in use, close the other program using it and try again.' -ForegroundColor Gray
}
finally {
    if ($null -ne $listener) {
        try { $listener.Stop() } catch { }
    }
}

if ($exitCode -ne 0) { exit $exitCode }
exit 0
