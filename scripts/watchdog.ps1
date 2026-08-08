# ============================================================
#  Rey de la Chelada - Watchdog (S1/T3)
#
#  Loop cada IntervalSeconds -> GET /health en el puerto de la app.
#  Si falla MaxFails veces SEGUIDAS -> mata el proceso del puerto y
#  relanza el server (scripts\start-hidden.vbs). Registra todo en
#  logs\watchdog.log. Parada limpia: crear scripts\watchdog.stop.
#
#  Uso:
#    powershell -ExecutionPolicy Bypass -File scripts\watchdog.ps1
#    (opciones: -Port 3002 -IntervalSeconds 300 -MaxFails 3)
#    -DryRun: NO mata ni relanza (solo registra) - para pruebas seguras.
#
#  Task Scheduler (recomendado): ejecutar al inicio de sesion con
#    programa: powershell.exe
#    argumentos: -ExecutionPolicy Bypass -WindowStyle Hidden -File "D:\...\scripts\watchdog.ps1"
#
#  NOTA: archivo en ASCII puro (PowerShell 5.1 sin BOM lee UTF-8 como
#  ANSI y los acentos rompen el parseo).
# ============================================================

param(
  [int]$Port = 3002,
  [int]$IntervalSeconds = 300,
  [int]$MaxFails = 3,
  [switch]$DryRun
)

$ErrorActionPreference = 'SilentlyContinue'

$scriptDir = $PSScriptRoot
if ([string]::IsNullOrEmpty($scriptDir)) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
$root      = Split-Path -Parent $scriptDir
$logDir    = Join-Path $root 'logs'
$logFile   = Join-Path $logDir 'watchdog.log'
$stopFlag  = Join-Path $scriptDir 'watchdog.stop'
$vbsPath   = Join-Path $scriptDir 'start-hidden.vbs'

# ── Helpers ───────────────────────────────────────────────
function Write-Log($msg) {
  try {
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Add-Content -Path $logFile -Value $line -Encoding UTF8
    Write-Host $line
  } catch { }
}

function Test-Health {
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:$Port/health" -UseBasicParsing -TimeoutSec 10
    if ($r.StatusCode -eq 200) { return $true }
  } catch { }
  return $false
}

function Get-PortPid {
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($conn) {
    $pids = @($conn.OwningProcess | Sort-Object -Unique)
    if ($pids.Count -gt 0) { return $pids[0] }
  }
  return $null
}

function Restart-App {
  if ($DryRun) {
    Write-Log "[DRYRUN] reinicio simulado - NO se mata ni se relanza"
    return
  }
  $procPid = Get-PortPid
  if ($procPid) {
    Write-Log "Matando proceso $procPid (puerto $Port)..."
    Stop-Process -Id $procPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  } else {
    Write-Log "No habia proceso en el puerto $Port - solo se relanza"
  }
  if (Test-Path $vbsPath) {
    Write-Log "Relanzando server via start-hidden.vbs..."
    & cscript //nologo $vbsPath
    Start-Sleep -Seconds 5
  } else {
    Write-Log "[ERROR] No existe $vbsPath - no se pudo relanzar"
  }
}

# ── Arranque ──────────────────────────────────────────────
Write-Log "Watchdog iniciado (puerto $Port, cada ${IntervalSeconds}s, max $MaxFails fallos consecutivos, DryRun=$DryRun)"

$failStreak = 0

while ($true) {
  # Parada limpia: flag watchdog.stop
  if (Test-Path $stopFlag) {
    Write-Log "Flag watchdog.stop detectado - deteniendo watchdog."
    Remove-Item $stopFlag -Force -ErrorAction SilentlyContinue
    break
  }

  $ok = Test-Health
  if ($ok) {
    if ($failStreak -gt 0) {
      Write-Log "Server OK (recuperado tras $failStreak fallo(s))"
    }
    $failStreak = 0
  } else {
    $failStreak++
    Write-Log "Health check FALLO ($failStreak/$MaxFails)"
    if ($failStreak -ge $MaxFails) {
      Write-Log "Server caido - reiniciando..."
      Restart-App
      $failStreak = 0
    }
  }

  Start-Sleep -Seconds $IntervalSeconds
}

Write-Log "Watchdog detenido."
