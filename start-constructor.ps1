$ErrorActionPreference = "Stop"

$projectRoot = $PSScriptRoot
$logPath = Join-Path $projectRoot "constructor-launch.log"
$utf8 = New-Object System.Text.UTF8Encoding($false)
Set-Location -LiteralPath $projectRoot

function Write-LauncherMessage {
  param([string]$Message)
  Write-Host $Message
  [System.IO.File]::AppendAllText($logPath, "$Message`r`n", $utf8)
}

$logHeader = @(
  "============================================================"
  "Blockout Map Constructor launcher"
  "Started: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
  "Folder: $projectRoot"
  "============================================================"
) -join "`r`n"
[System.IO.File]::WriteAllText($logPath, "$logHeader`r`n", $utf8)

try {
  Write-LauncherMessage "[1/4] Checking Node.js..."
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    throw "Node.js was not found. Node.js 22.13 or newer is required."
  }

  $nodeVersionText = (& node.exe --version 2>&1 | Out-String).Trim()
  Write-LauncherMessage "Node.js: $nodeVersionText"
  $nodeVersion = [version]($nodeVersionText.TrimStart("v"))
  if ($nodeVersion -lt [version]"22.13.0") {
    throw "Installed Node.js version is $nodeVersionText. Version 22.13 or newer is required."
  }

  Write-LauncherMessage "[2/4] Checking npm..."
  $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npmCommand) {
    throw "npm was not found in PATH."
  }
  $npmVersion = (& npm.cmd --version 2>&1 | Out-String).Trim()
  Write-LauncherMessage "npm: $npmVersion"

  Write-LauncherMessage "[3/4] Checking project dependencies..."
  $vinextPath = Join-Path $projectRoot "node_modules\.bin\vinext.cmd"
  if (-not (Test-Path -LiteralPath $vinextPath -PathType Leaf)) {
    throw "Project dependencies are missing. Automatic installation is disabled. Run 'npm install' manually before starting."
  }
  Write-LauncherMessage "Dependencies are present."

  Write-LauncherMessage "[4/4] Starting http://localhost:3000"
  Write-LauncherMessage "Press Ctrl+C to stop the server. All output is saved to constructor-launch.log."

  $existingServer = $false
  try {
    $response = Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing -TimeoutSec 2
    $existingServer = $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  }
  catch {
    $existingServer = $false
  }

  if ($existingServer) {
    Write-LauncherMessage "A server is already running on port 3000. Opening the existing constructor."
    Start-Process "http://localhost:3000"
    exit 0
  }

  $browserCommand = "Start-Sleep -Seconds 4; Start-Process 'http://localhost:3000'"
  Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -ArgumentList @("-NoLogo", "-NoProfile", "-Command", $browserCommand)

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & npm.cmd run dev 2>&1 | ForEach-Object {
    $line = $_.ToString()
    Write-Host $line
    [System.IO.File]::AppendAllText($logPath, "$line`r`n", $utf8)
  }
  $serverExit = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorActionPreference
  if ($serverExit -ne 0) {
    throw "Development server exited with code $serverExit."
  }

  Write-LauncherMessage "Server stopped normally."
  exit 0
}
catch {
  Write-LauncherMessage "ERROR: $($_.Exception.Message)"
  Write-LauncherMessage "No software or dependencies were installed by this launcher."
  exit 1
}
