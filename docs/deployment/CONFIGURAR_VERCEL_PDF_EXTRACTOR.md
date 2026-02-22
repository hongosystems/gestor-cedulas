# Configurar PDF_EXTRACTOR_URL en Vercel

## Problema
El error `503 Service Unavailable` en `/api/extract-pdf` indica que la variable de entorno `PDF_EXTRACTOR_URL` no está configurada en Vercel.

## Solución

### Paso 1: Obtener la URL del microservicio
Según los logs de Render, el servicio está disponible en:
```
https://gestor-pdf.onrender.com
```

El endpoint de extracción es:
```
https://gestor-pdf.onrender.com/extract
```

### Paso 2: Configurar en Vercel

1. Ve a tu dashboard de Vercel: https://vercel.com/dashboard
2. Selecciona el proyecto `gestor-cedulas`
3. Ve a **Settings** → **Environment Variables**
4. Agrega una nueva variable:
   - **Name:** `PDF_EXTRACTOR_URL`
   - **Value:** `https://gestor-pdf.onrender.com/extract`
   - **Environments:** Marca todas (Production, Preview, Development)
5. Haz clic en **Save**
6. **IMPORTANTE:** Debes hacer un nuevo deploy para que la variable tome efecto:
   - Ve a **Deployments**
   - Haz clic en el menú (⋯) del último deployment
   - Selecciona **Redeploy**
   - O mejor: haz un commit/push vacío para trigger un nuevo deploy automático

### Paso 3: Verificar

Después del redeploy, prueba subir un PDF. Deberías ver:
- El loader "Recopilando Información de Documento Adjunto"
- La extracción automática de carátula y juzgado (si el PDF tiene texto embebido)

## Nota sobre Render

Los logs de Render muestran `MAX_OCR_PAGES: 5`, lo que indica que está ejecutando una versión antigua del código. Para actualizar:

1. En Render, el servicio debería hacer auto-deploy desde GitHub
2. Si no lo hace automáticamente, ve a tu servicio en Render
3. Haz clic en **Manual Deploy** → **Deploy latest commit**

## Verificación

Para verificar que todo funciona:
1. Sube un PDF en la aplicación
2. Revisa los logs de Vercel (Functions → `/api/extract-pdf`)
3. Revisa los logs de Render para ver el procesamiento del PDF
