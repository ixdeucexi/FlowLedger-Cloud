param(
  [string]$BackgroundPath = "store-assets/v1/source/feature-background.png",
  [string]$LogoPath = "artifacts/mobile/assets/images/startup_f_transparent.png",
  [string]$OutputPath = "store-assets/v1/google-play/feature-graphic-1024x500.png"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$workspace = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
function Resolve-WorkspaceFile([string]$relativePath) {
  $candidate = [System.IO.Path]::GetFullPath((Join-Path $workspace $relativePath))
  if (-not $candidate.StartsWith($workspace, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Asset path must stay inside the workspace." }
  return $candidate
}

$backgroundFile = Resolve-WorkspaceFile $BackgroundPath
$logoFile = Resolve-WorkspaceFile $LogoPath
$outputFile = Resolve-WorkspaceFile $OutputPath
if (-not (Test-Path -LiteralPath $backgroundFile) -or -not (Test-Path -LiteralPath $logoFile)) { throw "Feature graphic source assets are missing." }
[System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($outputFile)) | Out-Null

$background = [System.Drawing.Image]::FromFile($backgroundFile)
$logo = [System.Drawing.Image]::FromFile($logoFile)
$canvas = [System.Drawing.Bitmap]::new(1024, 500, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$graphics = [System.Drawing.Graphics]::FromImage($canvas)
try {
  $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  $sourceRatio = $background.Width / $background.Height
  $targetRatio = 1024 / 500
  if ($sourceRatio -gt $targetRatio) {
    $cropWidth = [int][Math]::Round($background.Height * $targetRatio)
    $source = New-Object System.Drawing.Rectangle ([int](($background.Width - $cropWidth) / 2)),0,$cropWidth,$background.Height
  } else {
    $cropHeight = [int][Math]::Round($background.Width / $targetRatio)
    $source = New-Object System.Drawing.Rectangle 0,([int](($background.Height - $cropHeight) / 2)),$background.Width,$cropHeight
  }
  $graphics.DrawImage($background, (New-Object System.Drawing.Rectangle 0,0,1024,500), $source, [System.Drawing.GraphicsUnit]::Pixel)

  # Preserve the exact checked-in logo artwork and its aspect ratio.
  $graphics.DrawImage($logo, (New-Object System.Drawing.Rectangle 62,111,278,278))
  $titleFont = [System.Drawing.Font]::new("Segoe UI", 54, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $taglineFont = [System.Drawing.Font]::new("Segoe UI", 27, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255,248,250,255))
  $muted = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255,190,202,225))
  try {
    $graphics.DrawString("FlowLedger", $titleFont, $white, 382, 176)
    $graphics.DrawString("Know what's next.", $taglineFont, $muted, 386, 249)
  } finally {
    $titleFont.Dispose(); $taglineFont.Dispose(); $white.Dispose(); $muted.Dispose()
  }
  $canvas.Save($outputFile, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $graphics.Dispose(); $canvas.Dispose(); $logo.Dispose(); $background.Dispose()
}

$verified = [System.Drawing.Bitmap]::FromFile($outputFile)
try {
  if ($verified.Width -ne 1024 -or $verified.Height -ne 500) { throw "Feature graphic dimensions are invalid." }
  if ($verified.PixelFormat.ToString() -notmatch "24bpp") { throw "Feature graphic must be opaque 24-bit RGB." }
} finally { $verified.Dispose() }
Write-Output "Created $OutputPath as opaque 1024x500 RGB PNG."
