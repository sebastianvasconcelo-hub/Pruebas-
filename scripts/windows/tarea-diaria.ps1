<#
  Tarea diaria: corre la canasta y publica la PWA en Cloudflare Pages.

  La ejecuta el Programador de tareas de Windows (ver instalar-tarea.ps1).
  Tambien se puede correr a mano:  powershell -File scripts\windows\tarea-diaria.ps1

  Cada ejecucion deja un log en logs\ con la fecha, para poder ver despues que
  paso si la app del telefono muestra datos viejos.
#>
$ErrorActionPreference = 'Stop'

# La raiz del repo es dos carpetas arriba de este script.
$raiz = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $raiz

$logs = Join-Path $raiz 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$log = Join-Path $logs ("tarea-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))

function Escribir($texto) {
  $linea = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $texto
  Add-Content -Path $log -Value $linea -Encoding utf8
  Write-Output $linea
}

function Paso($nombre, $comando) {
  Escribir "== $nombre"
  # 2>&1 junta errores y salida normal en el mismo log.
  & cmd /c "$comando 2>&1" | ForEach-Object { Add-Content -Path $log -Value $_ -Encoding utf8; Write-Output $_ }
  if ($LASTEXITCODE -ne 0) {
    Escribir "FALLO $nombre (codigo $LASTEXITCODE). No se sigue: el telefono conserva los datos anteriores."
    exit $LASTEXITCODE
  }
}

Escribir "Inicio en $raiz"
Paso 'Armar la PWA' 'npm run web:build'
Paso 'Correr la canasta' 'npm run publicar'
Paso 'Publicar en Cloudflare' 'npm run desplegar'
Escribir 'Listo.'

# Los logs de mas de 30 dias se borran para que la carpeta no crezca sin fin.
Get-ChildItem $logs -Filter 'tarea-*.log' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item
