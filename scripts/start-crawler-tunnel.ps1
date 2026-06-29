# 관리자 PC에서 크롤러 워커(8765)를 외부에 노출합니다.
# cloudflared 설치: winget install Cloudflare.cloudflared
#
# 1) 이 스크립트 실행 → https://xxxx.trycloudflare.com URL 출력
# 2) Railway CRAWLER_WORKER_URL 에 위 URL 입력
# 3) CRAWLER_WORKER_SECRET 은 PC .env 와 Railway 에 동일하게 설정

$port = $env:CRAWLER_WORKER_PORT
if (-not $port) { $port = "8765" }

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
    Write-Host "설치 후 PowerShell 을 새로 열고 다시 실행해 주세요."
    exit 1
}

Write-Host ""
Write-Host "cloudflared: $cloudflared"
Write-Host "크롤러 워커 터널 시작 (localhost:$port)"
Write-Host "auction-api 가 npm run start:dev 로 실행 중이어야 합니다."
Write-Host "출력된 https://....trycloudflare.com URL 을 Railway CRAWLER_WORKER_URL 에 넣으세요."
Write-Host ""

& $cloudflared tunnel --url "http://127.0.0.1:$port"
