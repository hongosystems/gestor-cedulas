# Script de Deployment Automático para PDF Extractor Service
# Este script prepara todo y guía el proceso de deploy en Render

Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  DEPLOY AUTOMÁTICO: PDF EXTRACTOR SERVICE" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Verificar que estamos en el directorio correcto
if (-not (Test-Path "pdf-extractor-service")) {
    Write-Host "❌ Error: No se encuentra la carpeta pdf-extractor-service" -ForegroundColor Red
    Write-Host "   Asegúrate de ejecutar este script desde la raíz del proyecto" -ForegroundColor Yellow
    exit 1
}

# Verificar Git
Write-Host "📦 Verificando Git..." -ForegroundColor Yellow
try {
    $gitStatus = git status 2>&1
    Write-Host "✅ Git está disponible" -ForegroundColor Green
} catch {
    Write-Host "❌ Error: Git no está disponible" -ForegroundColor Red
    exit 1
}

# Verificar que los archivos necesarios existen
Write-Host ""
Write-Host "📋 Verificando archivos necesarios..." -ForegroundColor Yellow
$files = @(
    "pdf-extractor-service/server.js",
    "pdf-extractor-service/package.json",
    "pdf-extractor-service/Dockerfile"
)

$allFilesExist = $true
foreach ($file in $files) {
    if (Test-Path $file) {
        Write-Host "  ✅ $file" -ForegroundColor Green
    } else {
        Write-Host "  ❌ $file (NO ENCONTRADO)" -ForegroundColor Red
        $allFilesExist = $false
    }
}

if (-not $allFilesExist) {
    Write-Host ""
    Write-Host "❌ Faltan archivos necesarios. Abortando." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  PASO 1: AGREGAR ARCHIVOS A GIT" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$addToGit = Read-Host "¿Agregar archivos del microservicio a Git? (S/n)"

if ($addToGit -eq "" -or $addToGit -eq "S" -or $addToGit -eq "s") {
    Write-Host "Agregando archivos a Git..." -ForegroundColor Yellow
    git add pdf-extractor-service/
    git add app/api/extract-pdf/
    git add app/app/nueva/page.tsx
    Write-Host "✅ Archivos agregados" -ForegroundColor Green
} else {
    Write-Host "⏭️  Saltando paso de Git" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  PASO 2: INSTRUCCIONES PARA DEPLOY EN RENDER" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

Write-Host "Ahora necesitas desplegar el servicio en Render:" -ForegroundColor White
Write-Host ""
Write-Host "1. Abre tu navegador y ve a: https://render.com" -ForegroundColor Yellow
Write-Host "2. Haz clic en 'Sign Up' o 'Log In'" -ForegroundColor Yellow
Write-Host "3. En el Dashboard, haz clic en 'New +' → 'Web Service'" -ForegroundColor Yellow
Write-Host "4. Conecta tu repositorio de GitHub (autoriza Render si es necesario)" -ForegroundColor Yellow
Write-Host "5. Configura el servicio:" -ForegroundColor Yellow
Write-Host "   • Name: pdf-extractor-service" -ForegroundColor White
Write-Host "   • Region: Oregon (US West) o la más cercana" -ForegroundColor White
Write-Host "   • Branch: main" -ForegroundColor White
Write-Host "   • Root Directory: pdf-extractor-service" -ForegroundColor White
Write-Host "   • Runtime: Docker ⚠️ IMPORTANTE" -ForegroundColor White
Write-Host "   • Dockerfile Path: Dockerfile" -ForegroundColor White
Write-Host "   • Plan: Free (para probar) o Starter ($7/mes)" -ForegroundColor White
Write-Host "6. Haz clic en 'Create Web Service'" -ForegroundColor Yellow
Write-Host "7. Espera 5-10 minutos para que Render construya y despliegue el servicio" -ForegroundColor Yellow
Write-Host ""

$continue = Read-Host "Cuando el servicio esté desplegado, escribe 'OK' y presiona Enter (o 'skip' para saltar)"

if ($continue -eq "skip" -or $continue -eq "SKIP") {
    Write-Host ""
    Write-Host "⏭️  Saltando configuración de URL" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Cuando tengas la URL del servicio, ejecuta:" -ForegroundColor Yellow
    Write-Host "  .\scripts\update_pdf_extractor_url.ps1 -Url https://tu-servicio.onrender.com/extract" -ForegroundColor Cyan
    exit 0
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  PASO 3: CONFIGURAR URL DEL SERVICIO" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

Write-Host "En Render, encontrarás la URL del servicio en:" -ForegroundColor White
Write-Host "  • Dashboard → Tu servicio → Sección 'Info'" -ForegroundColor Yellow
Write-Host "  • La URL será algo como: https://pdf-extractor-service-xxxx.onrender.com" -ForegroundColor Yellow
Write-Host ""

$serviceUrl = Read-Host "Ingresa la URL del servicio (sin /extract, la agregamos automáticamente)"

if ($serviceUrl -eq "") {
    Write-Host "❌ URL vacía. Abortando." -ForegroundColor Red
    exit 1
}

# Limpiar la URL (quitar espacios y trailing slash)
$serviceUrl = $serviceUrl.Trim().TrimEnd('/')

# Agregar /extract si no lo tiene
if (-not $serviceUrl.EndsWith("/extract")) {
    if (-not $serviceUrl.EndsWith("/")) {
        $serviceUrl = "$serviceUrl/extract"
    } else {
        $serviceUrl = "$serviceUrl`extract"
    }
}

Write-Host ""
Write-Host "🔧 Actualizando .env.local con: $serviceUrl" -ForegroundColor Yellow

# Leer .env.local actual
$envPath = ".env.local"
$envContent = ""

if (Test-Path $envPath) {
    $envContent = Get-Content $envPath -Raw
} else {
    Write-Host "⚠️  .env.local no existe, se creará uno nuevo" -ForegroundColor Yellow
}

# Remover línea antigua de PDF_EXTRACTOR_URL si existe
$lines = $envContent -split "`n" | Where-Object { 
    $_ -notmatch "^PDF_EXTRACTOR_URL=" 
}

# Agregar nueva línea
$newLine = "PDF_EXTRACTOR_URL=$serviceUrl"
$lines += $newLine

# Escribir archivo actualizado
$newContent = $lines -join "`n"
Set-Content -Path $envPath -Value $newContent -NoNewline

Write-Host "✅ .env.local actualizado" -ForegroundColor Green

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  PASO 4: VERIFICAR EL SERVICIO" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$baseUrl = $serviceUrl -replace "/extract$", ""
$healthUrl = "$baseUrl/health"

Write-Host "Probando conexión al servicio..." -ForegroundColor Yellow
Write-Host "  URL: $healthUrl" -ForegroundColor White

try {
    $response = Invoke-WebRequest -Uri $healthUrl -Method GET -TimeoutSec 10 -UseBasicParsing
    if ($response.StatusCode -eq 200) {
        Write-Host "✅ El servicio está respondiendo correctamente!" -ForegroundColor Green
        Write-Host "   Respuesta: $($response.Content)" -ForegroundColor White
    }
} catch {
    Write-Host "⚠️  No se pudo conectar al servicio aún:" -ForegroundColor Yellow
    Write-Host "   $($_.Exception.Message)" -ForegroundColor White
    Write-Host ""
    Write-Host "   Esto es normal si:" -ForegroundColor Yellow
    Write-Host "   • El servicio aún se está desplegando (espera 5-10 minutos)" -ForegroundColor White
    Write-Host "   • Estás en plan Free y el servicio está 'dormido' (primera petición puede tardar ~30s)" -ForegroundColor White
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  ✅ CONFIGURACIÓN COMPLETA" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

Write-Host "Próximos pasos:" -ForegroundColor White
Write-Host "1. Reinicia tu servidor de desarrollo (Ctrl+C y luego 'npm run dev')" -ForegroundColor Yellow
Write-Host "2. Ve a http://localhost:3000/app/nueva" -ForegroundColor Yellow
Write-Host "3. Sube un PDF para probar la extracción automática" -ForegroundColor Yellow
Write-Host ""
Write-Host "Si el servicio está en plan Free de Render:" -ForegroundColor Yellow
Write-Host "  • La primera petición puede tardar ~30 segundos (el servicio 'despierta')" -ForegroundColor White
Write-Host "  • Si no responde, verifica en Render Dashboard que el servicio esté corriendo" -ForegroundColor White
Write-Host ""
