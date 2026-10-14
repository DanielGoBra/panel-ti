# Instala Panel TI como servicio de Windows con NSSM (https://nssm.cc).
# Ejecutar en PowerShell como administrador desde la carpeta del proyecto:
#   .\deploy\instalar-servicio-windows.ps1
$ErrorActionPreference = "Stop"
$dir = (Resolve-Path "$PSScriptRoot\..").Path
$python = (Get-Command python).Source
if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) {
  Write-Host "Instala NSSM primero: winget install nssm" -ForegroundColor Yellow
  exit 1
}
& $python -m pip install -r "$dir\requirements.txt"
nssm install PanelTI $python "$dir\serve.py"
nssm set PanelTI AppDirectory $dir
nssm set PanelTI AppStdout "$dir\server.log"
nssm set PanelTI AppStderr "$dir\server.log"
nssm set PanelTI Start SERVICE_AUTO_START
# Variables de entorno: edita estas líneas o crea un archivo .env y cárgalas aquí
nssm set PanelTI AppEnvironmentExtra "PORT=8000" "HOST=0.0.0.0"
nssm start PanelTI
Write-Host "Panel TI escuchando en http://localhost:8000" -ForegroundColor Green
