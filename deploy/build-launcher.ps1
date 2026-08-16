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
Write-Host "Portable launcher folder: $OutputDir"
Write-Host "This folder includes node.exe so players do not need a global Node.js install."
