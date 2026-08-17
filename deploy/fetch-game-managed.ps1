param(
  [string]$OutDir = "",
  [string]$SteamBuildId = "24436778",
  [int]$AppId = 294420
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $root ".ci\7dtd-managed" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$needed = @("Assembly-CSharp.dll", "LogLibrary.dll", "UnityEngine.CoreModule.dll")
$have = $needed | ForEach-Object { Test-Path -LiteralPath (Join-Path $OutDir $_) }
if ($have -notcontains $false) {
  Write-Host "Using cached game references in $OutDir"
  Write-Output $OutDir
  exit 0
}

$candidates = @(
  $env:GAME_MANAGED_DIR,
  "G:\SteamLibrary\steamapps\common\7 Days To Die\7DaysToDie_Data\Managed",
  "G:\SteamLibrary\steamapps\common\7 Days To Die Dedicated Server\7DaysToDieServer_Data\Managed",
  "C:\Program Files (x86)\Steam\steamapps\common\7 Days To Die\7DaysToDie_Data\Managed"
) | Where-Object { $_ }

foreach ($managed in $candidates) {
  if (Test-Path -LiteralPath (Join-Path $managed "Assembly-CSharp.dll")) {
    foreach ($name in $needed) {
      $source = Join-Path $managed $name
      if (-not (Test-Path -LiteralPath $source)) { throw "Missing $name in $managed" }
      Copy-Item $source -Destination (Join-Path $OutDir $name) -Force
    }
    Write-Host "Copied game references from $managed"
    Write-Output $OutDir
    exit 0
  }
}

$steamRoot = Join-Path $root ".ci\steamcmd"
$gameRoot = Join-Path $steamRoot "dedicated"
New-Item -ItemType Directory -Force -Path $steamRoot, $gameRoot | Out-Null
$steamCmd = Join-Path $steamRoot "steamcmd.exe"
if (-not (Test-Path -LiteralPath $steamCmd)) {
  $zip = Join-Path $steamRoot "steamcmd.zip"
  Invoke-WebRequest -Uri "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip" -OutFile $zip
  Expand-Archive -LiteralPath $zip -DestinationPath $steamRoot -Force
}
Write-Host "Downloading 7 Days to Die Dedicated Server (app $AppId) via SteamCMD"
& $steamCmd '+@ShutdownOnFailedCommand' '1' '+@NoPromptForPassword' '1' '+force_install_dir' $gameRoot '+login' 'anonymous' '+app_update' "$AppId" 'validate' '+quit'
$found = Get-ChildItem -LiteralPath $gameRoot -Recurse -Filter "Assembly-CSharp.dll" | Select-Object -First 1
if (-not $found) { throw "SteamCMD finished but Assembly-CSharp.dll was not found under $gameRoot" }
$managed = $found.DirectoryName
foreach ($name in $needed) {
  $source = Join-Path $managed $name
  if (-not (Test-Path -LiteralPath $source)) { throw "Missing $name in $managed" }
  Copy-Item $source -Destination (Join-Path $OutDir $name) -Force
}
Write-Host "Copied game references from SteamCMD $managed (build $SteamBuildId)"
Write-Output $OutDir
