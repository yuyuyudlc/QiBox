$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskUtf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $taskUtf8
$OutputEncoding = $taskUtf8

try {
    $appPath = Join-Path $taskRoot 'Isolation Console.exe'
    if (-not (Test-Path -LiteralPath $appPath -PathType Leaf)) { throw "Missing program: $appPath" }
    $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
    $nodeVersion = (& $nodePath -p "process.versions.node" 2>$null | Out-String).Trim()
    if (-not $nodeVersion -or ([int]($nodeVersion.Split('.')[0]) -lt 22)) {
        throw "Node.js 22+ is required (found: $nodeVersion). Please install Node.js 24."
    }
    $null = (Get-Command wsl.exe -ErrorAction Stop).Source
    Write-Host '[1/2] Checking WSL2...'
    $env:WSL_UTF8 = '1'
    $wslOutput = & wsl.exe --list --verbose 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "WSL2 check failed: $($wslOutput -join ' ')"
    }
    Write-Host '[2/2] Starting Isolation Console...'
    Start-Process -FilePath $appPath -WorkingDirectory $taskRoot
} catch {
    Write-Host ''
    Write-Host ("Startup failed: " + $_.Exception.Message) -ForegroundColor Red
    Read-Host 'Press Enter to exit'
    exit 1
}
