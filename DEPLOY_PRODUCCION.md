# 🚀 Deployment a Producción - Checklist Actualizado

## ✅ Pre-Deployment (Verificado)

- [x] Build compilado exitosamente sin errores ✅
- [x] Sin errores de linting ✅
- [x] Nuevas funcionalidades implementadas:
  - [x] Backoffice WebMaster (`/webmaster`)
  - [x] Rol "Admin Cédulas" agregado
  - [x] APIs de gestión de usuarios creadas

---

## 🔧 ANTES del Deployment: Ejecutar Migraciones SQL en Supabase

**⚠️ IMPORTANTE: Ejecuta estas migraciones en Supabase SQL Editor ANTES del deploy:**

### Migraciones Obligatorias:

1. **`migrations/add_admin_cedulas.sql`**
   - Agrega el campo `is_admin_cedulas` a la tabla `user_roles`
   - Crea la función RPC `is_admin_cedulas()`
   
2. **`migrations/assign_admin_cedulas_olivera.sql`** (Opcional - solo si quieres asignar el rol a este usuario)
   - Asigna el rol "Admin Cédulas" a `oliverarodrigo86@gmail.com`

**Para ejecutar:**
1. Ve a tu proyecto en Supabase
2. Abre el SQL Editor
3. Copia y pega el contenido de cada migración
4. Ejecuta cada una en orden
5. Verifica que se ejecutaron correctamente

---

## 🔑 Variables de Entorno Requeridas

Asegúrate de configurar estas variables en tu plataforma de deployment (Vercel, Railway, Render, etc.):

```env
NEXT_PUBLIC_SUPABASE_URL=tu_url_de_supabase
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_anon_key_de_supabase
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key_de_supabase
```

**Nota:** Las variables `NEXT_PUBLIC_*` son públicas (necesarias para el cliente). `SUPABASE_SERVICE_ROLE_KEY` es secreta (solo para el servidor).

---

## 🚀 Deployment en Vercel (Recomendado)

### Paso 1: Conectar Repositorio (si no está conectado)
1. Ve a [vercel.com](https://vercel.com)
2. Importa tu repositorio Git
3. Vercel detectará automáticamente Next.js

### Paso 2: Configurar Variables de Entorno
1. Ve a **Settings → Environment Variables**
2. Agrega las tres variables de entorno requeridas (ver arriba)
3. **IMPORTANTE:** Marca las variables para:
   - ✅ Production
   - ✅ Preview
   - ✅ Development

### Paso 3: Configuración de Build (si es necesario)
- **Build Command:** `npm run build` (por defecto)
- **Output Directory:** `.next` (por defecto)
- **Install Command:** `npm install` (por defecto)
- **Node.js Version:** 18.x o superior

### Paso 4: Deploy
1. Haz **push a tu rama principal** (main/master)
2. Vercel desplegará automáticamente
3. O manualmente desde el dashboard: **Deployments → Redeploy**

### Paso 5: Verificar Deployment
1. Ve al dashboard de Vercel
2. Verifica que el build fue exitoso (✓ verde)
3. Abre la URL de producción

---

## 🚀 Deployment en Otras Plataformas (Railway, Render, etc.)

### Configuración Básica:

1. **Conecta tu repositorio** con la plataforma

2. **Configura las variables de entorno** en el panel de la plataforma:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

3. **Ajusta los comandos:**
   - **Build Command:** `npm run build`
   - **Start Command:** `npm start`
   - **Node.js Version:** 18.x o superior

4. **Deploy** desde la plataforma

---

## ✅ Post-Deployment: Verificación

Después del deployment, verifica las siguientes funcionalidades:

### Funcionalidades Básicas:
- [ ] La aplicación carga correctamente en la URL de producción
- [ ] El login funciona (`/login`)
- [ ] Se pueden crear nuevas cédulas (`/app/nueva`)
- [ ] Los archivos se pueden subir
- [ ] Los archivos se abren correctamente en el navegador
- [ ] El sistema de semáforo funciona
- [ ] El ordenamiento funciona

### Nuevas Funcionalidades (Backoffice):
- [ ] El backoffice carga correctamente (`/webmaster/login`)
- [ ] El login del backoffice funciona (solo para superadmin)
- [ ] Se puede acceder a la gestión de usuarios (`/webmaster`)
- [ ] Se pueden listar usuarios
- [ ] Se pueden crear usuarios
- [ ] Se pueden editar usuarios
- [ ] Se pueden asignar roles (SuperAdmin, Admin Expedientes, **Admin Cédulas**, Abogado)
- [ ] Se pueden asignar juzgados a abogados
- [ ] Se pueden eliminar usuarios

### Verificación de Roles:
- [ ] Los usuarios con rol "Admin Cédulas" pueden acceder a `/app`
- [ ] Los usuarios con rol "SuperAdmin" pueden acceder a `/webmaster`
- [ ] Los roles se muestran correctamente en la tabla del backoffice

---

## 🔍 Troubleshooting

### Error: "Variables de entorno no encontradas"
- Verifica que todas las variables estén configuradas en la plataforma
- Reinicia el deployment después de agregar variables
- Verifica que las variables estén marcadas para el ambiente correcto (Production/Preview/Development)

### Error: "No autorizado" en el backoffice
- Verifica que el usuario tenga rol `is_superadmin = TRUE` en la tabla `user_roles` de Supabase
- Verifica que la migración `add_admin_cedulas.sql` se ejecutó correctamente

### Error: "Campo is_admin_cedulas no existe"
- **Ejecuta la migración `migrations/add_admin_cedulas.sql` en Supabase SQL Editor**
- Verifica que la migración se ejecutó sin errores

### Error: Build falla
- Verifica la versión de Node.js (debe ser 18+)
- Ejecuta `npm run build` localmente para ver errores específicos
- Verifica que no haya errores de TypeScript

### Error: No se pueden abrir archivos
- Verifica que `SUPABASE_SERVICE_ROLE_KEY` esté configurada correctamente
- Verifica las políticas RLS en Supabase Storage
- Verifica que el bucket `cedulas` existe en Supabase Storage

---

## 📝 Notas Importantes

1. **Migraciones SQL:** ⚠️ **EJECUTA LAS MIGRACIONES ANTES DEL DEPLOYMENT** (ver sección arriba)

2. **Variables de Entorno:**
   - **NUNCA** commitees el archivo `.env.local` al repositorio
   - El `SUPABASE_SERVICE_ROLE_KEY` debe mantenerse secreto
   - Las variables `NEXT_PUBLIC_*` son públicas pero necesarias para el cliente

3. **Base de Datos:**
   - Asegúrate de que la tabla `user_roles` tenga el campo `is_admin_cedulas`
   - Verifica que las políticas RLS estén configuradas correctamente

4. **Backoffice:**
   - Solo usuarios con `is_superadmin = TRUE` pueden acceder
   - El login del backoffice está en `/webmaster/login`
   - La gestión de usuarios está en `/webmaster`

---

## 📋 Checklist Final Pre-Deploy

- [ ] Migraciones SQL ejecutadas en Supabase
- [ ] Variables de entorno configuradas en la plataforma
- [ ] Build local exitoso (`npm run build`)
- [ ] Sin errores de linting (`npm run lint`)
- [ ] Repositorio actualizado con todos los cambios
- [ ] Push realizado a la rama principal

---

## 🎉 ¡Listo para Deploy!

Una vez completado el checklist, tu aplicación estará lista para producción con:
- ✅ Sistema completo de gestión de cédulas/oficios
- ✅ Backoffice WebMaster funcional
- ✅ Sistema de roles completo (SuperAdmin, Admin Expedientes, Admin Cédulas, Abogado)
- ✅ Gestión de usuarios desde el backoffice
- ✅ Asignación de juzgados a abogados
