# Script de Deploy Automático para Gestor de Cédulas
# Este script asegura que los cambios se desplieguen automáticamente en Vercel

Write-Host "🚀 Iniciando proceso de deploy..." -ForegroundColor Cyan

# Verificar que estamos en la rama main
$currentBranch = git branch --show-current
if ($currentBranch -ne "main") {
    Write-Host "⚠️  Estás en la rama '$currentBranch'. Cambiando a 'main'..." -ForegroundColor Yellow
    git checkout main
}

# Verificar estado de Git
Write-Host "`n📊 Verificando estado del repositorio..." -ForegroundColor Cyan
git status

# Verificar si hay cambios sin commitear
$status = git status --porcelain
if ($status) {
    Write-Host "`n⚠️  Hay cambios sin commitear. ¿Deseas hacer commit? (S/N)" -ForegroundColor Yellow
    $response = Read-Host
    if ($response -eq "S" -or $response -eq "s") {
        Write-Host "`n📝 Ingresa el mensaje del commit:" -ForegroundColor Cyan
        $commitMessage = Read-Host
        git add -A
        git commit -m $commitMessage
        Write-Host "✅ Cambios commiteados" -ForegroundColor Green
    } else {
        Write-Host "❌ Deploy cancelado. Haz commit de tus cambios primero." -ForegroundColor Red
        exit 1
    }
}

# Verificar si hay commits sin push
$localCommits = git log origin/main..HEAD --oneline
if ($localCommits) {
    Write-Host "`n📤 Haciendo push a GitHub..." -ForegroundColor Cyan
    Write-Host "   (Si te pide credenciales, usa tu usuario de GitHub y un Personal Access Token)" -ForegroundColor Yellow
    
    $pushResult = git push origin main 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Push exitoso!" -ForegroundColor Green
        Write-Host "`n🎉 El deploy automático en Vercel debería iniciarse en unos momentos..." -ForegroundColor Green
        Write-Host "   URL: https://gestor-cedulas-o50pft3th-hongosystems-projects.vercel.app" -ForegroundColor Cyan
        Write-Host "`n📊 Puedes verificar el estado en:" -ForegroundColor Cyan
        Write-Host "   https://vercel.com/hongosystems-projects/gestor-cedulas" -ForegroundColor Cyan
    } else {
        Write-Host "❌ Error al hacer push:" -ForegroundColor Red
        Write-Host $pushResult -ForegroundColor Red
        Write-Host "`n💡 Solución:" -ForegroundColor Yellow
        Write-Host "   1. Elimina las credenciales incorrectas:" -ForegroundColor White
        Write-Host "      cmdkey /delete:LegacyGeneric:target=git:https://github.com" -ForegroundColor Gray
        Write-Host "   2. Vuelve a intentar el push" -ForegroundColor White
        Write-Host "   3. Cuando pida credenciales, usa tu usuario de GitHub y un Personal Access Token" -ForegroundColor White
        exit 1
    }
} else {
    Write-Host "`n✅ No hay commits nuevos para hacer push" -ForegroundColor Green
    Write-Host "   El código ya está sincronizado con GitHub" -ForegroundColor Gray
}

Write-Host "`n✨ Proceso completado!" -ForegroundColor Green
