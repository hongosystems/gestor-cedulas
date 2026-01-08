# Gestor de Cédulas/Oficios

Sistema de gestión de cédulas y oficios con sistema de semáforo automático por antigüedad.

## Características

- ✅ Gestión de cédulas/oficios con carátula y juzgado
- ✅ Sistema de semáforo automático (Verde 0-29 días, Amarillo 30-59 días, Rojo 60+ días)
- ✅ Autorrelleno automático desde archivos DOCX
- ✅ Visualización de archivos PDF/DOCX directamente en el navegador
- ✅ Ordenamiento por semáforo, días y fecha de carga
- ✅ Sistema de usuarios con roles (admin/superadmin)

## Variables de Entorno Requeridas

Crea un archivo `.env.local` en la raíz del proyecto con las siguientes variables:

```env
NEXT_PUBLIC_SUPABASE_URL=tu_url_de_supabase
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_anon_key_de_supabase
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key_de_supabase
```

**Importante:** 
- Las variables que empiezan con `NEXT_PUBLIC_` son accesibles desde el cliente
- `SUPABASE_SERVICE_ROLE_KEY` solo se usa en API routes del servidor (nunca debe exponerse al cliente)

## Instalación y Desarrollo

```bash
# Instalar dependencias
npm install

# Ejecutar en modo desarrollo
npm run dev

# Compilar para producción
npm run build

# Ejecutar versión de producción
npm start
```

El servidor de desarrollo estará disponible en [http://localhost:3000](http://localhost:3000).

## Deployment

### Vercel (Recomendado)

1. Conecta tu repositorio con Vercel
2. Agrega las variables de entorno en la configuración del proyecto:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Vercel detectará automáticamente que es un proyecto Next.js y configurará el build

### Otras Plataformas

Para deployar en otras plataformas (Railway, Render, etc.):

1. Asegúrate de tener Node.js 18+ instalado
2. Ejecuta `npm run build` para compilar
3. Ejecuta `npm start` para iniciar el servidor
4. Configura las variables de entorno necesarias

## Estructura del Proyecto

```
app/
  ├── api/              # API routes
  │   ├── extract-caratula/    # Extracción de carátula desde DOCX
  │   ├── extract-juzgado/     # Extracción de juzgado desde DOCX
  │   └── open-file/           # Endpoint para abrir archivos
  ├── app/              # Páginas principales
  │   ├── nueva/        # Crear nueva cédula
  │   └── page.tsx      # Lista de cédulas
  ├── login/            # Página de login
  ├── superadmin/       # Panel de superadmin
  └── layout.tsx        # Layout principal
lib/
  ├── semaforo.ts       # Lógica del semáforo
  └── supabase.ts       # Cliente de Supabase
```

## Notas de Seguridad

- Los archivos se almacenan en Supabase Storage con permisos por usuario
- Cada usuario solo puede acceder a sus propios archivos
- La autenticación se maneja mediante JWT tokens de Supabase
- Los archivos se sirven con `Content-Disposition: inline` para visualización en el navegador

## Scripts Útiles

- `npm run dev` - Desarrollo local
- `npm run build` - Compilar para producción
- `npm run start` - Ejecutar versión compilada
- `npm run lint` - Ejecutar linter

## Soporte

Para problemas o preguntas, contacta al equipo de desarrollo.
