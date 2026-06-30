# Start Python crawler worker on port 8765 (run before tunnel)
# Use together with: npm run start:dev

$root = Split-Path $PSScriptRoot -Parent
Set-Location (Join-Path $root "crawler")

$port = $env:CRAWLER_WORKER_PORT
if (-not $port) { $port = "8765" }

$envFile = Join-Path $root ".env"
if (Test-Path $envFile) {
    $loadedKeys = @{}
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
        $name, $value = $_ -split '=', 2
        if (-not $name -or $null -eq $value) { return }
        $key = $name.Trim()
        if ($loadedKeys.ContainsKey($key)) { return }
        $loadedKeys[$key] = $true
        Set-Item -Path "env:$key" -Value $value.Trim()
    }
}

function Resolve-Python {
    if ($env:PYTHON_PATH -and (Test-Path $env:PYTHON_PATH)) { return $env:PYTHON_PATH }
    foreach ($p in @("C:\Python312\python.exe", "C:\Python311\python.exe", "C:\Python310\python.exe")) {
        if (Test-Path $p) { return $p }
    }
    return "py"
}

$python = Resolve-Python
$pyArgs = if ($python -eq "py") { @("-3", "runner.py", "serve") } else { @("runner.py", "serve") }

Write-Host ""
Write-Host "Starting crawler worker at http://127.0.0.1:$port"
Write-Host "Python: $python"
if ($env:CRAWLER_WORKER_SECRET) {
    Write-Host "CRAWLER_WORKER_SECRET: set"
}
Write-Host "Stop with Ctrl+C"
Write-Host ""

& $python @pyArgs
