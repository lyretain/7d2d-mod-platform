param(
  [string]$OutputDir = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $OutputDir) { $OutputDir = Join-Path $root "artifacts\launcher" }
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$node = (Get-Command node -ErrorAction Stop).Source
Copy-Item $node -Destination (Join-Path $OutputDir "node.exe") -Force
Copy-Item (Join-Path $root "apps") -Destination (Join-Path $OutputDir "apps") -Recurse -Force
Copy-Item (Join-Path $root "package.json") -Destination (Join-Path $OutputDir "package.json") -Force

@'
@echo off
setlocal
cd /d "%~dp0"
"%~dp0node.exe" "apps\launcher\src\cli.js" %*
'@ | Set-Content -LiteralPath (Join-Path $OutputDir "ModPlatformLauncher.cmd") -Encoding ASCII

$stub = @'
using System;
using System.Diagnostics;
using System.IO;
class Launcher {
  static int Main(string[] args) {
    var root = AppDomain.CurrentDomain.BaseDirectory;
    var node = Path.Combine(root, "node.exe");
    var script = Path.Combine(root, "apps", "launcher", "src", "cli.js");
    var start = new ProcessStartInfo(node, "\"" + script + "\" " + string.Join(" ", args));
    start.UseShellExecute = false;
    start.WorkingDirectory = root;
    using (var process = Process.Start(start)) {
      process.WaitForExit();
      return process.ExitCode;
    }
  }
}
'@
$stubFile = Join-Path $OutputDir "LauncherStub.cs"
Set-Content -LiteralPath $stubFile -Value $stub -Encoding ASCII
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (Test-Path -LiteralPath $csc) {
  $exe = Join-Path $OutputDir "ModPlatformLauncher.exe"
  & $csc /nologo /target:exe "/out:$exe" $stubFile
  if ($LASTEXITCODE -ne 0) { throw "Launcher stub compilation failed." }
}
$version = "0.3.0"
$pkg = Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json
if ($pkg.version) { $version = $pkg.version }
@{ version = $version; builtAt = (Get-Date).ToUniversalTime().ToString("o") } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDir "launcher-version.json") -Encoding UTF8

$zip = Join-Path (Split-Path $OutputDir) "ModPlatformLauncher-$version-win32.zip"
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -Path (Join-Path $OutputDir "*") -DestinationPath $zip -Force
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host "Portable launcher folder: $OutputDir"
Write-Host "Signed-update ZIP: $zip"
Write-Host "SHA-256: $hash"
Write-Host "Publish with POST /api/v1/admin/launcher after uploading this ZIP as an artifact."
Write-Host "This folder includes node.exe so players do not need a global Node.js install."
