# Expose local crawler worker (8765) via Cloudflare quick tunnel
# If RAILWAY_TOKEN is in .env, CRAWLER_WORKER_URL is updated automatically.

$port = $env:CRAWLER_WORKER_PORT
if (-not $port) { $port = "8765" }

$root = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $root ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
        $name, $value = $_ -split '=', 2
        if ($name -and $null -ne $value) {
            Set-Item -Path "env:$($name.Trim())" -Value $value.Trim()
        }
    }
}

function Test-WorkerPort {
    try {
        $res = Invoke-WebRequest -Uri "http://127.0.0.1:$port/health" -UseBasicParsing -TimeoutSec 2
        return $res.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Resolve-Cloudflared {
    $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $candidates = @(
        "$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe",
        "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe\cloudflared.exe",
        "$env:ProgramFiles\Cloudflare\cloudflared.exe"
    )
    foreach ($path in $candidates) {
        if (Test-Path $path) { return $path }
    }

    $wingetExe = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" `
        -Recurse -Filter "cloudflared.exe" -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
    if ($wingetExe) { return $wingetExe }

    return $null
}

$cloudflared = Resolve-Cloudflared
if (-not $cloudflared) {
    Write-Host "cloudflared not found. Run: winget install Cloudflare.cloudflared" -ForegroundColor Red
    exit 1
}

if (-not (Test-WorkerPort)) {
    Write-Host ""
    Write-Host "No crawler worker on port $port." -ForegroundColor Red
    Write-Host "Run first: powershell -File scripts/start-crawler-worker.ps1"
    exit 1
}

# Fixed URL from named tunnel config (optional)
if ($env:CRAWLER_TUNNEL_URL) {
    $fixed = $env:CRAWLER_TUNNEL_URL.Trim().TrimEnd('/')
    Write-Host ""
    Write-Host "Using fixed tunnel URL: $fixed"
    & "$PSScriptRoot\update-railway-worker-url.ps1" -Url $fixed
    Write-Host ""
    Write-Host "Starting named tunnel (config required)..."
    & $cloudflared tunnel run $env:CRAWLER_TUNNEL_NAME
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "cloudflared: $cloudflared"
Write-Host "Tunnel -> http://127.0.0.1:$port"
if ($env:RAILWAY_TOKEN) {
    Write-Host "RAILWAY_TOKEN found - will auto-update CRAWLER_WORKER_URL"
} else {
    Write-Host "Tip: set RAILWAY_TOKEN in .env for auto Railway update"
}
Write-Host ""

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $cloudflared
$psi.Arguments = "tunnel --url http://127.0.0.1:$port"
$psi.RedirectStandardError = $true
$psi.RedirectStandardOutput = $true
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $false

$process = New-Object System.Diagnostics.Process
$process.StartInfo = $psi
$null = $process.Start()

$tunnelUrl = $null
$deadline = (Get-Date).AddSeconds(45)

while ((Get-Date) -lt $deadline) {
    while ($process.StandardError.Peek() -ge 0) {
        $line = $process.StandardError.ReadLine()
        Write-Host $line
        if ($line -match '(https://[a-z0-9-]+\.trycloudflare\.com)') {
            $tunnelUrl = $matches[1]
        }
    }
    while ($process.StandardOutput.Peek() -ge 0) {
        $line = $process.StandardOutput.ReadLine()
        Write-Host $line
        if ($line -match '(https://[a-z0-9-]+\.trycloudflare\.com)') {
            $tunnelUrl = $matches[1]
        }
    }
    if ($tunnelUrl) { break }
    if ($process.HasExited) { break }
    Start-Sleep -Milliseconds 200
}

if ($tunnelUrl) {
    Write-Host ""
    Write-Host "Tunnel URL: $tunnelUrl" -ForegroundColor Green
    & "$PSScriptRoot\update-railway-worker-url.ps1" -Url $tunnelUrl
    Write-Host ""
} else {
    Write-Host "Could not detect tunnel URL from cloudflared output." -ForegroundColor Yellow
}

while (-not $process.HasExited) {
    while ($process.StandardError.Peek() -ge 0) {
        Write-Host $process.StandardError.ReadLine()
    }
    while ($process.StandardOutput.Peek() -ge 0) {
        Write-Host $process.StandardOutput.ReadLine()
    }
    Start-Sleep -Milliseconds 300
}

exit $process.ExitCode
