# Guía de Deployment: PDF Extractor Service

Esta guía documenta cómo configurar y desplegar el microservicio de extracción de PDFs y la integración con Next.js.

## 📋 Tabla de Contenidos

1. [Microservicio PDF Extractor](#microservicio-pdf-extractor)
2. [Configuración en Next.js](#configuración-en-nextjs)
3. [Variables de Entorno](#variables-de-entorno)
4. [Testing](#testing)
5. [Troubleshooting](#troubleshooting)

---

## 🚀 Microservicio PDF Extractor

### Estructura del Proyecto

El microservicio está en la carpeta `pdf-extractor-service/` y es un proyecto separado que se despliega en Render.

### Archivos Importantes

- `server.js`: Servidor Express con lógica de extracción
- `package.json`: Dependencias Node.js
- `Dockerfile`: Configuración Docker con Poppler y Tesseract
- `README.md`: Documentación completa del microservicio

### Deployment en Render

**Ver instrucciones detalladas en:** `pdf-extractor-service/README.md`

**Resumen rápido:**

1. Sube la carpeta `pdf-extractor-service` a un repositorio Git (puede ser un repo separado o el mismo repo del proyecto)
2. En Render Dashboard → **"New +"** → **"Web Service"**
3. Conecta tu repositorio
4. Configura:
   - **Runtime**: `Docker`
   - **Dockerfile Path**: `pdf-extractor-service/Dockerfile` (o `Dockerfile` si es repo separado)
   - **Root Directory**: `pdf-extractor-service` (si está en subcarpeta)
5. Variables de entorno (opcional):
   - `MAX_OCR_PAGES=5` (default: 5)
   - `PORT` se configura automáticamente
6. Haz clic en **"Create Web Service"**
7. Espera 5-10 minutos para el primer deploy
8. Obtén la URL del servicio (ej: `https://pdf-extractor-service-xxxx.onrender.com`)

### Verificar el Servicio

Abre en tu navegador: `https://tu-servicio.onrender.com/health`

Deberías ver:
```json
{"status":"ok","service":"pdf-extractor"}
```

---

## 🔧 Configuración en Next.js

### Paso 1: Crear/Editar `.env.local`

En la raíz del proyecto `gestor-cedulas`, crea o edita el archivo `.env.local`:

```env
# URL del microservicio PDF extractor (sin /extract al final)
PDF_EXTRACTOR_URL=https://tu-servicio.onrender.com/extract
```

**IMPORTANTE:** La URL debe incluir `/extract` al final (ej: `https://pdf-extractor-service-xxxx.onrender.com/extract`)

### Paso 2: Configurar Variables de Entorno en Vercel

1. Ve a tu proyecto en **Vercel Dashboard**
2. Selecciona tu proyecto (`gestor-cedulas`)
3. Ve a **Settings** → **Environment Variables**
4. Agrega una nueva variable:
   - **Name**: `PDF_EXTRACTOR_URL`
   - **Value**: `https://tu-servicio.onrender.com/extract` (reemplaza con tu URL real)
   - **Environments**: Marca todas (Production, Preview, Development)
5. Haz clic en **Save**

### Paso 3: Archivos Creados/Modificados

#### ✅ Nuevo archivo creado:
- `app/api/extract-pdf/route.ts`: Endpoint que reenvía PDFs al microservicio

#### ✅ Archivo modificado:
- `app/app/nueva/page.tsx`: Actualizado para usar `/api/extract-pdf` cuando el archivo es PDF

**Compatibilidad mantenida:**
- DOCX sigue usando los endpoints actuales (`/api/extract-caratula`, `/api/extract-juzgado`)
- PDF ahora usa el nuevo endpoint que reenvía al microservicio

---

## 📝 Variables de Entorno

### En el Microservicio (Render)

| Variable | Descripción | Default | Requerida |
|----------|-------------|---------|-----------|
| `PORT` | Puerto del servidor | `3000` | No (lo establece Render) |
| `MAX_OCR_PAGES` | Máximo de páginas para OCR | `5` | No |

### En Next.js (Vercel)

| Variable | Descripción | Default | Requerida |
|----------|-------------|---------|-----------|
| `PDF_EXTRACTOR_URL` | URL completa del endpoint `/extract` del microservicio | - | **Sí** |

**Ejemplo:**
```env
PDF_EXTRACTOR_URL=https://pdf-extractor-service-xxxx.onrender.com/extract
```

---

## 🧪 Testing

### 1. Testing Local del Microservicio

Si quieres probar el microservicio localmente (requiere tener Poppler y Tesseract instalados):

```bash
cd pdf-extractor-service
npm install
npm start
```

Luego prueba con curl (PowerShell):

```powershell
# Reemplaza con la ruta a tu archivo PDF
$filePath = "C:\ruta\a\tu\archivo.pdf"

curl -X POST http://localhost:3000/extract -F "file=@$filePath"
```

### 2. Testing desde la UI de Next.js

1. Inicia el servidor de desarrollo:
   ```bash
   npm run dev
   ```
2. Ve a `http://localhost:3000/app/nueva`
3. Sube un archivo PDF
4. Los campos "Carátula" y "Juzgado" deberían autocompletarse si el PDF contiene la información

### 3. Testing con curl (PowerShell) - Endpoint Next.js

```powershell
# Reemplaza con la ruta a tu archivo PDF
$filePath = "C:\ruta\a\tu\archivo.pdf"

curl -X POST http://localhost:3000/api/extract-pdf -F "file=@$filePath"
```

**Respuesta esperada:**
```json
{
  "caratula": "PEREZ C/ GOMEZ S/ DAÑOS",
  "juzgado": "JUZGADO NACIONAL EN LO CIVIL N° 17",
  "raw_preview": "Primeros 500 caracteres del texto..."
}
```

### 4. Testing en Producción (Vercel)

1. Despliega los cambios a producción (ver sección de Deploy más abajo)
2. Verifica que la variable de entorno `PDF_EXTRACTOR_URL` esté configurada en Vercel
3. Prueba subiendo un PDF desde la UI de producción

---

## 📊 Ver Logs

### Logs del Microservicio (Render)

1. Ve a **Render Dashboard**
2. Selecciona tu servicio `pdf-extractor-service`
3. Haz clic en la pestaña **"Logs"**
4. Verás los logs en tiempo real

### Logs de Next.js (Vercel)

1. Ve a **Vercel Dashboard**
2. Selecciona tu proyecto
3. Ve a **Deployments** → Selecciona el último deployment
4. Haz clic en **"Functions"** para ver logs de funciones serverless
5. O usa `vercel logs` si tienes Vercel CLI instalado

---

## 🔍 Troubleshooting

### Problema: "PDF_EXTRACTOR_URL no está configurada"

**Causa:** La variable de entorno no está configurada en Vercel o `.env.local`

**Solución:**
1. Verifica que `.env.local` tenga `PDF_EXTRACTOR_URL` con la URL correcta
2. Verifica que en Vercel → Settings → Environment Variables esté configurada
3. Vuelve a desplegar después de agregar la variable

### Problema: "No se pudo conectar al servicio de extracción"

**Causa:** El microservicio no está disponible o la URL es incorrecta

**Solución:**
1. Verifica que el servicio esté corriendo en Render:
   - Abre `https://tu-servicio.onrender.com/health`
   - Debería responder `{"status":"ok"}`
2. Si el servicio está en plan Free, puede estar "dormido". La primera petición puede tardar ~30 segundos
3. Verifica que la URL en `PDF_EXTRACTOR_URL` incluya `/extract` al final

### Problema: "Error procesando PDF" en el microservicio

**Causa:** Error al ejecutar `pdftotext` o `tesseract`

**Solución:**
1. Revisa los logs en Render
2. Verifica que el PDF no esté corrupto
3. Si el PDF es escaneado (imagen), el OCR debería activarse automáticamente

### Problema: No se detecta Carátula/Juzgado

**Causa:** El PDF no contiene los patrones esperados o el texto no se extrajo correctamente

**Solución:**
1. Esto no es un error crítico - el usuario puede completar los campos manualmente
2. Verifica que el PDF tenga texto (no solo imágenes)
3. Si es un PDF escaneado, asegúrate de que el OCR se ejecutó (revisa logs del microservicio)

### Problema: Build falla en Vercel

**Causa:** Error de TypeScript o dependencias

**Solución:**
1. Ejecuta `npm run build` localmente para ver el error
2. Verifica que `app/api/extract-pdf/route.ts` no tenga errores de TypeScript
3. Asegúrate de que no haya imports faltantes

---

## 🚢 Deploy a Producción

### Comandos para subir cambios

**Paso 1: Agregar todos los cambios**
```bash
git add -A
```

**Paso 2: Commit**
```bash
git commit -m "feat: integración con microservicio PDF extractor"
```

**Paso 3: Push**
```bash
git push origin main
```

**Vercel desplegará automáticamente** cuando hagas push a `main` (si está configurado el auto-deploy).

### Verificar después del deploy

1. Ve a Vercel Dashboard → Deployments
2. Espera a que el deployment termine (debería mostrar "Ready")
3. Abre la URL de producción
4. Prueba subiendo un PDF en `/app/nueva`

---

## 📚 Resumen de Flujo

```
Usuario sube PDF en /app/nueva
    ↓
Frontend (React) llama a /api/extract-pdf
    ↓
Next.js API Route reenvía el archivo al microservicio
    ↓
Microservicio (Render):
  1. Extrae texto con pdftotext
  2. Si falla, usa OCR con Tesseract
  3. Extrae Carátula y Juzgado con regex
  4. Retorna JSON { caratula, juzgado, raw_preview }
    ↓
Next.js API Route retorna la respuesta al frontend
    ↓
Frontend autocompleta los campos Carátula y Juzgado
```

---

## ✅ Checklist de Deployment

- [ ] Microservicio desplegado en Render
- [ ] Health check del microservicio funciona (`/health`)
- [ ] Variable `PDF_EXTRACTOR_URL` configurada en Vercel
- [ ] Variable `PDF_EXTRACTOR_URL` configurada en `.env.local` (desarrollo)
- [ ] Cambios en Next.js commiteados y pusheados
- [ ] Deployment en Vercel completado exitosamente
- [ ] Probado subiendo un PDF desde la UI de producción
- [ ] Verificados los logs en Render y Vercel

---

## 📞 Soporte

Si encuentras problemas:

1. Revisa los logs en Render (microservicio) y Vercel (Next.js)
2. Verifica que todas las variables de entorno estén configuradas
3. Asegúrate de que el microservicio esté corriendo (plan Free puede estar "dormido")
4. Prueba primero con un PDF simple que contenga texto claro
