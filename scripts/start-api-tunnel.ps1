# (선택) 운영 웹 크롤 시 로컬 DB mirror 용 — API(3001) 터널
# Railway CRAWLER_MIRROR_URL=https://xxxx.trycloudflare.com/crawler/import-item

$port = $env:PORT
if (-not $port) { $port = "3001" }

function Resolve-Cloudflared {
    $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $candidates = @(
        "$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe",
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
    Write-Host "cloudflared 를 찾을 수 없습니다." -ForegroundColor Red
    Write-Host "  winget install Cloudflare.cloudflared"
    exit 1
}

Write-Host ""
Write-Host "cloudflared: $cloudflared"
Write-Host "API 터널 시작 (localhost:$port)"
Write-Host "Railway CRAWLER_MIRROR_URL = <출력 URL>/crawler/import-item"
Write-Host ""

& $cloudflared tunnel --url "http://127.0.0.1:$port"
