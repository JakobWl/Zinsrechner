param([string]$Version = (node -p "require('./package.json').version"))
$ErrorActionPreference = "Stop"
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Store version must contain three numeric components." }
$project = Split-Path $PSScriptRoot -Parent
$binary = Join-Path $project "src-tauri/target/release/zinsrechner.exe"
if (!(Test-Path $binary)) { throw "Build the release binary first: npm run tauri -- build --no-bundle" }
$stage = Join-Path $project ".jait/artifacts/store-stage"
# Only clear this script's staging directory; never an installed application or profile.
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force "$stage/assets" | Out-Null
Copy-Item $binary "$stage/zinsrechner.exe"
foreach ($asset in "StoreLogo.png","Square150x150Logo.png","Square44x44Logo.png","Wide310x150Logo.png") {
 Copy-Item (Join-Path $project "build/appx/$asset") (Join-Path $stage "assets/$asset")
}
$template = Get-Content (Join-Path $project "build/AppxManifest.xml") -Raw
$template.Replace("__VERSION__", $Version) | Set-Content "$stage/AppxManifest.xml" -Encoding utf8
$makeappx = Get-ChildItem "${env:ProgramFiles(x86)}/Windows Kits/10/bin/*/x64/makeappx.exe" | Sort-Object FullName -Descending | Select-Object -First 1
if (!$makeappx) { throw "Windows SDK MakeAppx.exe was not found." }
$out = Join-Path $project "release/$Version"
New-Item -ItemType Directory -Force $out | Out-Null
$package = Join-Path $out "Zinsrechner-Store-$Version-x64.appx"
& $makeappx.FullName pack /o /d $stage /p $package
if ($LASTEXITCODE -ne 0) { throw "MakeAppx failed ($LASTEXITCODE)." }
& "$PSScriptRoot/validate-store-package.ps1" -Version $Version
if ($LASTEXITCODE -ne 0) { throw "Store validation failed." }
Get-Item $package | Select-Object FullName, Length
