param(
    [string]$SetupPath,
    [string]$PreviousInstaller
)
$ErrorActionPreference = 'Stop'
$version = (Get-Content "$PSScriptRoot/../package.json" -Raw | ConvertFrom-Json).version
if (!$SetupPath) { $SetupPath = "$PSScriptRoot/../src-tauri/target/release/bundle/nsis/Inkwell_${version}_x64-setup.exe" }
$setup = (Resolve-Path $SetupPath).Path
$installDir = Join-Path $env:RUNNER_TEMP 'inkwell-installed'
if ($PreviousInstaller) {
    $previous = Start-Process -FilePath (Resolve-Path $PreviousInstaller).Path -ArgumentList @('/S', "/D=$installDir") -PassThru -Wait
    if ($previous.ExitCode -ne 0) { throw "Previous installer failed: $($previous.ExitCode)" }
    $oldVersion = (Get-Item "$installDir/inkwell.exe").VersionInfo.ProductVersion
    if (!$oldVersion.StartsWith('0.1.0')) { throw "Expected 0.1.0 before upgrade, found $oldVersion" }
    Write-Output "Installed previous Inkwell $oldVersion. Testing update to $version in the same directory."
}
$installer = Start-Process -FilePath $setup -ArgumentList @('/S', "/D=$installDir") -PassThru -Wait
if ($installer.ExitCode -ne 0) { throw "Installer failed with exit code $($installer.ExitCode)" }
$appPath = Join-Path $installDir 'inkwell.exe'
if (!(Test-Path $appPath)) { throw 'Installed application executable is missing.' }
if (!(Test-Path "$installDir/ghostscript/bin/gswin64c.exe")) { throw 'Installed Ghostscript runtime is missing.' }
$installedVersion = (Get-Item $appPath).VersionInfo.ProductVersion
if (!$installedVersion.StartsWith($version)) { throw "Expected $version, installed $installedVersion" }
$app = Start-Process -FilePath $appPath -WorkingDirectory $installDir -PassThru
try {
    Start-Sleep -Seconds 15
    $app.Refresh()
    if ($app.HasExited) { throw "Installed application exited at startup: $($app.ExitCode)" }
    Write-Output "Installed Inkwell $installedVersion and verified that the desktop process stays running."
} finally {
    if (!$app.HasExited) { Stop-Process -Id $app.Id -Force }
}
