$files = Get-ChildItem docs/manual/*.html
$changedFiles = @()
foreach ($f in $files) {
  $original = Get-Content $f.FullName -Raw
  $updated = $original
  $updated = [regex]::Replace($updated, '(chapter-heroes/[A-Za-z0-9_\-]+)\.jpg', '$1.webp')
  $updated = [regex]::Replace($updated, '(<img src="assets/chapter-heroes/[^"]+\.webp" alt="[^"]*")( class="chapter-hero" />)', '$1 loading="lazy" decoding="async"$2')
  if ($updated -ne $original) {
    [System.IO.File]::WriteAllText($f.FullName, $updated)
    $changedFiles += $f.Name
  }
}
Write-Host "Files changed: $($changedFiles.Count)"
$changedFiles | ForEach-Object { Write-Host "  $_" }
Write-Host ""
Write-Host "--- leftover chapter-heroes/*.jpg refs (should be 0) ---"
(Select-String -Path docs/manual/*.html -Pattern 'chapter-heroes/[A-Za-z0-9_\-]+\.jpg' | Measure-Object).Count
Write-Host ""
Write-Host "--- chapter-hero imgs total vs with lazy/async ---"
$total = (Select-String -Path docs/manual/*.html -Pattern 'class="chapter-hero"').Count
$lazy = (Select-String -Path docs/manual/*.html -Pattern 'loading="lazy" decoding="async" class="chapter-hero"').Count
Write-Host "total:           $total"
Write-Host "with lazy/async: $lazy"
