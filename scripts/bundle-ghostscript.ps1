$ErrorActionPreference = 'Stop'
# Use the upstream release API; never execute the downloaded installer.
$release = Invoke-RestMethod 'https://api.github.com/repos/ArtifexSoftware/ghostpdl-downloads/releases/latest'
$asset = $release.assets | Where-Object { $_.name -match '^gs[0-9]+w64\.exe$' } | Select-Object -First 1
if (!$asset) { throw 'No Windows x64 Ghostscript release found.' }
$archive = Join-Path $env:TEMP $asset.name
Invoke-WebRequest $asset.browser_download_url -OutFile $archive
if (!$asset.digest -or !$asset.digest.StartsWith('sha256:')) { throw 'Upstream did not publish a SHA-256 digest. Verify the release manually before bundling.' }
$actual = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $asset.digest.Substring(7)) { throw 'Ghostscript checksum mismatch.' }
$destination = Join-Path $PSScriptRoot '../src-tauri/resources/ghostscript'
New-Item -ItemType Directory -Force $destination | Out-Null
& 7z x $archive "-o$destination" -y | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Ghostscript extraction failed.' }
if (!(Test-Path "$destination/bin/gswin64c.exe") -or !(Test-Path "$destination/bin/gsdll64.dll")) { throw 'Ghostscript runtime layout changed. Review bundle before release.' }
# Keep Resource, lib, ICC profiles and license/source notices with the runtime.
@{ release = $release.tag_name; url = $asset.browser_download_url; sha256 = $actual } | ConvertTo-Json | Set-Content "$destination/UPSTREAM.json"
