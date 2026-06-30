param(
    [Parameter(Mandatory = $true)]
    [string]$Url
)

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

$url = $Url.Trim().TrimEnd('/')
if ($url -notmatch '^https://') {
    Write-Host "Invalid URL: $url" -ForegroundColor Red
    exit 1
}

$tunnelFile = Join-Path $root "data\crawler\tunnel-url.txt"
$tunnelDir = Split-Path $tunnelFile -Parent
if (-not (Test-Path $tunnelDir)) {
    New-Item -ItemType Directory -Path $tunnelDir -Force | Out-Null
}
Set-Content -Path $tunnelFile -Value $url -Encoding UTF8

$token = $env:RAILWAY_TOKEN
if (-not $token) {
    Write-Host ""
    Write-Host "RAILWAY_TOKEN not set - skipped auto update." -ForegroundColor Yellow
    Write-Host "Saved URL to data/crawler/tunnel-url.txt"
    Write-Host "Set Railway CRAWLER_WORKER_URL manually:"
    Write-Host "  $url"
    exit 0
}

Write-Host ""
Write-Host "Updating Railway CRAWLER_WORKER_URL ..." -ForegroundColor Cyan
Write-Host "  $url"

$cliArgs = @("variables", "--set", "CRAWLER_WORKER_URL=$url")
if ($env:RAILWAY_SERVICE_ID) {
    $cliArgs += @("--service", $env:RAILWAY_SERVICE_ID)
}
if ($env:RAILWAY_ENVIRONMENT_ID) {
    $cliArgs += @("--environment", $env:RAILWAY_ENVIRONMENT_ID)
}

$prevToken = $env:RAILWAY_TOKEN
$env:RAILWAY_TOKEN = $token

try {
    Push-Location $root
    & npx --yes @railway/cli @cliArgs 2>&1 | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Railway variable updated." -ForegroundColor Green
    } else {
        Write-Host "Railway CLI failed. Set manually in dashboard:" -ForegroundColor Yellow
        Write-Host "  CRAWLER_WORKER_URL=$url"
    }
} catch {
    Write-Host "Railway update error: $_" -ForegroundColor Red
    Write-Host "Set manually: CRAWLER_WORKER_URL=$url"
} finally {
    $env:RAILWAY_TOKEN = $prevToken
    Pop-Location
}
