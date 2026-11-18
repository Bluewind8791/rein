# Makes a PDF of a .pptx next to it, with the same base name (a.pptx -> a.pdf),
# keeping what lies off the slide. PowerPoint's own PDF save cuts a shape
# placed past the slide's edge, so the slide is first made big enough to hold
# every shape of every slide, each shape put back where it was relative to the
# others (PowerPoint rescales shapes when the slide size changes), and only
# then saved as PDF. The .pptx is opened read-only, with no window, and closed
# unsaved.
#
# Known side effects, accepted: shapes on the slide master (a header table)
# stretch with the slide; a locked shape cannot be put back, and a value
# PowerPoint refuses is skipped, shape by shape.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File pptx-to-pdf.ps1 <file.pptx>
# Exit 0: the PDF's path on stdout. Exit 2: PowerPoint is not installed (keep
# the .pptx alone). Exit 1: anything else, the reason on stderr.
param([Parameter(Mandatory = $true)][string]$Path)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

try {
  $src = (Resolve-Path -LiteralPath $Path).ProviderPath
} catch {
  [Console]::Error.WriteLine("No such file: $Path")
  exit 1
}
$pdf = [IO.Path]::ChangeExtension($src, '.pdf')

try {
  $app = New-Object -ComObject PowerPoint.Application
} catch {
  [Console]::Error.WriteLine("PowerPoint is not installed (or cannot be started), so no PDF was made: $($_.Exception.Message)")
  exit 2
}

$msoTrue = -1
$msoFalse = 0
$ppSaveAsPDF = 32
$pres = $null
try {
  # Open(FileName, ReadOnly, Untitled, WithWindow)
  $pres = $app.Presentations.Open($src, $msoTrue, $msoFalse, $msoFalse)
  $width = $pres.PageSetup.SlideWidth
  $height = $pres.PageSetup.SlideHeight

  # every shape's place and size, and the box around them and the slide.
  $minX = 0.0; $minY = 0.0; $maxX = [double]$width; $maxY = [double]$height
  $placed = New-Object System.Collections.ArrayList
  foreach ($slide in $pres.Slides) {
    foreach ($shape in $slide.Shapes) {
      try {
        $l = [double]$shape.Left; $t = [double]$shape.Top; $w = [double]$shape.Width; $h = [double]$shape.Height
        if ($l -lt $minX) { $minX = $l }
        if ($t -lt $minY) { $minY = $t }
        if ($l + $w -gt $maxX) { $maxX = $l + $w }
        if ($t + $h -gt $maxY) { $maxY = $t + $h }
        [void]$placed.Add(@{ Shape = $shape; L = $l; T = $t; W = $w; H = $h })
      } catch {}
    }
  }

  if ($minX -lt 0 -or $minY -lt 0 -or $maxX -gt $width -or $maxY -gt $height) {
    try { $pres.PageSetup.SlideWidth = $maxX - $minX } catch { [Console]::Error.WriteLine("slide width $($maxX - $minX) refused: $($_.Exception.Message)") }
    try { $pres.PageSetup.SlideHeight = $maxY - $minY } catch { [Console]::Error.WriteLine("slide height $($maxY - $minY) refused: $($_.Exception.Message)") }
    foreach ($p in $placed) {
      $s = $p.Shape
      try { $s.LockAspectRatio = $msoFalse } catch {}
      try { $s.Width = $p.W } catch {}
      try { $s.Height = $p.H } catch {}
      try { $s.Left = $p.L - $minX } catch {}
      try { $s.Top = $p.T - $minY } catch {}
    }
  }

  $pres.SaveAs($pdf, $ppSaveAsPDF)
  [Console]::Out.WriteLine($pdf)
  $code = 0
} catch {
  [Console]::Error.WriteLine("Saving $src as PDF failed: $($_.Exception.Message)")
  $code = 1
} finally {
  if ($pres -ne $null) {
    try { $pres.Saved = $msoTrue; $pres.Close() } catch {}
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($pres)
  }
  # PowerPoint runs once per user: quit it only when this script left it
  # with nothing open, so a deck the user has open stays.
  try { if ($app.Presentations.Count -eq 0) { $app.Quit() } } catch {}
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
exit $code
