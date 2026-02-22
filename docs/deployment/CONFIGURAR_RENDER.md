# 🔧 Configurar Render para usar Docker

## ❌ Problema Actual

Render está configurado como **Node.js** en lugar de **Docker**, por eso está intentando ejecutar `npm run build`.

## ✅ Solución: Cambiar a Docker

### Paso 1: Ve a tu servicio en Render

1. Abre https://dashboard.render.com
2. Ve a tu servicio `pdf-extractor-service`
3. Haz clic en **"Settings"** (Configuración) en el menú lateral

### Paso 2: Cambiar Runtime a Docker

1. Busca la sección **"Build & Deploy"**
2. En **"Runtime"**, cambia de **"Node"** a **"Docker"**
3. Configura:
   - **Root Directory**: `pdf-extractor-service` ⚠️ IMPORTANTE: Esta es la CARPETA, no el archivo
   - **Dockerfile Path**: `Dockerfile` (el nombre del archivo dentro del Root Directory)
   
   ⚠️ **IMPORTANTE**: 
   - Root Directory = `pdf-extractor-service` (carpeta)
   - Dockerfile Path = `Dockerfile` (archivo dentro de la carpeta)
   - NO confundas Root Directory con Dockerfile Path
   
4. Haz clic en **"Save Changes"**

### Paso 3: Limpiar Build Command

1. Busca **"Build Command"** en la misma sección
2. **Déjalo vacío** o elimínalo (Docker no necesita un build command, construye la imagen automáticamente)
3. Guarda los cambios

### Paso 4: Verificar Start Command

1. Busca **"Start Command"** 
2. **Déjalo vacío** (Docker usa el CMD del Dockerfile: `node server.js`)
3. Guarda los cambios

### Paso 5: Desplegar

1. Haz clic en **"Manual Deploy"** en el menú superior
2. Selecciona **"Deploy latest commit"**
3. Espera 5-10 minutos para que Render construya la imagen Docker

## ✅ Qué Debería Pasar Ahora

Con Docker configurado correctamente:
1. Render construirá la imagen Docker (instalará Poppler y Tesseract automáticamente)
2. No ejecutará `npm run build`
3. El servicio iniciará con `node server.js` según el Dockerfile
4. Podrás acceder al servicio en la URL proporcionada

## 🔍 Verificar en los Logs

Después del deploy, en los logs deberías ver:
```
=> Building Docker image...
=> Installing Poppler and Tesseract...
=> Starting service...
PDF Extractor Service escuchando en puerto XXXX
```

**NO** deberías ver:
- ❌ `npm install; npm run build`
- ❌ `Missing script: "build"`

## 📊 Resumen de Configuración Correcta

| Configuración | Valor |
|--------------|-------|
| **Runtime** | `Docker` |
| **Root Directory** | `pdf-extractor-service` ⚠️ (la CARPETA) |
| **Dockerfile Path** | `Dockerfile` (el archivo dentro de la carpeta) |
| **Build Command** | _(vacío)_ |
| **Start Command** | _(vacío)_ |

⚠️ **IMPORTANTE**: 
- **Root Directory** es la **carpeta** que contiene el Dockerfile
- **Dockerfile Path** es el **nombre del archivo** Dockerfile dentro de esa carpeta
