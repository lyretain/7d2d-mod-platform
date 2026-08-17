param(
  [string]$OutDir = "",
  [string]$SteamBuildId = "",
  [int]$AppId = 294420
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$projectVersions = Get-Content -LiteralPath (Join-Path $root "project-versions.json") -Raw | ConvertFrom-Json
if (-not $SteamBuildId) { $SteamBuildId = [string]$projectVersions.steamBuildId }
if (-not $OutDir) { $OutDir = Join-Path $root ".ci\7dtd-managed" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$needed = @("Assembly-CSharp.dll", "LogLibrary.dll", "UnityEngine.CoreModule.dll")

function Test-GameManagedDll([string]$managed, [string]$name) {
  if ([string]::IsNullOrWhiteSpace($managed)) { return $false }
  try {
    return [System.IO.File]::Exists([System.IO.Path]::Combine($managed, $name))
  } catch {
    return $false
  }
}

function Find-ManagedDir([string]$searchRoot) {
  if ([string]::IsNullOrWhiteSpace($searchRoot) -or -not (Test-Path -LiteralPath $searchRoot)) { return $null }
  $dll = Get-ChildItem -LiteralPath $searchRoot -Recurse -Filter "Assembly-CSharp.dll" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($dll) { return $dll.DirectoryName }
  return $null
}

function Copy-ManagedRefs([string]$managed, [string]$sourceLabel) {
  foreach ($name in $needed) {
    if (-not (Test-GameManagedDll $managed $name)) { throw "Missing $name in $managed" }
    Copy-Item ([System.IO.Path]::Combine($managed, $name)) -Destination (Join-Path $OutDir $name) -Force
  }
  Write-Host "Copied game references from $sourceLabel ($managed)"
  Write-Output $OutDir
  exit 0
}

if (($needed | ForEach-Object { Test-Path -LiteralPath (Join-Path $OutDir $_) }) -notcontains $false) {
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
  if (Test-GameManagedDll $managed "Assembly-CSharp.dll") {
    Copy-ManagedRefs $managed $managed
  }
}

if ($env:GAME_MANAGED_URL) {
  Write-Host "Downloading game references from GAME_MANAGED_URL"
  $bundleDir = Join-Path $root ".ci\managed-url"
  New-Item -ItemType Directory -Force -Path $bundleDir | Out-Null
  $bundleZip = Join-Path $bundleDir "managed.zip"
  Invoke-WebRequest -Uri $env:GAME_MANAGED_URL -OutFile $bundleZip
  Expand-Archive -LiteralPath $bundleZip -DestinationPath $bundleDir -Force
  $fromUrl = Find-ManagedDir $bundleDir
  if ($fromUrl -and (Test-GameManagedDll $fromUrl "Assembly-CSharp.dll")) {
    Copy-ManagedRefs $fromUrl "GAME_MANAGED_URL"
  }
  Write-Host "GAME_MANAGED_URL did not contain Assembly-CSharp.dll; falling back to SteamCMD"
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

function Invoke-SteamCmd {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$CmdArgs)
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & $steamCmd @CmdArgs
  $code = $LASTEXITCODE
  $ErrorActionPreference = $previous
  return $code
}

Write-Host "Bootstrapping SteamCMD self-update"
Invoke-SteamCmd '+quit' | Out-Null
Invoke-SteamCmd '+quit' | Out-Null

$installScript = Join-Path $steamRoot "install-7dtd.txt"
$installDir = ($gameRoot -replace '\\', '/')
@(
  "@ShutdownOnFailedCommand 0",
  "@NoPromptForPassword 1",
  "@sSteamCmdForcePlatformType windows",
  "force_install_dir $installDir",
  "login anonymous",
  "app_update $AppId validate",
  "quit"
) | Set-Content -LiteralPath $installScript -Encoding ASCII

$foundDir = $null
for ($attempt = 1; $attempt -le 4; $attempt += 1) {
  Write-Host "SteamCMD app_update $AppId attempt $attempt"
  Invoke-SteamCmd '+runscript' $installScript | Out-Null
  $foundDir = Find-ManagedDir $gameRoot
  if ($foundDir) { break }
  Start-Sleep -Seconds 8
}

if (-not $foundDir) {
  throw @"
SteamCMD finished but Assembly-CSharp.dll was not found under $gameRoot.
Anonymous install of app $AppId failed (often 'Missing configuration' on the first SteamCMD self-update).
Zip Assembly-CSharp.dll, LogLibrary.dll, and UnityEngine.CoreModule.dll from 7DaysToDie_Data\Managed, host the zip, and set repository secret GAME_MANAGED_URL.
"@
}

Copy-ManagedRefs $foundDir "SteamCMD build $SteamBuildId"
