# 🔧 Solución: Error de CORS en Login (Producción)

## ❌ Problema

Después del deploy a producción, el login falla con el siguiente error:

```
Access to fetch at 'https://vgwjlnctudrlvpudlhkx.supabase.co/auth/v1/token?grant_type=password' 
from origin 'https://gestor-cedulas.vercel.app' has been blocked by CORS policy: 
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

## ✅ Solución

El dominio de producción no está configurado en Supabase. Necesitas agregarlo a la lista de URLs permitidas.

### Pasos para Configurar Supabase

1. **Accede al Dashboard de Supabase:**
   - Ve a: https://supabase.com/dashboard
   - Selecciona tu proyecto (el que tiene la URL `vgwjlnctudrlvpudlhkx.supabase.co`)

2. **Configurar URLs Permitidas:**
   - Ve a: **Authentication** → **URL Configuration**
   - O directamente: `https://supabase.com/dashboard/project/[TU_PROJECT_ID]/auth/url-configuration`

3. **Agregar el Dominio de Producción:**
   
   En la sección **"Site URL"**, asegúrate de tener:
   ```
   https://gestor-cedulas.vercel.app
   ```

   En la sección **"Redirect URLs"**, agrega las siguientes URLs (una por línea):
   ```
   https://gestor-cedulas.vercel.app/**
   https://gestor-cedulas.vercel.app/login
   https://gestor-cedulas.vercel.app/app/**
   https://gestor-cedulas.vercel.app/superadmin/**
   https://gestor-cedulas.vercel.app/cambiar-password
   https://gestor-cedulas.vercel.app/select-role
   ```

   **Nota:** El `**` al final permite todas las rutas que comienzan con ese prefijo.

4. **Guardar los Cambios:**
   - Haz clic en **"Save"** o **"Update"**
   - Los cambios se aplican inmediatamente (no requiere redeploy)

5. **Verificar:**
   - Intenta hacer login nuevamente en: https://gestor-cedulas.vercel.app/login
   - El error de CORS debería desaparecer

## 📋 URLs Adicionales (Opcional)

Si también usas otros dominios (por ejemplo, un dominio personalizado), agrégalos también:

```
https://tu-dominio-personalizado.com/**
https://tu-dominio-personalizado.com/login
```

## 🔍 Verificación Rápida

Para verificar que la configuración está correcta:

1. Ve a: **Authentication** → **URL Configuration**
2. Verifica que `https://gestor-cedulas.vercel.app` esté en la lista
3. Verifica que las Redirect URLs incluyan todas las rutas necesarias

## ⚠️ Importante

- **No requiere redeploy:** Los cambios en Supabase se aplican inmediatamente
- **No requiere cambios en el código:** Este es un problema de configuración, no de código
- **Afecta solo a producción:** El error solo ocurre en producción porque el dominio local (`localhost`) ya está permitido por defecto

## 🆘 Si el Problema Persiste

Si después de configurar Supabase el error continúa:

### 1. Verificar Variables de Entorno en Vercel

**CRÍTICO:** Asegúrate de que las variables de entorno estén configuradas correctamente:

1. Ve a: https://vercel.com/hongosystems-projects/gestor-cedulas/settings/environment-variables
2. Verifica que existan estas variables para **Production**:
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://vgwjlnctudrlvpudlhkx.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = (tu clave anónima de Supabase)
3. **IMPORTANTE:** Si modificaste las variables, necesitas hacer un **redeploy**:
   - Ve a: https://vercel.com/hongosystems-projects/gestor-cedulas/deployments
   - Click en el último deployment
   - Click en "..." → "Redeploy"

### 2. Verificar Configuración en Supabase Dashboard

1. **Verifica que el dominio esté exactamente como aparece:**
   - Ve a: **Authentication** → **URL Configuration**
   - **Site URL** debe ser: `https://gestor-cedulas.vercel.app` (sin barra final)
   - **Redirect URLs** debe incluir:
     ```
     https://gestor-cedulas.vercel.app/**
     https://gestor-cedulas.vercel.app/login
     ```

2. **Verifica que no haya espacios o caracteres extra** en las URLs

3. **Espera 1-2 minutos** después de guardar (puede tomar tiempo en propagarse)

### 3. Verificar en la Consola del Navegador

Abre la consola del navegador (F12) y verifica:

1. **Qué URL está intentando usar:**
   - Busca en los errores la URL exacta de Supabase
   - Debe ser: `https://vgwjlnctudrlvpudlhkx.supabase.co`

2. **Qué origen está bloqueado:**
   - El error debe mostrar: `from origin 'https://gestor-cedulas.vercel.app'`
   - Si muestra otro dominio, ese es el que necesitas agregar

### 4. Verificar CORS en Supabase

1. Ve a: **Settings** → **API** en Supabase
2. Verifica la sección **"CORS"** o **"Allowed Origins"**
3. Asegúrate de que `https://gestor-cedulas.vercel.app` esté en la lista

### 5. Limpiar Caché

1. **Limpia la caché del navegador** (Ctrl+Shift+Delete)
2. **Prueba en modo incógnito** para descartar problemas de caché
3. **Limpia el localStorage:**
   - Abre la consola (F12)
   - Ejecuta: `localStorage.clear()`
   - Recarga la página

### 6. Verificar que el Deploy Esté Actualizado

1. Ve a: https://vercel.com/hongosystems-projects/gestor-cedulas/deployments
2. Verifica que el último deployment esté **"Ready"** (verde)
3. Si hay errores, revisa los logs del deployment

### 7. Contactar Soporte de Supabase (Último Recurso)

Si nada funciona, puede ser un problema del lado de Supabase:

1. Ve a: https://supabase.com/dashboard/support
2. Explica el problema de CORS
3. Menciona que ya configuraste las URLs en Authentication → URL Configuration

## 📝 Notas Técnicas

- El error de CORS ocurre porque el navegador bloquea peticiones entre diferentes orígenes por seguridad
- Supabase necesita saber qué dominios están permitidos para enviar las cabeceras CORS correctas
- El dominio `https://gestor-cedulas.vercel.app` es el dominio de producción de Vercel
