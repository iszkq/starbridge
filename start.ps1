param([int]$Port = 4174)
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "Orbit is running at http://localhost:$Port"
if (Get-Command bun -ErrorAction SilentlyContinue) {
  $env:PORT = $Port
  bun (Join-Path $root "server.js")
} elseif (Get-Command node -ErrorAction SilentlyContinue) {
  # Node fallback keeps the Matrix reverse proxy available when Bun is not installed.
  # A plain Python static server cannot proxy homeserver requests, so login would
  # fail against servers that do not enable browser CORS.
  $env:PORT = $Port
  node (Join-Path $root "server-node.cjs")
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  python -m http.server $Port --directory $root
} else {
  Write-Error "Bun, Node.js or Python is required to start the local server."
}
