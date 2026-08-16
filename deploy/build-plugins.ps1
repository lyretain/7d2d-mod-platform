param(
  [Parameter(Mandatory=$true)][string]$GameManagedDir,
  [string]$Configuration = "Release"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$output = Join-Path $root "artifacts\plugins"
$serverOutput = Join-Path $output "ModPlatformServer"
$clientOutput = Join-Path $output "ModPlatformClient"
New-Item -ItemType Directory -Force -Path $serverOutput,$clientOutput | Out-Null

if (Get-Command dotnet -ErrorAction SilentlyContinue) {
  dotnet build "$root\plugins\server\ModPlatform.Server.csproj" -c $Configuration -p:GameManagedDir="$GameManagedDir"
  dotnet build "$root\plugins\client\ModPlatform.Client.csproj" -c $Configuration -p:GameManagedDir="$GameManagedDir"
  $sharedDll = Get-ChildItem "$root\plugins\shared\bin\$Configuration" -Recurse -Filter ModPlatform.Shared.dll | Select-Object -First 1
  $serverDll = Get-ChildItem "$root\plugins\server\bin\$Configuration" -Recurse -Filter ModPlatform.Server.dll | Select-Object -First 1
  $clientDll = Get-ChildItem "$root\plugins\client\bin\$Configuration" -Recurse -Filter ModPlatform.Client.dll | Select-Object -First 1
  Copy-Item $sharedDll.FullName,$serverDll.FullName -Destination $serverOutput -Force
  Copy-Item $sharedDll.FullName,$clientDll.FullName -Destination $clientOutput -Force
} else {
  $csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
  if (!(Test-Path -LiteralPath $csc)) { throw "Neither dotnet SDK nor the Windows C# compiler was found." }
  $build = Join-Path $output ".build"
  New-Item -ItemType Directory -Force -Path $build | Out-Null
  $common = @('/nologo','/noconfig','/target:library','/nostdlib+',"/reference:$GameManagedDir\mscorlib.dll","/reference:$GameManagedDir\System.dll","/reference:$GameManagedDir\System.Core.dll","/reference:$GameManagedDir\System.Runtime.Serialization.dll","/reference:$GameManagedDir\System.Xml.dll")
  & $csc @common "/reference:$GameManagedDir\System.Net.Http.dll" "/out:$build\ModPlatform.Shared.dll" "$root\plugins\shared\Contracts.cs" "$root\plugins\shared\PlatformClient.cs"
  if ($LASTEXITCODE -ne 0) { throw "Shared plugin compilation failed." }
  $gameReferences = @("/reference:$GameManagedDir\Assembly-CSharp.dll","/reference:$GameManagedDir\LogLibrary.dll","/reference:$build\ModPlatform.Shared.dll")
  & $csc @common @gameReferences "/out:$serverOutput\ModPlatform.Server.dll" "$root\plugins\server\ServerPlugin.cs"
  if ($LASTEXITCODE -ne 0) { throw "Server plugin compilation failed." }
  & $csc @common @gameReferences "/out:$clientOutput\ModPlatform.Client.dll" "$root\plugins\client\ClientPlugin.cs"
  if ($LASTEXITCODE -ne 0) { throw "Client plugin compilation failed." }
  Copy-Item "$build\ModPlatform.Shared.dll" -Destination $serverOutput -Force
  Copy-Item "$build\ModPlatform.Shared.dll" -Destination $clientOutput -Force
}

Copy-Item "$root\plugins\server\ModInfo.xml" -Destination $serverOutput -Force
Copy-Item "$root\plugins\server\server.config.example.json" -Destination "$serverOutput\server.config.json" -Force
Copy-Item "$root\plugins\client\ModInfo.xml" -Destination $clientOutput -Force
Copy-Item "$root\plugins\client\client.config.example.json" -Destination "$clientOutput\client.config.json" -Force
Write-Host "Plugin packages built in $output"
