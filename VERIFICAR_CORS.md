# 🔍 Verificación Paso a Paso del Error de CORS

Sigue estos pasos en orden para diagnosticar y resolver el problema:

## ✅ Paso 1: Verificar Variables de Entorno en Vercel

**CRÍTICO - Este es el paso más importante:**

1. Ve a: https://vercel.com/hongosystems-projects/gestor-cedulas/settings/environment-variables

2. Verifica que existan estas variables configuradas para **Production** (no solo Development):
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://vgwjlnctudrlvpudlhkx.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = (tu clave anónima)

3. **Si las variables NO existen o están mal:**
   - Agrégalas o corrígelas
   - **Haz un REDEPLOY** (esto es crítico):
     - Ve a: https://vercel.com/hongosystems-projects/gestor-cedulas/deployments
     - Click en el último deployment
     - Click en "..." → "Redeploy"
     - Espera a que termine el redeploy (2-5 minutos)

## ✅ Paso 2: Verificar Configuración en Supabase

1. Ve a: https://supabase.com/dashboard
2. Selecciona tu proyecto
3. Ve a: **Authentication** → **URL Configuration**

4. Verifica **Site URL**:
   ```
   https://gestor-cedulas.vercel.app
   ```
   - Sin barra final (`/`)
   - Sin espacios
   - Exactamente como se muestra arriba

5. Verifica **Redirect URLs** (una por línea):
   ```
   https://gestor-cedulas.vercel.app/**
   https://gestor-cedulas.vercel.app/login
   ```
   - El `**` es importante (permite todas las subrutas)
   - Sin espacios al inicio o final de cada línea

6. **Guarda los cambios** si hiciste modificaciones

7. **Espera 1-2 minutos** para que se propaguen los cambios

## ✅ Paso 3: Verificar en la Consola del Navegador

1. Abre https://gestor-cedulas.vercel.app/login
2. Abre la consola del navegador (F12)
3. Intenta hacer login
4. Revisa los errores en la consola:

   **Busca estos detalles:**
   - ¿Qué URL de Supabase aparece en el error?
     - Debe ser: `https://vgwjlnctudrlvpudlhkx.supabase.co`
   - ¿Qué origen está bloqueado?
     - Debe ser: `from origin 'https://gestor-cedulas.vercel.app'`
   - Si aparece otro dominio, ese es el que necesitas agregar a Supabase

## ✅ Paso 4: Limpiar Caché Completamente

1. **En el navegador:**
   - Presiona `Ctrl+Shift+Delete`
   - Selecciona "Caché" y "Cookies"
   - Limpia todo

2. **Limpia localStorage:**
   - Abre la consola (F12)
   - Ejecuta: `localStorage.clear()`
   - Ejecuta: `sessionStorage.clear()`

3. **Prueba en modo incógnito:**
   - Abre una ventana incógnita
   - Ve a: https://gestor-cedulas.vercel.app/login
   - Intenta hacer login

## ✅ Paso 5: Verificar el Deploy en Vercel

1. Ve a: https://vercel.com/hongosystems-projects/gestor-cedulas/deployments
2. Verifica que el último deployment esté **"Ready"** (verde)
3. Si hay errores, revisa los logs:
   - Click en el deployment
   - Revisa la sección "Build Logs"
   - Busca errores relacionados con variables de entorno

## ✅ Paso 6: Verificar CORS en Supabase (Configuración Avanzada)

1. Ve a: **Settings** → **API** en Supabase
2. Busca la sección **"CORS"** o **"Allowed Origins"**
3. Si existe, asegúrate de que `https://gestor-cedulas.vercel.app` esté en la lista

**Nota:** En versiones recientes de Supabase, esta configuración puede no estar visible porque se maneja automáticamente desde Authentication → URL Configuration.

## 🆘 Si Nada Funciona

### Opción A: Verificar que el Dominio Sea Correcto

Puede que Vercel esté usando un dominio diferente. Verifica:

1. Ve a: https://vercel.com/hongosystems-projects/gestor-cedulas/settings/domains
2. Revisa cuál es el dominio principal
3. Si es diferente a `gestor-cedulas.vercel.app`, agrégalo también a Supabase

### Opción B: Contactar Soporte

1. Ve a: https://supabase.com/dashboard/support
2. Crea un ticket explicando:
   - El error de CORS exacto
   - Que ya configuraste las URLs en Authentication → URL Configuration
   - Que las variables de entorno están correctas en Vercel
   - Captura de pantalla de la configuración de URLs en Supabase

## 📋 Checklist Final

Antes de reportar que no funciona, verifica:

- [ ] Variables de entorno configuradas en Vercel para **Production**
- [ ] Redeploy hecho después de cambiar variables de entorno
- [ ] Site URL configurado en Supabase: `https://gestor-cedulas.vercel.app`
- [ ] Redirect URLs incluyen `https://gestor-cedulas.vercel.app/**`
- [ ] Esperaste 1-2 minutos después de guardar en Supabase
- [ ] Limpiaste caché del navegador
- [ ] Probaste en modo incógnito
- [ ] El último deployment en Vercel está "Ready" (verde)
