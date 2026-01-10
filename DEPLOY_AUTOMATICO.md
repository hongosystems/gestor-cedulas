# 🚀 Deploy Automático: PDF Extractor Service

Esta guía te permite desplegar el microservicio PDF Extractor en Render de forma casi automática.

## ⚡ Inicio Rápido

**Ejecuta este comando en PowerShell desde la raíz del proyecto:**

```powershell
.\scripts\deploy_pdf_extractor.ps1
```

El script te guiará paso a paso y actualizará automáticamente tu `.env.local` con la URL del servicio.

---

## 📋 ¿Qué hace el script?

1. ✅ Verifica que todos los archivos necesarios estén presentes
2. ✅ Opcionalmente agrega los archivos a Git
3. ✅ Te guía paso a paso para desplegar en Render
4. ✅ Actualiza automáticamente `.env.local` con la URL del servicio
5. ✅ Verifica que el servicio esté respondiendo

---

## 🔧 Paso a Paso Manual (si prefieres)

### 1. Preparar archivos

```powershell
# Desde la raíz del proyecto
git add pdf-extractor-service/
git add app/api/extract-pdf/
git add app/app/nueva/page.tsx
git commit -m "feat: PDF extractor microservice"
git push origin main
```

### 2. Desplegar en Render

1. Ve a https://render.com y haz login/signup
2. Dashboard → **"New +"** → **"Web Service"**
3. Conecta tu repositorio de GitHub
4. Configura:
   - **Name**: `pdf-extractor-service`
   - **Region**: `Oregon (US West)` o la más cercana
   - **Branch**: `main`
   - **Root Directory**: `pdf-extractor-service`
   - **Runtime**: `Docker` ⚠️ IMPORTANTE
   - **Dockerfile Path**: `Dockerfile`
   - **Plan**: `Free` (para probar) o `Starter` ($7/mes)
5. Haz clic en **"Create Web Service"**
6. Espera 5-10 minutos para el primer deploy

### 3. Obtener la URL

En Render Dashboard → Tu servicio → Sección **"Info"**, encontrarás:
- URL: `https://pdf-extractor-service-xxxx.onrender.com`

### 4. Configurar `.env.local`

**Opción A: Usando el script helper**

```powershell
.\scripts\update_pdf_extractor_url.ps1 -Url https://pdf-extractor-service-xxxx.onrender.com
```

**Opción B: Manualmente**

Abre `.env.local` y agrega al final:

```env
PDF_EXTRACTOR_URL=https://pdf-extractor-service-xxxx.onrender.com/extract
```

⚠️ **IMPORTANTE**: La URL debe incluir `/extract` al final.

### 5. Verificar

```powershell
# Probar que el servicio responde
curl https://pdf-extractor-service-xxxx.onrender.com/health
```

Deberías ver: `{"status":"ok","service":"pdf-extractor"}`

### 6. Reiniciar servidor de desarrollo

```powershell
# Detén el servidor (Ctrl+C) y reinicia:
npm run dev
```

### 7. Probar

1. Ve a http://localhost:3000/app/nueva
2. Sube un PDF
3. Los campos "Carátula" y "Juzgado" deberían autocompletarse

---

## ⚠️ Notas Importantes

### Plan Free de Render

- El servicio se "duerme" después de 15 minutos de inactividad
- La primera petición después de dormirse puede tardar ~30 segundos en "despertar"
- Para producción, usa el plan Starter ($7/mes) o superior

### Variables de Entorno en Vercel

Cuando despliegues tu app Next.js a Vercel, también necesitas agregar `PDF_EXTRACTOR_URL`:

1. Ve a Vercel Dashboard → Tu proyecto
2. Settings → Environment Variables
3. Agrega:
   - **Name**: `PDF_EXTRACTOR_URL`
   - **Value**: `https://tu-servicio.onrender.com/extract`
   - **Environments**: ✅ Production ✅ Preview ✅ Development
4. Vuelve a desplegar

---

## 🐛 Troubleshooting

### El servicio no responde

1. Verifica en Render Dashboard que el servicio esté corriendo (status: "Live")
2. Si está en plan Free, puede estar dormido - espera 30 segundos y vuelve a intentar
3. Revisa los logs en Render Dashboard → Tu servicio → Pestaña "Logs"

### Error 503 al subir PDF

1. Verifica que `PDF_EXTRACTOR_URL` esté en `.env.local`
2. Verifica que la URL incluya `/extract` al final
3. Reinicia tu servidor de desarrollo
4. Verifica que el microservicio esté respondiendo: `curl https://tu-servicio.onrender.com/health`

### Error de build en Render

1. Verifica que `Root Directory` esté configurado como `pdf-extractor-service`
2. Verifica que `Runtime` sea `Docker`
3. Revisa los logs de build en Render

---

## ✅ Checklist Final

- [ ] Microservicio desplegado en Render
- [ ] URL del servicio obtenida
- [ ] `PDF_EXTRACTOR_URL` configurada en `.env.local`
- [ ] Health check del servicio funciona (`/health`)
- [ ] Servidor de desarrollo reiniciado
- [ ] Probado subiendo un PDF desde la UI

---

## 🎯 Todo Listo

Una vez completado, tu aplicación:
- ✅ Extraerá automáticamente Carátula y Juzgado de PDFs
- ✅ Mantendrá compatibilidad con DOCX (sin cambios)
- ✅ Mostrará mensajes amigables si no puede extraer información
- ✅ Permitirá completar campos manualmente si es necesario
