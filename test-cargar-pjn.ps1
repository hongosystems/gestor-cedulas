# test-cargar-pjn.ps1
# Prueba el flujo completo de "Cargar en PJN" simulando exactamente
# lo que hace el boton "Confirmar envio" en el frontend.
param(
    [string]$CedulaId   = "",
    [string]$AuthToken  = "",
    [string]$AppUrl     = "http://localhost:3000",
    [string]$RailwayUrl = "https://cedula-mvp-production.up.railway.app"
)

function Write-Step { param($n,$msg) Write-Host "  [$n/5] $msg" -ForegroundColor Cyan }
function Write-OK   { param($msg)    Write-Host "        OK  $msg" -ForegroundColor Green }
function Write-FAIL { param($msg)    Write-Host "        ERR $msg" -ForegroundColor Red }
function Write-INFO { param($msg)    Write-Host "        --> $msg" -ForegroundColor Gray }
function Write-SKIP { param($msg)    Write-Host "        --- $msg" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "==================================================" -ForegroundColor DarkCyan
Write-Host "  TEST: Confirmar envio PJN - flujo real"          -ForegroundColor White
Write-Host "==================================================" -ForegroundColor DarkCyan

# Validar parametros obligatorios
if ($AuthToken -eq "") {
    Write-Host ""
    Write-Host "  FALTA: -AuthToken" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Como conseguirlo:" -ForegroundColor Yellow
    Write-Host "  1. Abri localhost:3000 en Chrome logueado" -ForegroundColor Yellow
    Write-Host "  2. F12 -> Application -> Local Storage" -ForegroundColor Yellow
    Write-Host "  3. Busca la key con 'access_token'" -ForegroundColor Yellow
    Write-Host "  4. Copia el valor (empieza con eyJ...)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Uso:" -ForegroundColor White
    Write-Host "  .\test-cargar-pjn.ps1 -AuthToken 'eyJ...'" -ForegroundColor White
    Write-Host "  .\test-cargar-pjn.ps1 -AuthToken 'eyJ...' -CedulaId 'uuid'" -ForegroundColor White
    Write-Host "==================================================" -ForegroundColor DarkCyan
    exit 1
}

$headersAuth = @{
    "Content-Type"  = "application/json"
    "Authorization" = "Bearer $AuthToken"
}

Write-Host "  App URL   : $AppUrl"
Write-Host "  Railway   : $RailwayUrl"
Write-Host "  Auth      : token provisto" -ForegroundColor Green
Write-Host "  Cedula ID : $(if ($CedulaId -ne '') { $CedulaId } else { '(autodetectar de /api/diligenciamiento)' })"
Write-Host "==================================================" -ForegroundColor DarkCyan
Write-Host ""

$errores = 0
$inicio  = Get-Date

# ── PASO 1: Railway online ────────────────────────────────────
Write-Step 1 "Verificando Railway OCR..."
try {
    $r = Invoke-RestMethod -Uri "$RailwayUrl/health" -Method GET -TimeoutSec 10
    Write-OK "Railway online - status: $($r.status)"
} catch {
    Write-FAIL "Railway no responde: $($_.Exception.Message)"
    $errores++
}

# ── PASO 2: Obtener cedulas de /api/diligenciamiento ──────────
Write-Step 2 "Obteniendo cedulas listas desde /api/diligenciamiento..."
$cedula = $null
try {
    $resp = Invoke-RestMethod -Uri "$AppUrl/api/diligenciamiento" -Method GET -Headers $headersAuth -TimeoutSec 10
    $lista = if ($resp.cedulas) { $resp.cedulas } else { $resp }
    Write-OK "$($lista.Count) cedulas listas en Diligenciamiento"

    if ($lista.Count -gt 0) {
        # Usar el ID pasado por parametro, o tomar la primera de la lista
        if ($CedulaId -ne "") {
            $cedula = $lista | Where-Object { $_.id -eq $CedulaId } | Select-Object -First 1
            if (-not $cedula) {
                Write-FAIL "No se encontro la cedula con ID: $CedulaId"
                Write-INFO "IDs disponibles:"
                $lista | ForEach-Object { Write-INFO "  $($_.id) | exp=$($_.ocr_exp_nro) | $($_.ocr_caratula)" }
                $errores++
            }
        } else {
            $cedula = $lista[0]
            Write-INFO "Usando primera cedula disponible (pasa -CedulaId para elegir otra)"
        }

        if ($cedula) {
            Write-INFO "Cedula seleccionada:"
            Write-INFO "  ID       : $($cedula.id)"
            Write-INFO "  Exp. Nro : $($cedula.ocr_exp_nro)"
            Write-INFO "  Caratula : $($cedula.ocr_caratula)"
            Write-INFO "  PDF URL  : $($cedula.pdf_acredita_url)"
        }
    } else {
        Write-FAIL "No hay cedulas listas en Diligenciamiento"
        Write-INFO "Necesitas que alguna cedula tenga estado_ocr = 'listo'"
        $errores++
    }
} catch {
    $status = $_.Exception.Response.StatusCode.value__
    if ($status -eq 401) {
        Write-FAIL "Token invalido o expirado (401)"
        Write-INFO "El token de Supabase dura 1 hora. Consegui uno nuevo."
    } elseif ($status -eq 404) {
        Write-FAIL "Endpoint /api/diligenciamiento no existe (404)"
    } else {
        Write-FAIL "Error HTTP $status`: $($_.Exception.Message)"
    }
    $errores++
}

# ── PASO 3: Verificar que el PDF existe y es accesible ────────
Write-Step 3 "Verificando que el PDF acredita es accesible..."
if ($cedula -and $cedula.pdf_acredita_url) {
    try {
        $r = Invoke-WebRequest -Uri $cedula.pdf_acredita_url -Method HEAD -TimeoutSec 10 -UseBasicParsing
        $size = $r.Headers["Content-Length"]
        Write-OK "PDF accesible (HTTP $($r.StatusCode)) - $size bytes"
    } catch {
        $status = $_.Exception.Response.StatusCode.value__
        if ($status -eq 403 -or $status -eq 401) {
            Write-FAIL "PDF no accesible (HTTP $status) - URL de Supabase puede haber expirado"
            $errores++
        } else {
            Write-INFO "HEAD respondio $status - intentando con GET..."
            try {
                $r = Invoke-WebRequest -Uri $cedula.pdf_acredita_url -Method GET -TimeoutSec 10 -UseBasicParsing
                Write-OK "PDF accesible via GET (HTTP $($r.StatusCode))"
            } catch {
                Write-FAIL "PDF no accesible: $($_.Exception.Message)"
                $errores++
            }
        }
    }
} else {
    Write-SKIP "Sin cedula seleccionada - saltando verificacion de PDF"
}

# ── PASO 4: Llamar a POST /api/cedulas/[id]/cargar-pjn ───────
# Esto es EXACTAMENTE lo que hace el boton "Confirmar envio"
Write-Step 4 "Simulando click 'Confirmar envio' -> POST /api/cedulas/[id]/cargar-pjn..."
if ($cedula) {
    $url = "$AppUrl/api/cedulas/$($cedula.id)/cargar-pjn"
    Write-INFO "POST $url"
    Write-INFO "(Este paso puede tardar 30-60 segundos si Railway usa Playwright)"
    try {
        $r = Invoke-RestMethod -Uri $url -Method POST -Headers $headersAuth -TimeoutSec 120
        if ($r.ok -eq $true) {
            if ($r.pruebaSinEnvio -eq $true) {
                Write-OK "MODO PRUEBA: flujo completado sin envio real"
                Write-INFO "pruebaSinEnvio=true en Railway - no se presento en el PJN"
            } else {
                Write-OK "EXITO: cedula cargada en PJN correctamente"
                Write-INFO "pjn_cargado_at: $($r.pjn_cargado_at)"
            }
        } else {
            Write-FAIL "La API respondio ok=false: $($r | ConvertTo-Json -Compress)"
            $errores++
        }
    } catch {
        $status = $_.Exception.Response.StatusCode.value__
        $body   = $_.ErrorDetails.Message
        if ($status -eq 404) {
            Write-FAIL "Endpoint cargar-pjn no existe (404) - falta implementar en Cursor"
        } elseif ($status -eq 401) {
            Write-FAIL "Token invalido o expirado (401)"
        } elseif ($status -eq 500) {
            Write-FAIL "Error interno (500): $body"
            Write-INFO "Revisa los logs de Vercel o Railway para el detalle"
        } else {
            Write-FAIL "Error HTTP $status`: $body"
        }
        $errores++
    }
} else {
    Write-SKIP "Sin cedula seleccionada - saltando llamada a cargar-pjn"
}

# ── PASO 5: Verificar que se guardo pjn_cargado_at ───────────
Write-Step 5 "Verificando que pjn_cargado_at se guardo en la DB..."
if ($cedula -and $errores -eq 0) {
    Start-Sleep -Seconds 2
    try {
        $resp2 = Invoke-RestMethod -Uri "$AppUrl/api/diligenciamiento" -Method GET -Headers $headersAuth -TimeoutSec 10
        $lista2 = if ($resp2.cedulas) { $resp2.cedulas } else { $resp2 }
        $actualizada = $lista2 | Where-Object { $_.id -eq $cedula.id } | Select-Object -First 1
        if ($actualizada -and $actualizada.pjn_cargado_at) {
            Write-OK "pjn_cargado_at guardado: $($actualizada.pjn_cargado_at)"
        } else {
            Write-INFO "pjn_cargado_at todavia null (puede ser modo prueba sin envio real)"
        }
    } catch {
        Write-SKIP "No se pudo verificar el estado final: $($_.Exception.Message)"
    }
} else {
    Write-SKIP "Saltando verificacion final"
}

# ── RESUMEN ───────────────────────────────────────────────────
$duracion = [int]((Get-Date) - $inicio).TotalSeconds
Write-Host ""
Write-Host "==================================================" -ForegroundColor DarkCyan
Write-Host "  RESUMEN" -ForegroundColor White
Write-Host "==================================================" -ForegroundColor DarkCyan
Write-Host "  Duracion : ${duracion}s"
if ($errores -eq 0) {
    Write-Host "  Resultado: TODOS LOS PASOS OK" -ForegroundColor Green
    Write-Host ""
    Write-Host "  El flujo Cargar en PJN funciona correctamente." -ForegroundColor Green
    Write-Host "  Podes probarlo en el browser:" -ForegroundColor Cyan
    Write-Host "  $AppUrl/diligenciamiento" -ForegroundColor Cyan
} else {
    Write-Host "  Resultado: $errores error(es)" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Revisa los pasos con ERR arriba." -ForegroundColor Yellow
}
Write-Host "==================================================" -ForegroundColor DarkCyan
Write-Host ""
