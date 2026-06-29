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

Write-Host ""
$exe = Resolve-Cloudflared
if (-not $exe) {
    Write-Host "FAIL: cloudflared not found. Run: winget install Cloudflare.cloudflared" -ForegroundColor Red
    exit 1
}

Write-Host "OK: cloudflared path:" -ForegroundColor Green
Write-Host "    $exe"
Write-Host ""
& $exe --version
Write-Host ""

$cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
if ($cmd) {
    Write-Host "OK: cloudflared command works in PATH" -ForegroundColor Green
} else {
    Write-Host "NOTE: cloudflared is not in PATH in this terminal session." -ForegroundColor Yellow
    Write-Host "      Restart Cursor completely, or use:"
    Write-Host "      powershell -File scripts/start-crawler-tunnel.ps1"
}
