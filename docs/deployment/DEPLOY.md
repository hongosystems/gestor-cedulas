# 🚀 Guía de Deploy Automático - Gestor de Cédulas

Este documento explica cómo configurar el deploy automático a Vercel para que todos los cambios se desplieguen automáticamente.

## 📋 Configuración Inicial (Una sola vez)

### 1. Configurar Credenciales de GitHub

El proyecto está configurado para hacer deploy automático cuando se hace push a la rama `main`. Para que funcione, necesitas tener las credenciales correctas configuradas.

#### Opción A: Usar Personal Access Token (Recomendado)

1. **Crear un Personal Access Token:**
   - Ve a: https://github.com/settings/tokens
   - Click en "Generate new token (classic)"
   - Nombre: "Vercel Deploy - Gestor Cédulas"
   - Scope: Selecciona `repo` (acceso completo a repositorios)
   - Click en "Generate token"
   - **Copia el token** (solo se muestra una vez)

2. **Configurar Git:**
   ```powershell
   # Eliminar credenciales incorrectas (si existen)
   cmdkey /delete:LegacyGeneric:target=git:https://github.com
   
   # Configurar helper de credenciales
   git config --global credential.helper manager-core
   ```

3. **Hacer push (pedirá credenciales):**
   ```powershell
   git push origin main
   ```
   - **Usuario:** Tu usuario de GitHub o `hongosystems`
   - **Contraseña:** Usa el Personal Access Token (NO tu contraseña)

#### Opción B: Usar SSH (Alternativa)

Si prefieres usar SSH en lugar de HTTPS:

```powershell
# Cambiar remoto a SSH
git remote set-url origin git@github.com:hongosystems/gestor-cedulas.git
```

## 🔄 Proceso de Deploy Automático

### Método 1: Script Automático (Recomendado)

Usa el script `deploy.ps1` que automatiza todo el proceso:

```powershell
.\deploy.ps1
```

El script:
- ✅ Verifica que estés en la rama `main`
- ✅ Detecta cambios sin commitear
- ✅ Hace commit si es necesario
- ✅ Hace push a GitHub
- ✅ Vercel despliega automáticamente

### Método 2: Manual

```powershell
# 1. Asegúrate de estar en main
git checkout main

# 2. Agrega tus cambios
git add -A

# 3. Haz commit
git commit -m "Descripción de los cambios"

# 4. Haz push
git push origin main
```

## 🌐 URLs de Deploy

- **Producción:** https://gestor-cedulas-o50pft3th-hongosystems-projects.vercel.app
- **Dashboard Vercel:** https://vercel.com/hongosystems-projects/gestor-cedulas
- **Repositorio GitHub:** https://github.com/hongosystems/gestor-cedulas

## ✅ Verificación del Deploy

Después de hacer push:

1. **Verifica en Vercel Dashboard:**
   - Ve a: https://vercel.com/hongosystems-projects/gestor-cedulas
   - Click en "Deployments"
   - Deberías ver un nuevo deployment en progreso

2. **Espera a que complete:**
   - El build toma aproximadamente 2-5 minutos
   - Verás un indicador verde cuando esté listo

3. **Verifica la URL de producción:**
   - https://gestor-cedulas-o50pft3th-hongosystems-projects.vercel.app
   - Debería mostrar los cambios más recientes

## 🔧 Solución de Problemas

### Error: "Permission denied to plan-industrial"

**Problema:** Las credenciales guardadas están usando un usuario incorrecto.

**Solución:**
```powershell
# Eliminar credenciales incorrectas
cmdkey /delete:LegacyGeneric:target=git:https://github.com

# Intentar push de nuevo (pedirá nuevas credenciales)
git push origin main
```

### Error: "Authentication failed"

**Problema:** Las credenciales no son válidas.

**Solución:**
1. Verifica que estés usando un Personal Access Token (no tu contraseña)
2. Asegúrate de que el token tenga el scope `repo`
3. Regenera el token si es necesario

### El deploy no se inicia automáticamente

**Problema:** Vercel no está detectando los cambios.

**Solución:**
1. Verifica en Vercel Dashboard → Settings → Git
2. Asegúrate de que esté conectado al repositorio correcto
3. Verifica que la rama de producción sea `main`
4. Si es necesario, haz un "Redeploy" manual desde el dashboard

## 📝 Notas Importantes

- ⚠️ **Siempre haz commit antes de push** - Los cambios sin commitear no se desplegarán
- ⚠️ **Usa la rama `main`** - Solo los cambios en `main` se despliegan a producción
- ✅ **El deploy es automático** - No necesitas hacer nada en Vercel después del push
- ✅ **Los builds toman 2-5 minutos** - Sé paciente después del push

## 🎯 Flujo Completo

```
1. Hacer cambios en el código
   ↓
2. git add -A
   ↓
3. git commit -m "Descripción"
   ↓
4. git push origin main
   ↓
5. Vercel detecta el push automáticamente
   ↓
6. Vercel inicia el build
   ↓
7. Deploy a producción (2-5 minutos)
   ↓
8. ✅ Cambios disponibles en producción
```

---

**Última actualización:** $(Get-Date -Format "yyyy-MM-dd")
