# ============================================================
#  print-raw.ps1 - Envia bytes ESC/POS crudos a una impresora
#  termica de Windows (winspool.drv P/Invoke).
#
#  v1 (2026-08-28): impresion REAL (fix del stub usePrinter.ts).
#  - Usa la impresora PREDETERMINADA de Windows si no se pasa
#    -PrinterName (asi el usuario solo configura Windows).
#  - Sin dependencias npm nativas: P/Invoke puro a winspool.drv.
#
#  Uso:
#    powershell -NoProfile -ExecutionPolicy Bypass -File print-raw.ps1 -File ticket.bin
#    powershell ... -File print-raw.ps1 -PrinterName "XP-80C" -File ticket.bin
#
#  Exit codes: 0 OK, 1 error (con mensaje en stderr).
# ============================================================
param(
  [string]$PrinterName = "",
  [string]$File = ""
)

$ErrorActionPreference = "Stop"

if (-not $File -or -not (Test-Path $File)) {
  Write-Error "ERROR: -File es obligatorio y debe existir."
  exit 1
}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class WinSpool {
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DOC_INFO_1 {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDatatype;
  }

  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, ref DOC_INFO_1 di);

  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int pcWritten);

  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
}
"@

try {
  # Resolver nombre de impresora (default = predeterminada de Windows)
  if (-not $PrinterName) {
    try {
      $reg = Get-ItemProperty "HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Windows" -Name Device -ErrorAction Stop
      $PrinterName = ($reg.Device -split ",")[0]
    } catch {
      Write-Error "ERROR: No se pudo detectar la impresora predeterminada. Especifique -PrinterName."
      exit 1
    }
  }
  if (-not $PrinterName) {
    Write-Error "ERROR: No hay impresora predeterminada configurada en Windows."
    exit 1
  }

  $bytes = [System.IO.File]::ReadAllBytes($File)
  if ($bytes.Length -eq 0) {
    Write-Error "ERROR: El archivo esta vacio."
    exit 1
  }

  $hPrinter = [IntPtr]::Zero
  if (-not [WinSpool]::OpenPrinter($PrinterName, [ref]$hPrinter, [IntPtr]::Zero)) {
    $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Write-Error "ERROR: OpenPrinter fallo para '$PrinterName' (codigo $err). Verifique el nombre en Configuracion > Impresoras de Windows."
    exit 1
  }

  try {
    $docInfo = New-Object WinSpool+DOC_INFO_1
    $docInfo.pDocName = "Rey de la Chelada - Ticket"
    $docInfo.pOutputFile = $null
    $docInfo.pDatatype = "RAW"

    if (-not [WinSpool]::StartDocPrinter($hPrinter, 1, [ref]$docInfo)) {
      $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
      if ($err -eq 1804) {
        Write-Error "ERROR: La impresora '$PrinterName' no acepta datos RAW (parece impresora virtual tipo PDF/OneNote). Configura la impresora termica como PREDETERMINADA en Windows, o escribe su nombre exacto en Admin > Configuracion > Impresora."
      } else {
        Write-Error "ERROR: StartDocPrinter fallo (codigo $err)."
      }
      exit 1
    }

    try {
      [WinSpool]::StartPagePrinter($hPrinter) | Out-Null
      $written = 0
      $ok = [WinSpool]::WritePrinter($hPrinter, $bytes, $bytes.Length, [ref]$written)
      if (-not $ok -or $written -ne $bytes.Length) {
        $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
        Write-Error "ERROR: WritePrinter escribio $written de $($bytes.Length) bytes (codigo $err)."
        exit 1
      }
      [WinSpool]::EndPagePrinter($hPrinter) | Out-Null
    } finally {
      [WinSpool]::EndDocPrinter($hPrinter) | Out-Null
    }
  } finally {
    [WinSpool]::ClosePrinter($hPrinter) | Out-Null
  }

  Write-Output "OK: $($bytes.Length) bytes enviados a '$PrinterName'."
  exit 0
} catch {
  Write-Error "ERROR: $($_.Exception.Message)"
  exit 1
}