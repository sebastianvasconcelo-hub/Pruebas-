<#
  Registra la tarea diaria en el Programador de tareas de Windows.

    powershell -ExecutionPolicy Bypass -File scripts\windows\instalar-tarea.ps1
    powershell -ExecutionPolicy Bypass -File scripts\windows\instalar-tarea.ps1 -Hora 06:30

  Se registra para tu usuario, sin permisos de administrador, y corre solo
  mientras tu sesion este iniciada: las variables de Cloudflare y las
  credenciales viven en tu perfil.

  Si a la hora programada el PC estaba apagado, corre apenas lo prendas
  (StartWhenAvailable). Y espera a que haya red antes de empezar.
#>
param(
  [string]$Hora = '07:00',
  [string]$Nombre = 'Mi canasta - publicar'
)
$ErrorActionPreference = 'Stop'

$script = Resolve-Path (Join-Path $PSScriptRoot 'tarea-diaria.ps1')

$accion = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""

$disparador = New-ScheduledTaskTrigger -Daily -At $Hora

$ajustes = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -RunOnlyIfNetworkAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 20) `
  -RestartCount 2 `
  -RestartInterval (New-TimeSpan -Minutes 15)

Register-ScheduledTask -TaskName $Nombre -Action $accion -Trigger $disparador -Settings $ajustes `
  -Description 'Corre la canasta de supermercado y publica la PWA en Cloudflare Pages.' -Force | Out-Null

Write-Output ""
Write-Output "Tarea '$Nombre' registrada: todos los dias a las $Hora."
Write-Output "Si el PC esta apagado a esa hora, corre apenas lo prendas."
Write-Output ""
Write-Output "Para probarla ahora:   Start-ScheduledTask -TaskName '$Nombre'"
Write-Output "Para ver los logs:     carpeta logs\ del proyecto"
Write-Output "Para quitarla:         Unregister-ScheduledTask -TaskName '$Nombre'"
Write-Output ""
