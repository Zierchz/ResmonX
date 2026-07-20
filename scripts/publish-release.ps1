# Publishes a GitHub release with a stable-named installer (ResmonX-Setup.exe)
# so the landing can link to releases/latest/download/ResmonX-Setup.exe forever.
# Release notes come from notes/v<version>.md (Markdown); if that file is absent
# it falls back to a generic title.
[CmdletBinding()]
param(
  [switch]$Build,                        # run "npm run tauri build" first
  [string]$Version,                      # defaults to version in tauri.conf.json
  [string]$StableName = "ResmonX-Setup.exe",
  [string]$NotesFile,                    # defaults to notes/v<version>.md
  [string]$KeyPath = "$HOME\.tauri\resmonx.key"  # updater signing private key
)
$ErrorActionPreference = "Stop"

# repo root (this script lives in scripts/)
$root = Split-Path $PSScriptRoot -Parent
$conf = Join-Path $root "src-tauri\tauri.conf.json"
if (-not $Version) { $Version = (Get-Content $conf -Raw | ConvertFrom-Json).version }
$tag = "v$Version"

if ($Build) {
  # Sign updater artifacts: the bundler needs the private key in the env. Our
  # key has no password, but the var must still be set (empty) to avoid a prompt.
  if (-not (Test-Path $KeyPath)) { throw "Signing key not found at $KeyPath. Generate it with: npm run tauri signer generate -- -w `"$KeyPath`"" }
  $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content $KeyPath -Raw)
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
  Push-Location $root
  try { npm run tauri build } finally { Pop-Location }
}

# find the freshly built NSIS installer
$nsis = Join-Path $root "src-tauri\target\release\bundle\nsis"
$setup = Get-ChildItem $nsis -Filter "*_x64-setup.exe" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $setup) { throw "No NSIS installer in $nsis. Build first with -Build." }

# the updater needs the .sig produced by the signed build
$sig = "$($setup.FullName).sig"
if (-not (Test-Path $sig)) { throw "No signature at $sig. Build with -Build so updater artifacts are signed." }

# stable copy alongside the versioned one
$stable = Join-Path $nsis $StableName
Copy-Item $setup.FullName $stable -Force
Write-Host "Installer: $($setup.Name)  ->  $StableName"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "gh (GitHub CLI) not found. Install it: winget install --id GitHub.cli"
}

# release notes: notes/v<version>.md if present, else a generic title
if (-not $NotesFile) { $NotesFile = Join-Path $root "notes\$tag.md" }
if (Test-Path $NotesFile) {
  $notesArgs = @('--notes-file', $NotesFile)
  $notesText = Get-Content $NotesFile -Raw
  Write-Host "Notes: $NotesFile"
} else {
  $notesArgs = @('--notes', "ResmonX $tag")
  $notesText = "ResmonX $tag"
  Write-Warning "No notes file at $NotesFile; using a generic title."
}

# updater manifest: the in-app updater reads latest.json from releases/latest.
# The url points at the versioned installer asset; the signature is embedded.
$latestObj = [ordered]@{
  version   = $Version
  notes     = $notesText
  pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{
      signature = (Get-Content $sig -Raw).Trim()
      url       = "https://github.com/Zierchz/ResmonX/releases/download/$tag/$($setup.Name)"
    }
  }
}
$latest = Join-Path $nsis "latest.json"
$latestObj | ConvertTo-Json -Depth 5 | Set-Content $latest -Encoding utf8
Write-Host "Manifest: latest.json"

# create the release, or upload assets + refresh notes if it already exists
gh release view $tag *> $null
if ($LASTEXITCODE -ne 0) {
  gh release create $tag $setup.FullName $stable $latest --title "ResmonX $tag" @notesArgs
} else {
  gh release upload $tag $setup.FullName $stable $latest --clobber
  gh release edit $tag @notesArgs
}
Write-Host "Done: $tag published with $StableName (stable download link) + latest.json."
