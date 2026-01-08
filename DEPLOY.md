# Checklist de Deployment a Producción

## ✅ Pre-Deployment

- [x] Build compilado exitosamente sin errores
- [x] Sin errores de linting
- [x] Console.logs removidos o minimizados
- [x] Variables de entorno documentadas
- [x] README actualizado

## 🔧 Configuración Requerida

### Variables de Entorno

Asegúrate de configurar estas variables en tu plataforma de deployment:

```
NEXT_PUBLIC_SUPABASE_URL=tu_url_de_supabase
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_anon_key_de_supabase
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key_de_supabase
```

### Configuración de Supabase

1. ✅ Bucket `cedulas` en Storage creado
2. ✅ Políticas RLS configuradas en la tabla `cedulas`
3. ✅ Tabla `profiles` con campo `must_change_password`
4. ✅ Tabla `user_roles` (si usas roles)
5. ✅ Función RPC `is_superadmin` (si aplica)

## 🚀 Deployment en Vercel

### Paso 1: Conectar Repositorio
1. Ve a [vercel.com](https://vercel.com)
2. Importa tu repositorio Git
3. Vercel detectará automáticamente Next.js

### Paso 2: Configurar Variables de Entorno
1. Ve a Settings → Environment Variables
2. Agrega las tres variables de entorno requeridas
3. Asegúrate de que estén marcadas para "Production", "Preview" y "Development"

### Paso 3: Deploy
1. Haz push a tu rama principal
2. Vercel desplegará automáticamente
3. Verifica el deployment en el dashboard

## 🚀 Deployment en Otras Plataformas

### Railway / Render / Similar

1. **Conecta tu repositorio**
2. **Configura las variables de entorno** en el panel de la plataforma
3. **Ajusta el comando de build:**
   ```bash
   npm run build
   ```
4. **Ajusta el comando de start:**
   ```bash
   npm start
   ```
5. **Asegúrate de usar Node.js 18+**

## ✅ Post-Deployment

Después del deployment, verifica:

- [ ] La aplicación carga correctamente
- [ ] El login funciona
- [ ] Se pueden crear nuevas cédulas
- [ ] Los archivos se pueden subir
- [ ] Los archivos se abren correctamente en el navegador
- [ ] El sistema de semáforo funciona
- [ ] El ordenamiento funciona
- [ ] El autorrelleno de DOCX funciona

## 🔍 Troubleshooting

### Error: Variables de entorno no encontradas
- Verifica que todas las variables estén configuradas en la plataforma
- Reinicia el deployment después de agregar variables

### Error: No se pueden abrir archivos
- Verifica que `SUPABASE_SERVICE_ROLE_KEY` esté configurada
- Verifica las políticas RLS en Supabase Storage

### Error: Build falla
- Verifica la versión de Node.js (debe ser 18+)
- Ejecuta `npm run build` localmente para ver errores específicos

## 📝 Notas Importantes

- **NUNCA** commitees el archivo `.env.local` al repositorio
- El `SUPABASE_SERVICE_ROLE_KEY` debe mantenerse secreto
- Las variables `NEXT_PUBLIC_*` son públicas pero necesarias para el cliente
- El build genera archivos estáticos y dinámicos según corresponda
