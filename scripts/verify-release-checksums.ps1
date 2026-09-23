param(
  [Parameter(Mandatory = $true)]
  [string] $Directory
)

$manifest = Join-Path $Directory 'SHA256SUMS.txt'
if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { throw 'SHA256SUMS.txt is missing' }
$installers = @(Get-ChildItem -LiteralPath $Directory -Filter '*.exe' -File)
if ($installers.Count -eq 0) { throw 'No installer was found' }

$entries = @{}
$lines = @(Get-Content -LiteralPath $manifest | Where-Object { $_.Trim().Length -gt 0 })
foreach ($line in $lines) {
  if ($line -cnotmatch '^([0-9a-fA-F]{64}) [ *]?(.+\.exe)$') { throw "Invalid checksum entry: $line" }
  $name = $Matches[2]
  if ($entries.ContainsKey($name)) { throw "Duplicate checksum entry: $name" }
  $entries[$name] = $Matches[1].ToLowerInvariant()
}
if ($entries.Count -ne $installers.Count) { throw 'Checksum entries do not match installer assets' }

foreach ($installer in $installers) {
  if (-not $entries.ContainsKey($installer.Name)) { throw "Missing checksum: $($installer.Name)" }
  $actual = (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -cne $entries[$installer.Name]) { throw "Checksum mismatch: $($installer.Name)" }
  Write-Host "Verified $($installer.Name): $actual"
}
