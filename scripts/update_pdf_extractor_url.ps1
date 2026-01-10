# Script para actualizar la URL del PDF Extractor en .env.local
# Uso: .\scripts\update_pdf_extractor_url.ps1 -Url https://tu-servicio.onrender.com/extract

param(
    [Parameter(Mandatory=$true)]
    [string]$Url
)

$envPath = ".env.local"

Write-Host "🔧 Actualizando PDF_EXTRACTOR_URL en .env.local..." -ForegroundColor Yellow

# Limpiar la URL
$cleanUrl = $Url.Trim().TrimEnd('/')

# Agregar /extract si no lo tiene
if (-not $cleanUrl.EndsWith("/extract")) {
    if (-not $cleanUrl.EndsWith("/")) {
        $cleanUrl = "$cleanUrl/extract"
    } else {
        $cleanUrl = "$cleanUrl`extract"
    }
}

# Leer .env.local
$envContent = ""
if (Test-Path $envPath) {
    $envContent = Get-Content $envPath -Raw
} else {
    Write-Host "⚠️  .env.local no existe, se creará uno nuevo" -ForegroundColor Yellow
}

# Remover línea antigua si existe
$lines = $envContent -split "`n" | Where-Object { 
    $_ -notmatch "^PDF_EXTRACTOR_URL=" 
}

# Agregar nueva línea
$lines += "PDF_EXTRACTOR_URL=$cleanUrl"

# Escribir archivo
$newContent = $lines -join "`n"
Set-Content -Path $envPath -Value $newContent -NoNewline

Write-Host "✅ .env.local actualizado con: $cleanUrl" -ForegroundColor Green
Write-Host ""
Write-Host "⚠️  No olvides reiniciar tu servidor de desarrollo!" -ForegroundColor Yellow
