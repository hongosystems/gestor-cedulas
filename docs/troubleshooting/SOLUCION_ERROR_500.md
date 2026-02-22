# Solución: Error 500 en /api/extract-pdf

## 🔴 Problema

El error 500 ocurre porque **la variable de entorno `PDF_EXTRACTOR_URL` no está configurada** o el **microservicio no está desplegado aún**.

## ✅ Solución Inmediata (Para Desarrollo Local)

### Opción 1: Agregar variable temporal (si aún no desplegaste el microservicio)

Si aún **NO has desplegado el microservicio en Render**, el endpoint ahora retornará un mensaje más claro pidiendo completar los campos manualmente.

Para evitar el error completamente, agrega esta línea al final de tu archivo `.env.local`:

```env
PDF_EXTRACTOR_URL=
```

Esto hará que el endpoint retorne un mensaje amigable en lugar de un error 500.

### Opción 2: Usar una URL de prueba (si desplegaste el microservicio)

Si **YA desplegaste el microservicio en Render**, agrega al final de tu `.env.local`:

```env
PDF_EXTRACTOR_URL=https://tu-servicio.onrender.com/extract
```

**⚠️ IMPORTANTE:** Reemplaza `tu-servicio` con la URL real que te dio Render.

## 📝 Pasos para Agregar la Variable

1. **Abre el archivo `.env.local`** en la raíz del proyecto (`C:\proyectos\gestor-cedulas\.env.local`)

2. **Agrega al final del archivo:**
   ```env
   PDF_EXTRACTOR_URL=
   ```
   
   O si ya desplegaste el microservicio:
   ```env
   PDF_EXTRACTOR_URL=https://pdf-extractor-service-xxxx.onrender.com/extract
   ```

3. **Reinicia el servidor de desarrollo:**
   - Detén el servidor (Ctrl+C)
   - Ejecuta de nuevo: `npm run dev`

4. **Prueba nuevamente** subiendo un PDF

## 🚀 Solución Completa: Desplegar el Microservicio

Si quieres que la extracción automática funcione, necesitas desplegar el microservicio:

1. **Sigue las instrucciones en:**
   - `pdf-extractor-service/README.md` (guía completa)
   - `INSTRUCCIONES_DEPLOY_PDF_EXTRACTOR.txt` (guía rápida)

2. **Una vez desplegado, agrega la URL en `.env.local`:**

   ```env
   PDF_EXTRACTOR_URL=https://tu-servicio.onrender.com/extract
   ```

3. **Reinicia el servidor de desarrollo**

## 📊 Qué Cambió en el Código

He actualizado el endpoint `/api/extract-pdf/route.ts` para:

- ✅ Retornar un **mensaje más claro** cuando `PDF_EXTRACTOR_URL` no está configurada
- ✅ Retornar **503 Service Unavailable** en lugar de 500 (más semántico)
- ✅ Agregar **timeout de 30 segundos** para evitar esperas infinitas
- ✅ Mejorar el **manejo de errores** de conexión

## 🧪 Verificar que Funciona

Después de agregar la variable y reiniciar:

1. Abre la consola del navegador (F12)
2. Sube un PDF
3. Si la variable no está configurada, verás un mensaje amigable
4. Si está configurada pero el servicio no está disponible, verás un mensaje explicativo

## ⚠️ Nota Importante

**Mientras no esté el microservicio desplegado**, el sistema funcionará pero:
- Los usuarios podrán completar los campos manualmente
- No habrá extracción automática de PDFs
- Los archivos DOCX seguirán funcionando normalmente (no usan el microservicio)
