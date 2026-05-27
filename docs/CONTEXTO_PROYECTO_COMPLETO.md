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

### 4.8 OCR oficio histórico (reproceso batch)

**Contexto:** registros antiguos clasificados como `CEDULA` que en realidad eran `OFICIO` fueron reclasificados (`cedulas_tipo_documento_audit` con motivo `bug_historico_oficios_presentados_como_cedulas`). Para esos casos hay que re-extraer destinatario/expediente/carátula vía OCR sin alterar el flujo PJN ya cumplido.

**Restricciones operativas (no negociables):**

- **No** se modifica `pjn_cargado_at`, `estado_ocr` ni `pdf_acredita_url`.
- Solo se actualizan `ocr_destinatario`, `ocr_exp_nro` (si estaba vacío), `ocr_caratula` (si estaba vacía) y `ocr_error: null`.
- Solo superadmin puede ejecutar (`requireSuperadmin`).

**Endpoints:**

- `app/api/admin/ocr-oficio-historico/preview/route.ts` — dry-run del universo de candidatos.
- `app/api/admin/ocr-oficio-historico/run/route.ts` — ejecución real (`limit` máx. 5, default 3; `dry_run=true` por defecto).

**Library compartida:** `lib/ocr-oficio-historico.ts`

- `fetchCandidatosOcrOficioHistorico` — universo: audit aplicado + `tipo_documento=OFICIO` + `estado_ocr=listo` + `pjn_cargado_at NOT NULL` + `ocr_destinatario` vacío.
- `invocarProcesarOficio(pdfBuffer, railwayUrl)` — POST a `${RAILWAY_OCR_URL}/procesar-oficio` con `FormData`. El `Buffer` se convierte a `ArrayBuffer` real (slice por `byteOffset`/`byteLength`) antes del `Blob` para compatibilidad con tipos de `BlobPart` en Node 22+.
- `buildPatchOcrOficioHistorico(cedula, headers)` — valida destinatario antes de armar el patch. Si falla devuelve `{ error, validation_error }` y **no se hace UPDATE**.

#### Validación de `ocr_destinatario` (hardening)

Helper público: `isValidDestinatarioOCR(value: string): boolean` (acompañado por `getDestinatarioOcrValidationError` para diagnósticos).

Reglas (en orden) — si alguna falla, se rechaza y se devuelve `validation_error`:

| # | Regla | Rechazo |
|---|-------|---------|
| 1 | No vacío | `null` o solo espacios |
| 2 | Longitud | `> 180` caracteres (`DESTINATARIO_OCR_MAX_LENGTH`) |
| 3 | Sin frases de cuerpo judicial | "Se hace saber", "Notifíquese", "Firmado electrónicamente", "deberá enviarse", "beneficio de litigar", "correo electrónico" (case-insensitive) |
| 4 | Saltos de línea | `> 3` `\n` |

**Motivación:** un registro real (`392ea72e-46e2-4f47-9bfa-1c283018badf`) tomó 939 caracteres de un proveído como destinatario. La validación corta ese tipo de salidas antes de persistir.

**Comportamiento ante rechazo:**

- No se ejecuta `update` en `cedulas`.
- La respuesta del ítem queda `ok: false` con `validation_error` (motivo concreto) y `error` (mensaje legible).
- Log: `[ocr-oficio-historico/run] Validación destinatario rechazada { id, validation_error, destinatario_length }`.

**Registros ya correctos:** el filtro de candidatos exige `ocr_destinatario` vacío; los registros con destinatario válido no entran al batch. Para reprocesar uno con destinatario corrupto hay que limpiarlo manualmente primero.

### 4.9 Reiteratorios

**UI:** `app/reiteratorios/page.tsx`  
Universo: oficios cargados en PJN hace ≥ 14 días que requieren reiteración. Filtro UI: `tipo_documento=OFICIO` + `estado_ocr=listo` + `pjn_cargado_at NOT NULL`.

**Endpoints:**

- `app/api/reiteratorios/[id]/presentar/route.ts` — presenta reiteratorio.
- `app/api/reiteratorios/diagnostico/route.ts` — diagnóstico del universo, exclusiones por etapa y muestras (ver `docs/auditoria-tipo-documento-reiteratorios.md`).

**Relación con 4.8:** el flujo histórico re-pobla `ocr_destinatario` para que esos registros pasen el chequeo de campos requeridos al presentar reiteratorio.

### 4.10 Prueba/Pericia y órdenes médicas

**UI:** `app/prueba-pericia/page.tsx` (feature flag `NEXT_PUBLIC_FEATURE_ORDENES_SEGUIMIENTO`)

Capacidades:

- **Detección:** expedientes con movimientos de Prueba/Pericia (tabla `expedientes` + casos PJN desde scraper `cases`).
- **Órdenes/Seguimiento:** workflow de órdenes médicas (subida PDF, gestión de estudio, comunicaciones).
- Botón **Crear Orden** por fila (hasta 5 archivos, máx. 4 MB total por request).
- Renuncia (solo superadmin): congela semáforo y estado `RENUNCIADO` en orden.

**Endpoints relevantes:**

- `app/api/ordenes-medicas/upload/route.ts` — creación/subida de archivos y orden
- `app/api/ordenes-medicas/list/route.ts`
- `app/api/ordenes-medicas/download/route.ts`
- `app/api/ordenes-medicas/update-estado/route.ts`
- `app/api/ordenes-medicas/create-gestion/route.ts`
- `app/api/ordenes-medicas/comunicacion/route.ts`

**Migraciones:** `migrations/create_ordenes_medicas_tables.sql`, `migrations/add_admin_ordenes_medicas.sql`, `migrations/add_ordenes_medicas_archivos_table.sql`, `migrations/add_renuncia_pericia_estados.sql`

**Documentación operativa:** `docs/ordenes-seguimiento-mvp.md`, `docs/flujo-ux-ordenes-medicas.md`

#### Permisos en upload vs. visibilidad de expedientes

- La grilla de Detección puede mostrar expedientes que el usuario **no posee** (RLS: abogado por `user_juzgados`, o lectura amplia según rol).
- Al subir desde un expediente en `expedientes` (no favorito PJN puro), el front envía `expediente_id` y el API valida acceso al expediente.
- Quién puede subir/crear orden en expediente ajeno (además del `owner_user_id`):
  - `is_superadmin`
  - `is_admin_expedientes`
  - **`is_admin_ordenes_medicas`** (rol pensado para operadores del circuito de órdenes, p. ej. Andrea)
- Favoritos PJN **sin** fila en `expedientes`: no se envía `expediente_id`; no aplica chequeo de dueño (solo `case_ref`).
- Si el mismo número existe en `expedientes` y en PJN, prevalece la fila de `expedientes` (`is_pjn_favorito: false`) y sí se exige permiso de upload.

**Usuario de referencia (órdenes):** `andreaestudio24@gmail.com` — `is_admin_ordenes_medicas=true`, `is_admin_cedulas=true`, `is_admin_expedientes=false` (evita pantalla select-role de admin expedientes).

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
- `is_admin_ordenes_medicas` — ver/listar/operar órdenes médicas en cualquier expediente; **no** implica admin de expedientes ni select-role de ese módulo (`migrations/add_admin_ordenes_medicas.sql`)
- `is_admin_mediaciones`
- `is_abogado`

#### Matriz rápida: órdenes médicas (APIs `app/api/ordenes-medicas/*`)

| Acción | Owner expediente | Emisor orden | `is_admin_ordenes_medicas` | `is_admin_expedientes` | `is_superadmin` |
|--------|------------------|--------------|----------------------------|------------------------|-----------------|
| Listar todas las órdenes | — | — | sí | sí | sí |
| Upload / crear orden (con `expediente_id`) | sí | — | sí | sí | sí |
| Download, update-estado, gestión, comunicación | según orden/expediente | sí (emisión) | sí | sí | sí |

Todas las rutas del módulo deben incluir `is_admin_ordenes_medicas` donde aplique bypass por rol (upload alineado desde commit `fix(ordenes-medicas): permitir upload con is_admin_ordenes_medicas`).

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
- `/api/admin/ocr-oficio-historico/preview` (superadmin, dry-run)
- `/api/admin/ocr-oficio-historico/run` (superadmin, batch real con validación)

### Reiteratorios

- `/api/reiteratorios/[id]/presentar`
- `/api/reiteratorios/diagnostico`

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

### Órdenes médicas / Prueba-Pericia

- `/api/ordenes-medicas/upload`
- `/api/ordenes-medicas/list`
- `/api/ordenes-medicas/download`
- `/api/ordenes-medicas/update-estado`
- `/api/ordenes-medicas/create-gestion`
- `/api/ordenes-medicas/comunicacion`

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
- Varias rutas con lógicas similares de permisos/actualización (mitigado en órdenes médicas: unificar siempre `is_admin_ordenes_medicas` en nuevas rutas del módulo).
- Desfase posible entre **ver** expediente en Prueba/Pericia y **subir** orden si falta el rol o el expediente pasó de solo-PJN a fila en `expedientes`.

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
- `app/prueba-pericia/page.tsx`
- `app/api/ordenes-medicas/upload/route.ts`
- `app/api/admin/ocr-oficio-historico/preview/route.ts`
- `app/api/admin/ocr-oficio-historico/run/route.ts`
- `app/api/reiteratorios/[id]/presentar/route.ts`
- `app/api/reiteratorios/diagnostico/route.ts`
- `app/reiteratorios/page.tsx`
- `lib/ocr-oficio-historico.ts` (helpers de validación `isValidDestinatarioOCR`, `getDestinatarioOcrValidationError`)
- `migrations/add_admin_ordenes_medicas.sql`
- `migrations/audit_reclasificar_tipo_documento_oficio.sql`
- `docs/ordenes-seguimiento-mvp.md`
- `docs/auditoria-tipo-documento-reiteratorios.md`
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
