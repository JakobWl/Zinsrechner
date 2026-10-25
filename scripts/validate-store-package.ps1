param([string]$Version = (node -p "require('./package.json').version"))
$ErrorActionPreference = "Stop"
$project = Split-Path $PSScriptRoot -Parent
$package = Join-Path $project "release/$Version/Zinsrechner-Store-$Version-x64.appx"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($package)
try {
 $entry = $zip.GetEntry("AppxManifest.xml")
 if (!$entry) { throw "AppX manifest missing." }
 $reader = [System.IO.StreamReader]::new($entry.Open())
 try { [xml]$manifest = $reader.ReadToEnd() } finally { $reader.Dispose() }
 $identity = $manifest.Package.Identity
 if ($identity.Name -ne "Wideve.U.BBGZinsrechner") { throw "Store identity changed." }
 if ($identity.Publisher -ne "CN=2FB3D10A-81DA-44DA-AA5D-0E9816DC9FB2") { throw "Store publisher changed." }
 if ($identity.Version -ne "$Version.0") { throw "Incorrect AppX version." }
 if ($identity.ProcessorArchitecture -ne "x64") { throw "Incorrect architecture." }
 $app = $manifest.Package.Applications.Application
 if ($app.Id -ne "Wideve.U.BBGZinsrechner" -or $app.Executable -ne "zinsrechner.exe") { throw "Application identity or executable changed." }
 if (!$zip.GetEntry($app.Executable)) { throw "Application executable missing." }
 foreach ($asset in "StoreLogo.png","Square150x150Logo.png","Square44x44Logo.png","Wide310x150Logo.png") {
  if (!$zip.GetEntry("assets/$asset")) { throw "Missing tile asset: $asset" }
 }
 if (@($zip.Entries | Where-Object { $_.Name -match '^(electron|chrome|v8_context_snapshot|app.asar)' }).Count) { throw "Electron runtime found in Tauri package." }
 if (!$manifest.Package.Dependencies.ExternalDependency) { throw "WebView2 dependency missing." }
} finally { $zip.Dispose() }
# Store signs uploaded AppX packages. Local Authenticode signatures are not required for this route.
Write-Host "Store package structure and identity validated: $package"
