# 🔧 Fix: Error de Deploy en Render

## ❌ Problema

Render está intentando ejecutar `npm run build` pero el `package.json` no tiene ese script.

**Error:**
```
npm error Missing script: "build"
```

## ✅ Solución

He agregado un script "build" vacío al `package.json` del microservicio. Esto soluciona el error inmediato.

**PERO**, el problema real es que **Render debe estar configurado para usar Docker**, no Node.js directamente.

## 🔧 Configuración Correcta en Render

Asegúrate de que en Render Dashboard:

1. **Runtime**: Debe ser `Docker` (NO `Node`)
2. **Dockerfile Path**: `Dockerfile` (o `pdf-extractor-service/Dockerfile` si está en subcarpeta)
3. **Root Directory**: `pdf-extractor-service`

### Si Render está usando Node.js en lugar de Docker:

1. Ve a tu servicio en Render Dashboard
2. Haz clic en **"Settings"** (Configuración)
3. Busca **"Environment"** o **"Build & Deploy"**
4. Cambia **"Runtime"** a **"Docker"**
5. Configura:
   - **Dockerfile Path**: `Dockerfile`
   - **Root Directory**: `pdf-extractor-service`
6. Guarda los cambios
7. Haz clic en **"Manual Deploy"** → **"Deploy latest commit"**

## 🚀 Después del Fix

Una vez configurado correctamente:
1. Render construirá la imagen Docker
2. Instalará Poppler y Tesseract automáticamente
3. El servicio estará listo

## ⚠️ Verificación

Después del deploy, verifica que:
- El servicio esté en estado "Live"
- La URL `/health` responda: `{"status":"ok","service":"pdf-extractor"}`
- Los logs muestren: "PDF Extractor Service escuchando en puerto XXXX"
