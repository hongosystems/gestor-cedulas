# 🔧 Fix: Root Directory Configurado Incorrectamente

## ❌ Problema

Render está buscando el Dockerfile pero el **Root Directory** está mal configurado.

**Error:**
```
Root directory "Dockerfile" does not exist.
```

## ✅ Solución

El problema es que configuraste el **Root Directory** como `Dockerfile` cuando debería ser `pdf-extractor-service`.

### Configuración Correcta en Render:

1. Ve a tu servicio en Render Dashboard
2. Haz clic en **"Settings"** (Configuración)
3. Busca la sección **"Build & Deploy"**
4. Configura estos valores:

| Campo | Valor Correcto |
|-------|---------------|
| **Root Directory** | `pdf-extractor-service` ⚠️ IMPORTANTE |
| **Dockerfile Path** | `Dockerfile` |
| **Runtime** | `Docker` |

### Paso a Paso:

1. **Root Directory**: 
   - Actualmente probablemente tiene: `Dockerfile` ❌
   - Debe ser: `pdf-extractor-service` ✅
   - Esto le dice a Render que busque dentro de esa carpeta

2. **Dockerfile Path**:
   - Debe ser: `Dockerfile` ✅
   - Esto es el nombre del archivo dentro del Root Directory

3. **Runtime**:
   - Debe ser: `Docker` ✅

4. **Build Command**:
   - Déjalo **vacío** ✅

5. **Start Command**:
   - Déjalo **vacío** ✅

### Después de Cambiar:

1. Haz clic en **"Save Changes"**
2. Ve a la pestaña **"Logs"** o **"Events"**
3. Haz clic en **"Manual Deploy"** → **"Deploy latest commit"**
4. Espera 5-10 minutos

## 📊 Estructura Correcta que Render Buscará:

```
gestor-cedulas/                    (raíz del repo)
  └── pdf-extractor-service/       (Root Directory)
      ├── Dockerfile              (Dockerfile Path)
      ├── package.json
      ├── server.js
      └── ...
```

## ✅ Verificación

Después del cambio, en los logs deberías ver:
```
==> Root directory "pdf-extractor-service" found
==> Building Docker image...
==> Installing Poppler and Tesseract...
```

**NO** deberías ver:
- ❌ `Root directory "Dockerfile" does not exist`
- ❌ `not a directory`
