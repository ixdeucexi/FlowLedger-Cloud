param([switch]$SkipBundles)
$ErrorActionPreference = "Stop"
$workspace = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$mobile = Join-Path $workspace "artifacts/mobile"
$output = Join-Path $mobile ".release-dist"
if (-not $output.StartsWith($mobile, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Release output escaped the mobile workspace." }

Push-Location $workspace
try {
  pnpm run check:mobile-config
  if ($LASTEXITCODE -ne 0) { throw "Mobile config assertion failed." }
  pnpm run test
  if ($LASTEXITCODE -ne 0) { throw "Automated tests failed." }
  pnpm run typecheck
  if ($LASTEXITCODE -ne 0) { throw "Workspace typecheck failed." }
  pnpm exec expo-doctor artifacts/mobile
  if ($LASTEXITCODE -ne 0) { throw "Expo Doctor failed." }
  pnpm audit --prod --audit-level high
  if ($LASTEXITCODE -ne 0) { throw "Production dependency audit failed." }
  git diff --check
  if ($LASTEXITCODE -ne 0) { throw "Git diff whitespace check failed." }
  if (-not $SkipBundles) {
    if (Test-Path -LiteralPath $output) {
      $extendedOutput = if ($output.StartsWith('\\?\')) { $output } else { '\\?\' + $output }
      [System.IO.Directory]::Delete($extendedOutput, $true)
    }
    Push-Location $mobile
    try {
      pnpm exec expo export --platform all --output-dir .release-dist
      if ($LASTEXITCODE -ne 0) { throw "Expo all-platform export failed." }
    } finally { Pop-Location }
  }
} finally { Pop-Location }
Write-Output "Static native release checks passed. Signed builds and physical-device tests are still required."
