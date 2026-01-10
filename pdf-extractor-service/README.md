# PDF Extractor Service

Microservicio para extraer texto de PDFs usando Poppler (pdftotext) y Tesseract OCR como fallback.

## Características

- Extrae texto de PDFs usando `pdftotext` (Poppler)
- Si el texto es vacío o muy corto, usa OCR con Tesseract (español)
- Extrae automáticamente **Carátula** y **Juzgado** según patrones específicos
- Limita el OCR a las primeras N páginas (configurable, default: 5)
- Limpieza automática de archivos temporales

## Requisitos

- Node.js 20+
- Docker (para deployment en Render)

## Instalación Local

```bash
npm install
npm start
```

## Variables de Entorno

- `PORT`: Puerto del servidor (default: 3000)
- `MAX_OCR_PAGES`: Máximo de páginas para procesar con OCR (default: 5)

## API

### POST /extract

Extrae texto de un PDF y retorna Carátula y Juzgado.

**Request:**
- Content-Type: `multipart/form-data`
- Campo: `file` (archivo PDF)

**Response:**
```json
{
  "caratula": "PEREZ C/ GOMEZ S/ DAÑOS",
  "juzgado": "JUZGADO NACIONAL EN LO CIVIL N° 17",
  "raw_preview": "Primeros 500 caracteres del texto extraído...",
  "debug": {
    "ocr_used": true,
    "pagesProcessed": 3,
    "totalPages": 5
  }
}
```

## Deployment en Render

### Paso a Paso (Click-by-Click)

1. **Crear cuenta en Render** (si no tienes):
   - Ve a https://render.com
   - Haz clic en "Get Started" o "Sign Up"
   - Completa el registro

2. **Preparar el repositorio**:
   - Sube esta carpeta (`pdf-extractor-service`) a un repositorio Git (GitHub, GitLab, Bitbucket)
   - O crea un nuevo repositorio solo para este servicio

3. **Crear nuevo Web Service en Render**:
   - En el Dashboard de Render, haz clic en **"New +"** (arriba a la derecha)
   - Selecciona **"Web Service"**

4. **Conectar repositorio**:
   - Si es la primera vez, haz clic en **"Connect account"** y autoriza Render
   - Selecciona tu repositorio de la lista
   - Haz clic en **"Connect"**

5. **Configurar el servicio**:
   - **Name**: `pdf-extractor-service` (o el que prefieras)
   - **Region**: Selecciona la región más cercana (ej: `Oregon (US West)`)
   - **Branch**: `main` (o la rama que uses)
   - **Root Directory**: Si el servicio está en una subcarpeta, especifica `pdf-extractor-service`. Si es el repositorio raíz, déjalo vacío.
   - **Runtime**: `Docker` (IMPORTANTE: selecciona Docker, no Node)
   - **Dockerfile Path**: `Dockerfile` (o `pdf-extractor-service/Dockerfile` si está en subcarpeta)

6. **Variables de Entorno** (opcional):
   - Haz clic en **"Advanced"** para expandir
   - En **"Environment Variables"**, puedes agregar:
     - `MAX_OCR_PAGES=5` (si quieres cambiar el default)
   - El `PORT` lo establece Render automáticamente

7. **Plan de servicio**:
   - Selecciona el plan **Free** (para empezar) o **Starter** ($7/mes)
   - El plan Free tiene limitaciones (se apaga después de 15 min de inactividad)
   - Para producción, usa Starter o superior

8. **Deploy**:
   - Haz clic en **"Create Web Service"**
   - Render comenzará a construir y desplegar el servicio
   - Esto puede tomar 5-10 minutos la primera vez
   - Verás los logs en tiempo real

9. **Obtener la URL**:
   - Una vez desplegado, Render te dará una URL como:
     - `https://pdf-extractor-service-xxxx.onrender.com`
   - Copia esta URL, la necesitarás para configurar en Vercel

10. **Verificar el servicio**:
    - Abre en tu navegador: `https://tu-servicio.onrender.com/health`
    - Deberías ver: `{"status":"ok","service":"pdf-extractor"}`

### Actualizar el servicio

Cada vez que hagas `git push` a la rama conectada, Render desplegará automáticamente una nueva versión.

### Ver logs

- En el Dashboard de Render, selecciona tu servicio
- Ve a la pestaña **"Logs"**
- Ahí verás todos los logs del servicio en tiempo real

### Problemas comunes

1. **Error: "Command failed"**:
   - Verifica que el Dockerfile esté correcto
   - Revisa los logs en Render para ver el error específico

2. **El servicio se apaga**:
   - En plan Free, Render apaga el servicio después de 15 min de inactividad
   - La primera petición después de apagarse puede tardar ~30 segundos en "despertar"
   - Para evitar esto, usa un plan pago

3. **Error al instalar dependencias del sistema**:
   - Verifica que el Dockerfile instale correctamente `poppler-utils` y `tesseract-ocr`

## Testing Local

### Con curl (PowerShell):

```powershell
# Reemplaza con la ruta a tu archivo PDF
$filePath = "C:\ruta\a\tu\archivo.pdf"

# Si el servicio corre localmente en puerto 3000
curl -X POST http://localhost:3000/extract `
  -F "file=@$filePath"
```

### Con fetch (JavaScript):

```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);

const response = await fetch('http://localhost:3000/extract', {
  method: 'POST',
  body: formData
});

const data = await response.json();
console.log(data);
```

## Estructura del Proyecto

```
pdf-extractor-service/
├── server.js          # Servidor Express con lógica de extracción
├── package.json       # Dependencias Node.js
├── Dockerfile         # Configuración Docker con Poppler y Tesseract
├── .dockerignore      # Archivos a ignorar en Docker
└── README.md          # Esta documentación
```
