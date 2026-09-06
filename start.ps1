param([int]$Port = 4174)
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "Orbit is running at http://localhost:$Port"
if (Get-Command bun -ErrorAction SilentlyContinue) {
  $env:PORT = $Port
  bun (Join-Path $root "server.js")
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  python -m http.server $Port --directory $root
} else {
  Write-Error "Bun or Python is required to start the local server."
}
