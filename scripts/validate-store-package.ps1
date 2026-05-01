param(
  [string]$Version = (node -p "require('./package.json').version")
)

$ErrorActionPreference = "Stop"

$releaseDir = Join-Path $PSScriptRoot "..\release\$Version"
$installer = Join-Path $releaseDir "Zinsrechner-Setup-$Version-x64.exe"
$unpackedDir = Join-Path $releaseDir "win-unpacked"

if (!(Test-Path -LiteralPath $installer)) {
  throw "Installer not found: $installer"
}

if (!(Test-Path -LiteralPath $unpackedDir)) {
  throw "Unpacked app directory not found: $unpackedDir"
}

$files = @()
$files += Get-Item -LiteralPath $installer
$files += Get-ChildItem -LiteralPath $unpackedDir -Recurse -File -Include *.exe, *.dll

$unsigned = @()

foreach ($file in $files) {
  $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
  if ($signature.Status -ne "Valid") {
    $unsigned += [PSCustomObject]@{
      Path = $file.FullName
      Status = $signature.Status
    }
  }
}

if ($unsigned.Count -gt 0) {
  $unsigned | Format-Table -AutoSize | Out-String | Write-Host
  throw "Store package validation failed: all EXE/DLL files must have valid Authenticode signatures."
}

Write-Host "Store package validation passed for version $Version."
