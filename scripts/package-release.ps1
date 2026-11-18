$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path $root 'dist'
$null = New-Item -ItemType Directory -Force -Path $out
$archivePath = Join-Path $out 'Isolation Console.zip'
$temp = Join-Path $out ([Guid]::NewGuid().ToString() + '.zip')
Add-Type -AssemblyName System.IO.Compression.FileSystem

$files = @('Isolation Console.exe', 'LICENSE', 'README.md', 'Start-Isolation.bat', 'Setup-WSL.bat',
    'scripts/start-console.ps1', 'scripts/setup-wsl.sh', 'config/isolation.example.json',
    'package.json', 'package-lock.json')
$sourceDir = Join-Path $root 'src'
$files += Get-ChildItem -LiteralPath $sourceDir -Recurse -File | Sort-Object FullName | ForEach-Object {
    'src/' + $_.FullName.Substring($sourceDir.Length + 1).Replace('\', '/')
}
try {
    $zip = [IO.Compression.ZipFile]::Open($temp, 'Create')
    try {
        foreach ($file in $files) {
            $null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $root $file), $file)
        }
    } finally { $zip.Dispose() }
    Move-Item -Force -LiteralPath $temp -Destination $archivePath
    Write-Output $archivePath
} finally {
    if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp }
}
