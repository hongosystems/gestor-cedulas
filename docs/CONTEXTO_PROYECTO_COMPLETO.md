# Contexto Completo del Proyecto - Gestor Cédulas

Documento de contexto integral del sistema `gestor-cedulas`, con foco en arquitectura, dominios funcionales, flujos operativos, seguridad, modelo de datos e integraciones.

## 1) Propósito del sistema

La aplicación es una plataforma legal-operativa para administrar el ciclo de trabajo de:

- Cédulas y oficios judiciales.
- Diligenciamiento y carga en PJN.
- Expedientes (con integración a fuentes PJN/scraper).
- Mediaciones (incluyendo lotes y envío por correo).
- Notificaciones internas y chat.
- Transferencias de archivos.
- OCR y extracción de metadatos documentales.

Objetivo operativo: centralizar tareas del estudio jurídico con trazabilidad por rol, juzgado y estado documental.

## 2) Stack tecnológico y arquitectura de alto nivel

### Front + API principal

- **Next.js App Router** (`app/`), con UI cliente y API routes en `app/api/**/route.ts`.
- **TypeScript** en toda la app.
- **Supabase** como backend primario:
  - Auth (usuarios/sesiones JWT),
  - PostgreSQL (datos de negocio),
  - Storage (archivos).

### Servicios auxiliares

- **Microservicio OCR/PDF extractor** (`pdf-extractor-service/`) para procesamiento de PDF.
- **Microservicio PJN uploader** (`railway-service/cargar-pjn/`) con Playwright para automatización de carga.

### Deploy

- **Vercel** para app principal (incluyendo cron de sincronización PJN favoritos).
- Servicios auxiliares con despliegue separado (Render/Railway según documentación y envs).

## 3) Estructura principal del repositorio

- `app/`
  - `app/app/` panel principal (Mis Cédulas/Oficios y módulos relacionados).
  - `app/diligenciamiento/` flujo de carga PJN para abogados/superadmin.
  - `app/api/` endpoints HTTP del sistema.
  - Otras vistas: expedientes, mediaciones, superadmin, webmaster, notificaciones, etc.
- `lib/`
  - Clientes Supabase (`supabase.ts`, `supabase-server.ts`).
  - Auth helper API (`auth-api.ts`).
  - Utilidades de negocio (por ejemplo `semaforo.ts`).
- `migrations/`
  - Evolución del esquema y políticas RLS.
- `docs/`
  - Runbooks de despliegue y operación.
- `railway-service/cargar-pjn/`
  - Servicio dedicado a automatización PJN por backend.
- `pdf-extractor-service/`
  - Servicio OCR/extracción documental.

## 4) Dominios funcionales y flujos críticos

### 4.1 Cédulas/Oficios

**UI principal:** `app/app/page.tsx`  
Capacidades:

- Listado de cédulas/oficios del usuario (y vistas ampliadas según rol).
- Estados operativos (pendiente / en trámite / completa) según campos de DB.
- Semáforo por antigüedad de carga.
- Notas con menciones.
- Registro de lectura (`read_by_user_id`, `read_by_name`).
- Apertura de archivo por URL firmada/controlada (`/api/open-file`).

**Endpoints relevantes:**

- `app/api/open-file/route.ts`
- `app/api/cedulas/[id]/procesar-ocr/route.ts`

### 4.2 Diligenciamiento y PJN

**UI:** `app/diligenciamiento/page.tsx`  
Flujo operativo:

1. Lista cédulas con OCR listo (`/api/diligenciamiento`).
2. Usuario inicia "Cargar en PJN".
3. Se confirma estado en DB (`/api/cedulas/[id]/confirmar-pjn`).
4. Se dispara automatización por backend PJN uploader.
5. Estado visual "Pendiente/Cargado" basado en `pjn_cargado_at`.

**Endpoints relevantes:**

- `app/api/diligenciamiento/route.ts`
- `app/api/cedulas/[id]/cargar-pjn/route.ts`
- `app/api/diligenciamiento/[id]/cargar-pjn/route.ts`
- `app/api/cedulas/[id]/confirmar-pjn/route.ts`

### 4.3 Expedientes

**UI:** `app/app/expedientes/page.tsx`  
Capacidades:

- Gestión/listado por permisos (admin expedientes / abogados por juzgado).
- Integración con datos PJN:
  - búsqueda en base scraper,
  - scraping fallback bajo demanda.

**Endpoints relevantes:**

- `app/api/search-expediente-pjn/route.ts`
- `app/api/fetch-expediente-pjn/route.ts`

### 4.4 Mediaciones

Flujo de vida de trámite:

- Alta, edición y seguimiento.
- Gestión de requeridos/requirentes.
- Historial y observaciones.
- Generación de documentos.
- Armado de lotes y envío por correo.

**Endpoints principales:**

- `app/api/mediaciones/create/route.ts`
- `app/api/mediaciones/list/route.ts`
- `app/api/mediaciones/lotes/send/route.ts`
- Familia `app/api/mediaciones/**`

### 4.5 Notificaciones y chat

- Menciones directas y masivas.
- Respuestas en hilo.
- Conversaciones/mensajes.
- Estados de lectura.

**Endpoints principales:**

- `app/api/notifications/create-mention/route.ts`
- `app/api/notifications/create-mention-all/route.ts`
- `app/api/notifications/reply/route.ts`
- `app/api/chat/**`

### 4.6 Transferencias de archivos

Flujo:

1. Envío de archivo y metadatos.
2. Versionado.
3. Descarga segura por firma.
4. Redirección entre usuarios.

**Endpoints principales:**

- `app/api/transfers/send/route.ts`
- `app/api/transfers/sign-download/route.ts`
- `app/api/transfers/redirect/route.ts`
- `app/api/transfers/upload-version/route.ts`

### 4.7 OCR

Flujo:

- Se dispara OCR sobre cédula.
- Servicio externo procesa PDF y devuelve metadatos/resultado.
- Se actualiza estado OCR y campos derivados.

**Endpoint:** `app/api/cedulas/[id]/procesar-ocr/route.ts`

## 5) Autenticación, autorización y roles

### Autenticación

- Basada en Supabase Auth y token Bearer.
- Muchas rutas validan manualmente JWT vía helper `getUserFromRequest`.

### Autorización por rol

Tabla base: `user_roles` (flags booleanos).
Roles observados:

- `is_superadmin`
- `is_admin_cedulas`
- `is_admin_expedientes`
- `is_admin_mediaciones`
- `is_abogado`

### Segmentación por juzgado

- Tabla `user_juzgados` para restringir/permitir acceso por fuero/juzgado.

### Nota de diseño

- El control está distribuido en UI + APIs + RLS; no hay middleware único central de autorización.

## 6) Modelo de datos (tabla por tabla, nivel macro)

### Identidad y control

- `profiles`
- `user_roles`
- `user_juzgados`

### Núcleo documental

- `cedulas`
- `expedientes`
- `pjn_favoritos`
- `pjn_sync_metadata`

### Mediaciones

- `mediaciones`
- `mediacion_requeridos`
- `mediacion_requirentes`
- `mediacion_observaciones`
- `mediacion_historial`
- `mediacion_documentos`
- `mediacion_lotes`
- `mediacion_lote_items`

### Comunicación

- `notifications`
- `conversations`
- `conversation_participants`
- `messages`

### Transfers

- `file_transfers`
- `file_transfer_versions`

### Otros módulos

- Órdenes médicas: `ordenes_medicas`, `gestiones_estudio`, `comunicaciones`, `ordenes_medicas_archivos`.

## 7) APIs más relevantes por responsabilidad

### Cédulas / PJN / OCR

- `/api/cedulas/[id]/cargar-pjn`
- `/api/cedulas/[id]/confirmar-pjn`
- `/api/cedulas/[id]/procesar-ocr`
- `/api/diligenciamiento`
- `/api/diligenciamiento/[id]/cargar-pjn`
- `/api/open-file`

### Expedientes / PJN data

- `/api/search-expediente-pjn`
- `/api/fetch-expediente-pjn`
- `/api/pjn/sync-favoritos`
- `/api/pjn-login`
- `/api/pjn-update-cookies`

### Mediaciones

- `/api/mediaciones/**` (create/list/detail/lotes/send/etc.)

### Notificaciones / chat

- `/api/notifications/**`
- `/api/chat/**`

### Transfers

- `/api/transfers/**`

### Administración

- `/api/webmaster/users`
- `/api/webmaster/users/[userId]`

## 8) Integraciones externas

- **Supabase primario** (Auth/DB/Storage).
- **Supabase secundario** para base scraper PJN.
- **Vercel** (hosting + cron).
- **Railway PJN uploader** (Playwright).
- **OCR extractor service** (HTTP interno).
- **Resend** para correos de mediaciones/lotes.
- **Puppeteer/Playwright** para scraping/automatización.

## 9) Variables de entorno críticas

### Supabase

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

### PJN / OCR / Automatización

- `RAILWAY_OCR_URL`
- `RAILWAY_CARGAR_PJN_URL`
- `RAILWAY_INTERNAL_SECRET`
- `PJN_USER`
- `PJN_PASS`
- `PJN_SYNC_SECRET`

### Scraper DB

- `NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL`
- `NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_ANON_KEY`
- `PJN_SCRAPER_TABLE_NAME`

### Correo y otras integraciones

- `NEXT_PUBLIC_PJN_JURISDICCION`
- `RESEND_API_KEY`
- `RESEND_FROM`
- `PDF_EXTRACTOR_URL`

## 10) Build, release y operación

### App principal

- Build: `npm run build`
- Deploy: Vercel sobre branch principal.
- Cron configurado en `vercel.json`.

### Servicios auxiliares

- OCR extractor y PJN uploader se despliegan por separado.
- La app principal los consume por URL/env.

### Operación diaria

- Logs en Vercel + logs de servicios externos.
- Flujos sensibles: PJN, OCR, envío de lotes, sincronización favoritos.

## 11) Riesgos técnicos y deuda observable (priorizada)

### Alto impacto

- Controles de autenticación/autorización no totalmente centralizados.
- Dependencia fuerte de automatización/scraping PJN (fragilidad ante cambios de tercero).
- Manejo distribuido de lógica de negocio en componentes grandes.

### Medio impacto

- Compatibilidad de esquema por fallbacks de columnas puede complejizar mantenimiento.
- Varias rutas con lógicas similares de permisos/actualización.

### Recomendaciones inmediatas

1. Centralizar autorización por políticas reutilizables (server helpers/middleware).
2. Normalizar contratos API del flujo PJN (request/response y semántica de estado).
3. Consolidar runbooks de incidentes (PJN/OCR/Resend).
4. Reducir tamaño de páginas críticas separando hooks y servicios de dominio.

## 12) Evidencias principales (rutas de referencia)

- `README.md`
- `app/app/page.tsx`
- `app/diligenciamiento/page.tsx`
- `app/app/expedientes/page.tsx`
- `app/api/cedulas/[id]/cargar-pjn/route.ts`
- `app/api/cedulas/[id]/confirmar-pjn/route.ts`
- `app/api/cedulas/[id]/procesar-ocr/route.ts`
- `app/api/diligenciamiento/route.ts`
- `app/api/mediaciones/create/route.ts`
- `app/api/mediaciones/lotes/send/route.ts`
- `app/api/transfers/send/route.ts`
- `app/api/open-file/route.ts`
- `lib/auth-api.ts`
- `lib/supabase.ts`
- `lib/supabase-server.ts`
- `migrations/*.sql` (roles, RLS, módulos de negocio)
- `vercel.json`
- `docs/deployment/*.md`
- `pdf-extractor-service/*`
- `railway-service/cargar-pjn/*`

---

Si querés, en una segunda versión te lo convierto a:

- matriz técnica por módulo (`UI -> API -> tablas -> roles -> integraciones`), y
- mapa de riesgos con plan de hardening en 30/60/90 días.
