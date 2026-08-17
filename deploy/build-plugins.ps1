param(
  [Parameter(Mandatory=$true)][string]$GameManagedDir,
  [string]$Configuration = "Release",
  [string]$SteamBuildId = "",
  [string]$GameVersion = "3.1.0"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$output = Join-Path $root "artifacts\plugins"
$serverOutput = Join-Path $output "ModPlatformServer"
$clientOutput = Join-Path $output "ModPlatformClient"
New-Item -ItemType Directory -Force -Path $serverOutput,$clientOutput | Out-Null

if (-not $SteamBuildId) {
  $manifest = Join-Path (Split-Path (Split-Path $GameManagedDir -Parent) -Parent) "..\..\appmanifest_251570.acf"
  $acfCandidates = @(
    (Join-Path (Split-Path (Split-Path (Split-Path $GameManagedDir -Parent) -Parent) -Parent) "appmanifest_251570.acf"),
    "G:\SteamLibrary\steamapps\appmanifest_251570.acf"
  )
  foreach ($acf in $acfCandidates) {
    if (Test-Path -LiteralPath $acf) {
      $text = Get-Content -LiteralPath $acf -Raw
      $match = [regex]::Match($text, '"buildid"\s+"(\d+)"')
      if ($match.Success) { $SteamBuildId = $match.Groups[1].Value; break }
    }
  }
}
if (-not $SteamBuildId) { $SteamBuildId = "24436778" }

$identity = @"
namespace ModPlatform.Shared
{
    public static class PluginIdentity
    {
        public const string PluginVersion = "0.2.11";
        public const int ProtocolVersion = 1;
        public const string TargetGameVersion = "$GameVersion";
        public const string TargetSteamBuild = "$SteamBuildId";
    }
}
"@
Set-Content -LiteralPath (Join-Path $root "plugins\shared\PluginIdentity.cs") -Value $identity -Encoding UTF8

$versionInfo = @{
  pluginVersion = "0.2.11"
  protocolVersion = 1
  targetGameVersion = $GameVersion
  targetSteamBuild = $SteamBuildId
  compiledAt = [DateTime]::UtcNow.ToString("o")
} | ConvertTo-Json

if (Get-Command dotnet -ErrorAction SilentlyContinue) {
  dotnet build "$root\plugins\server\ModPlatform.Server.csproj" -c $Configuration -p:GameManagedDir="$GameManagedDir"
  if ($LASTEXITCODE -ne 0) { throw "Server plugin compilation failed." }
  dotnet build "$root\plugins\client\ModPlatform.Client.csproj" -c $Configuration -p:GameManagedDir="$GameManagedDir"
  if ($LASTEXITCODE -ne 0) { throw "Client plugin compilation failed." }
  function LatestPluginDll($searchRoot, $name) {
    $matches = @(Get-ChildItem $searchRoot -Recurse -Filter $name)
    $preferred = @($matches | Where-Object { $_.DirectoryName -match 'netstandard2\.1' } | Sort-Object LastWriteTime -Descending)
    if ($preferred.Count) { return $preferred[0] }
    return $matches | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  }
  $sharedDll = LatestPluginDll "$root\plugins\shared\bin\$Configuration" "ModPlatform.Shared.dll"
  $serverDll = LatestPluginDll "$root\plugins\server\bin\$Configuration" "ModPlatform.Server.dll"
  $clientDll = LatestPluginDll "$root\plugins\client\bin\$Configuration" "ModPlatform.Client.dll"
  if (-not $sharedDll -or -not $serverDll -or -not $clientDll) { throw "Compiled plugin DLLs were not found." }
  Copy-Item $sharedDll.FullName,$serverDll.FullName -Destination $serverOutput -Force
  Copy-Item $sharedDll.FullName,$clientDll.FullName -Destination $clientOutput -Force
} else {
  $csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
  if (!(Test-Path -LiteralPath $csc)) { throw "Neither dotnet SDK nor the Windows C# compiler was found." }
  $build = Join-Path $output ".build"
  New-Item -ItemType Directory -Force -Path $build | Out-Null
  $common = @('/nologo','/noconfig','/target:library','/nostdlib+',"/reference:$GameManagedDir\mscorlib.dll","/reference:$GameManagedDir\netstandard.dll","/reference:$GameManagedDir\System.dll","/reference:$GameManagedDir\System.Core.dll","/reference:$GameManagedDir\System.Runtime.Serialization.dll","/reference:$GameManagedDir\System.Xml.dll","/reference:$GameManagedDir\System.Net.Http.dll","/reference:$GameManagedDir\System.IO.Compression.dll","/reference:$GameManagedDir\System.IO.Compression.FileSystem.dll")
  $sharedSources = @(
    "$root\plugins\shared\Contracts.cs",
    "$root\plugins\shared\PlatformClient.cs",
    "$root\plugins\shared\PluginIdentity.cs",
    "$root\plugins\shared\Handshake.cs",
    "$root\plugins\shared\LocalState.cs",
    "$root\plugins\shared\PluginPaths.cs",
    "$root\plugins\shared\PackSync.cs",
    "$root\plugins\shared\GameVersions.cs"
  )
  & $csc @common "/out:$build\ModPlatform.Shared.dll" @sharedSources
  if ($LASTEXITCODE -ne 0) { throw "Shared plugin compilation failed." }
  $gameReferences = @("/reference:$GameManagedDir\Assembly-CSharp.dll","/reference:$GameManagedDir\LogLibrary.dll","/reference:$GameManagedDir\UnityEngine.CoreModule.dll","/reference:$build\ModPlatform.Shared.dll")
  & $csc @common @gameReferences "/out:$serverOutput\ModPlatform.Server.dll" "$root\plugins\server\ServerPlugin.cs"
  if ($LASTEXITCODE -ne 0) { throw "Server plugin compilation failed." }
  & $csc @common @gameReferences "/out:$clientOutput\ModPlatform.Client.dll" "$root\plugins\client\ClientPlugin.cs" "$root\plugins\client\XUiC_ModPlatformOptions.cs" "$root\plugins\client\XUiC_ModPlatformSync.cs"
  if ($LASTEXITCODE -ne 0) { throw "Client plugin compilation failed." }
  Copy-Item "$build\ModPlatform.Shared.dll" -Destination $serverOutput -Force
  Copy-Item "$build\ModPlatform.Shared.dll" -Destination $clientOutput -Force
}

Copy-Item "$root\plugins\server\ModInfo.xml" -Destination $serverOutput -Force
Copy-Item "$root\plugins\server\server.config.example.json" -Destination "$serverOutput\server.config.json" -Force
Copy-Item "$root\plugins\client\ModInfo.xml" -Destination $clientOutput -Force
Copy-Item "$root\plugins\client\client.config.example.json" -Destination "$clientOutput\client.config.json" -Force
if (Test-Path -LiteralPath (Join-Path $clientOutput "Config")) { Remove-Item -LiteralPath (Join-Path $clientOutput "Config") -Recurse -Force }
Copy-Item "$root\plugins\client\Config" -Destination (Join-Path $clientOutput "Config") -Recurse -Force
Set-Content -LiteralPath (Join-Path $serverOutput "plugin-version.json") -Value $versionInfo -Encoding UTF8
Set-Content -LiteralPath (Join-Path $clientOutput "plugin-version.json") -Value $versionInfo -Encoding UTF8
Write-Host "Plugin packages built in $output for Steam Build $SteamBuildId / $GameVersion"
