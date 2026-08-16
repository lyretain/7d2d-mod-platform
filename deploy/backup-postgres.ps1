param(
  [Parameter(Mandatory = $true)][string]$DatabaseUrl,
  [string]$OutputDir = "./backups"
)

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$target = Join-Path $OutputDir "platform-state-$stamp.sql"
Write-Host "Writing PostgreSQL dump to $target"
pg_dump $DatabaseUrl --no-owner --no-privileges --file $target
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed" }
Write-Host "Backup complete. Keep this file with the signing key and object-store snapshot."
