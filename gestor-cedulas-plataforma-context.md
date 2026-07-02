# Contexto técnico — Gestor Cédulas (plataforma)

> Documento generado por auditoría del repositorio `gestor-cedulas` (mayo 2026).  
> Objetivo: permitir que otro arquitecto entienda el sistema sin abrir el código.  
> Regla aplicada: lo no verificado en código se marca explícitamente.

---

# 1. Resumen ejecutivo

| Campo | Valor |
|-------|--------|
| **Nombre del proyecto** | Gestor de Cédulas / Oficios (`gestor-cedulas`, `package.json`) |
| **Objetivo funcional** | Plataforma legal-operativa para un estudio jurídico: gestionar cédulas y oficios, expedientes, diligenciamiento en PJN, mediaciones, notificaciones, transferencias de archivos, OCR/clasificación documental y módulos satélite (órdenes médicas, reiteratorios, auditoría PDF). |
| **Problema que resuelve** | Centralizar trabajo documental y de seguimiento por rol/juzgado, con semáforo de antigüedad, trazabilidad de carga en PJN e integración con datos del Poder Judicial (scraper/favoritos). |
| **Usuarios involucrados** | SuperAdmin, Admin Cédulas, Admin Expedientes, Admin Órdenes Médicas, Admin Mediaciones, Mediador, Abogado (documentado en `README.md` y ampliado en código/migraciones). |
| **Estado general percibido** | Producción activa en Vercel (`README.md`: `https://gestor-cedulas.vercel.app`). Monorepo maduro con múltiples dominios acoplados al mismo deploy; documentación operativa extensa en `docs/`. Evolución continua (auditoría PDF, OCR histórico, mediaciones). |
| **Complejidad estimada** | **Alta** — ~71 API routes, 64 migraciones SQL, 3+ servicios desplegables (Vercel + Railway/Render + VPS PJN), páginas de 2.000–4.700 líneas, librería de auditoría ~2.100 líneas. |

---

# 2. Arquitectura general

## Arquitectura detectada

**Monorepo híbrido**: aplicación full-stack Next.js (App Router) como núcleo, con microservicios auxiliares en subcarpetas y dependencias externas (Supabase, servicios OCR/PJN en Railway o VPS).

Patrón predominante: **BFF en Vercel** (UI + `app/api/*`) → **Supabase** (Auth, PostgreSQL, Storage) → **workers/servicios externos** (PDF extractor, OCR Railway, Playwright PJN).

## Componentes principales

| Componente | Ubicación | Rol |
|----------|-----------|-----|
| Frontend + API | `app/` | UI React 19 + 71 `route.ts` bajo `app/api/` |
| Lógica compartida | `lib/` | Supabase, auth API, semáforo, auditoría PDF, OCR PJN, payloads PJN |
| Esquema DB | `migrations/` | 64 archivos SQL (RLS, tablas, RPC) |
| PDF extractor | `pdf-extractor-service/` | Express + Poppler + Tesseract |
| Carga PJN (Playwright) | `railway-service/cargar-pjn/` | Express + `pjn_uploader.js` |
| Scripts ops | `scripts/` | Sync favoritos, diagnósticos, usuarios |
| Documentación | `docs/` | Deploy, PJN, migraciones, troubleshooting |

**No verificado en este repo:** servicio OCR completo (`RAILWAY_OCR_URL` → endpoints `/procesar`, `/procesar-oficio`, `/procesar-reiteratorio`). El código lo consume pero su implementación no está en `railway-service/cargar-pjn/` (solo expone `/cargar-pjn`).

Carpetas raíz vacías o sin archivos trackeados visibles en auditoría: `pjn-agent/`, `chrome-extension/`, `data/` (**No verificado** — pueden ser placeholders o contenido ignorado).

## Dependencias internas

```
app/pages & components
    → lib/supabase.ts, lib/auth-api.ts, lib/semaforo.ts
    → fetch → app/api/*
app/api/*
    → lib/supabase-server.ts (service role)
    → lib/* (auditoria, ocr, pjn-payload, cedula-procesar-ocr)
    → HTTP → pdf-extractor-service, RAILWAY_OCR_URL, RAILWAY_CARGAR_PJN_URL, PJN_LOCAL_URL
migrations/  (aplicación manual en Supabase SQL Editor)
scripts/     (operaciones batch contra mismas env vars)
```

## Dependencias externas

- **Supabase**: Auth JWT, PostgreSQL, Storage, RPC.
- **Vercel**: hosting, serverless functions, cron (`vercel.json`).
- **Railway / Render** (documentado): OCR y/o `cargar-pjn` según `docs/deployment/*`.
- **VPS PJN** (referenciado en código): `PJN_LOCAL_URL` para reiteratorios (`lib/pjn-payload.ts`, `app/api/reiteratorios/[id]/presentar/route.ts`).
- **OpenAI**: clasificación/auditoría PDF y detección por visión (`openai` en `package.json`, `OPENAI_API_KEY`).
- **Resend**: envío de lotes de mediaciones (`resend` en `package.json`).
- **PJN (portal judicial)**: login/scraping vía Puppeteer/Playwright.

## Diagrama textual de alto nivel

```
[Usuarios navegador]
        │
        ▼
┌───────────────────────────────────────┐
│  Next.js (Vercel)                     │
│  app/* páginas  +  app/api/* routes   │
└───────┬───────────────┬───────────────┘
        │               │
        ▼               ▼
┌───────────────┐  ┌────────────────────────────┐
│ Supabase      │  │ Servicios externos         │
│ - Auth        │  │ - PDF_EXTRACTOR_URL        │
│ - PostgreSQL  │  │ - RAILWAY_OCR_URL          │
│ - Storage     │  │ - RAILWAY_CARGAR_PJN_URL   │
│   cedulas,    │  │ - PJN_LOCAL_URL (VPS)      │
│   transfers,  │  │ - OpenAI API               │
│   mediaciones │  │ - Resend                   │
└───────────────┘  └────────────────────────────┘
        │
        ▼ (cron diario)
/api/pjn/sync-favoritos  ←→  Supabase PJN-scraper (cases) + pjn_favoritos local
```

---

# 3. Stack tecnológico

## Frameworks y lenguajes

| Capa | Tecnología | Evidencia |
|------|------------|-----------|
| Web app | Next.js **16.1.1** App Router | `package.json` |
| UI | React **19.2.3** | `package.json` |
| Lenguaje | TypeScript **5.x** | `package.json`, `tsconfig.json` |
| PDF extractor | Node **20+**, Express | `pdf-extractor-service/package.json`, README |
| PJN uploader | Node, Express, Playwright | `railway-service/cargar-pjn/` |

## Librerías principales (app raíz)

| Librería | Versión (package.json) | Uso |
|----------|------------------------|-----|
| `@supabase/supabase-js` | ^2.89.0 | Cliente DB/Auth/Storage |
| `mammoth` | ^1.11.0 | Extracción DOCX |
| `pdf-parse` | ^2.4.5 | PDF en servidor Next |
| `pdf-lib` | ^1.17.1 | Manipulación PDF |
| `jspdf` | ^4.0.0 | Reportes dashboard |
| `openai` | ^6.39.0 | Vision / auditoría |
| `playwright` / `puppeteer` | ^1.57 / ^24.35 | PJN cookies / scraper |
| `resend` | ^6.9.3 | Email mediaciones |
| `jszip` | ^3.10.1 | ZIP documental |

## Herramientas de build

- `npm run dev` / `build` / `start` / `lint` — `package.json`
- ESLint 9 + `eslint-config-next` 16.1.1
- Sin `middleware.ts` en raíz (**verificado**: búsqueda sin resultados)

## Servicios utilizados

| Servicio | Uso en proyecto |
|----------|-----------------|
| Vercel | App principal + cron |
| Supabase | DB + Auth + Storage |
| Railway | OCR (externo al repo) y/o `cargar-pjn` |
| Render | Documentado para `pdf-extractor-service` |
| OpenAI | Clasificación documental |
| Resend | Mediaciones por lote |
| GitHub | CI/CD vía push a `main` → Vercel (**documentado**, sin `.github/workflows` en raíz del repo) |

**No detectado en código del proyecto (salvo deps de terceros en node_modules):** Anthropic, Cloudflare.

---

# 4. Estructura del repositorio

## Árbol resumido

```
gestor-cedulas/
├── app/                          # Next.js App Router (páginas + API)
├── lib/                          # Utilidades TS compartidas
├── migrations/                   # SQL Supabase (64 archivos)
├── scripts/                      # Mantenimiento y batch (.mjs, .ts)
├── docs/                         # Runbooks y contexto operativo
├── pdf-extractor-service/        # Microservicio Docker Poppler/Tesseract
├── railway-service/cargar-pjn/   # Microservicio Playwright POST /cargar-pjn
├── public/                       # Assets estáticos (logo, etc.)
├── pjn-agent/                    # Vacío / no verificado
├── chrome-extension/             # Vacío / no verificado
├── data/                         # Vacío / no verificado
├── vercel.json                   # Crons y maxDuration funciones pesadas
├── package.json
└── README.md
```

## Carpetas principales

### `app/`

| Aspecto | Detalle |
|---------|---------|
| **Propósito** | UI y API HTTP del producto |
| **Importancia** | Crítica — todo el producto visible |
| **Dependencias** | `lib/`, Supabase client, env vars |
| **Riesgos** | Páginas gigantes (`superadmin/mis-juzgados` ~3912 líneas, `prueba-pericia` ~4721); lógica de negocio mezclada con UI |

Subáreas clave: `app/app/` (módulo operativo), `app/api/` (71 endpoints), `app/superadmin/`, `app/diligenciamiento/`, `app/admin/`, `app/webmaster/`.

### `lib/`

| Aspecto | Detalle |
|---------|---------|
| **Propósito** | Lógica reutilizable (auth, semáforo, auditoría, OCR helpers) |
| **Importancia** | Alta — concentración de reglas complejas |
| **Dependencias** | Supabase server, OpenAI, fetch a servicios externos |
| **Riesgos** | `auditoria-tipo-documento-pdf.ts` ~2131 líneas — punto único de fallo |

### `migrations/`

| Aspecto | Detalle |
|---------|---------|
| **Propósito** | Evolución de esquema y RLS |
| **Importancia** | Crítica — sin orden correcto, producción rompe |
| **Dependencias** | Supabase SQL Editor (aplicación manual según README) |
| **Riesgos** | Sin migrator automático; drift entre entornos |

### `pdf-extractor-service/`

| Aspecto | Detalle |
|---------|---------|
| **Propósito** | Extracción texto PDF (Poppler + OCR fallback) |
| **Importancia** | Media-alta para autorrelleno DOCX/PDF legacy |
| **Dependencias** | Docker, variables `PORT`, `OCR_TIMEOUT` |
| **Riesgos** | Cold start en plan free Render; desacople de versión vs app |

### `railway-service/cargar-pjn/`

| Aspecto | Detalle |
|---------|---------|
| **Propósito** | Automatización subida PDF a portal PJN |
| **Importancia** | Crítica para diligenciamiento |
| **Dependencias** | `PJN_USUARIO`, `PJN_PASSWORD`, Playwright, `RAILWAY_INTERNAL_SECRET` |
| **Riesgos** | Fragilidad ante cambios UI PJN; `node_modules` commiteado en subcarpeta |

### `scripts/`

| Aspecto | Detalle |
|---------|---------|
| **Propósito** | Ops: sync favoritos, duplicados, diagnósticos, usuarios |
| **Importancia** | Media — mantenimiento y recuperación |
| **Dependencias** | Mismas env que producción |
| **Riesgos** | Ejecución manual; algunos scripts loguean prefijos de keys (`remove-duplicates-cases.mjs`) |

### `docs/`

| Aspecto | Detalle |
|---------|---------|
| **Propósito** | Procedimientos deploy, PJN, troubleshooting |
| **Importancia** | Alta para operación |
| **Dependencias** | Puede desactualizarse vs código |
| **Riesgos** | Duplicación con `README.md` y `docs/CONTEXTO_PROYECTO_COMPLETO.md` |

---

# 5. Variables de entorno

> Solo nombres y uso. **No incluir valores reales.** El archivo `.env.local` existe en el workspace pero está en `.gitignore` — su contenido no fue auditado.

## Tabla de variables detectadas

| Nombre | Uso aparente | Criticidad |
|--------|--------------|------------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL proyecto Supabase principal | Crítica |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cliente browser + validación JWT en APIs | Crítica |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypass RLS en APIs servidor | Crítica (secreto) |
| `NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL` | Segunda instancia Supabase (scraper/cases) | Alta |
| `NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_ANON_KEY` | Lectura scraper desde cliente/API | Alta |
| `PJN_SCRAPER_TABLE_NAME` | Tabla cases (default `cases`) | Media |
| `PJN_SCRAPER_SERVICE_ROLE_KEY` | Scripts con permisos elevados scraper | Alta (scripts) |
| `PJN_SCRAPER_SUPABASE_URL` | Alias legacy en scripts | Media |
| `SUPABASE_URL` | Alias legacy en scripts | Baja |
| `NEXT_PUBLIC_SEMAFORO_LEGACY_CUTOFF_DATE` | Excepción semáforo ROJO registros antiguos | Media |
| `PDF_EXTRACTOR_URL` | Base servicio Poppler/Tesseract | Alta |
| `RAILWAY_OCR_URL` | OCR cédula/oficio/reiteratorio | Crítica (flujos OCR) |
| `RAILWAY_CARGAR_PJN_URL` | Prioridad sobre OCR URL para POST `/cargar-pjn` | Crítica (PJN) |
| `RAILWAY_INTERNAL_SECRET` | Header `x-internal-secret` servicios Railway | Alta |
| `PJN_LOCAL_URL` | VPS Playwright (reiteratorios; fallback cargar-pjn) | Alta |
| `PJN_USUARIO` / `PJN_PASSWORD` | Credenciales estudio en Railway uploader | Crítica |
| `PJN_USER` / `PJN_PASS` | Credenciales en scripts/`pjn-update-cookies` | Crítica |
| `PJN_JURISDICCION` | Default jurisdicción uploader | Media |
| `PJN_HEADFUL`, `PJN_SKIP_FINAL_SEND`, `PJN_SLOW_MO_MS`, `PJN_HEADFUL_PAUSE_MS` | Debug Playwright local | Baja |
| `PJN_UPLOAD_DRY_RUN` | Dry-run subida PJN | Baja |
| `OPENAI_API_KEY` | GPT Vision auditoría y detect-type-upload | Alta |
| `AUDIT_OPENAI_MODEL` | Modelo auditoría (default en lib) | Media |
| `DETECT_TYPE_GPT_VISION` | Desactivar visión si `"false"` | Media |
| `DETECT_TYPE_GPT_MAX_PAGES` | Límite páginas visión | Baja |
| `RESEND_API_KEY` | Envío emails mediaciones | Alta (si se usa envío real) |
| `RESEND_FROM` | Remitente email | Media |
| `PJN_SYNC_SECRET` | Protección endpoint cron sync favoritos | Alta |
| `NEXT_PUBLIC_FEATURE_ORDENES_SEGUIMIENTO` | Feature flag UI prueba-pericia | Media |
| `NODE_ENV` | Mensajes error desarrollo en APIs | Baja |
| `PORT` | Puerto microservicios | Media |
| `OCR_TIMEOUT`, `ENDPOINT_TIMEOUT` | Timeouts pdf-extractor | Media |
| `SCW_TOTAL_PAGES` | Scripts análisis scraper | Baja |

Variables Railway cargar-pjn adicionales: ver comentario en `railway-service/cargar-pjn/server.mjs`.

## Variables faltantes (respecto a README)

- No existe `.env.example` en el repo (**verificado**). El README lista un subconjunto; faltan en README pero existen en código: `RAILWAY_*`, `OPENAI_*`, `PJN_LOCAL_URL`, `RESEND_*`, `PJN_SYNC_SECRET`, roles mediaciones, etc.

## Variables posiblemente obsoletas

| Par | Notas |
|-----|-------|
| `PJN_USER` vs `PJN_USUARIO` | Duplicación naming entre Next/scripts y Railway |
| `PJN_PASS` vs `PJN_PASSWORD` | Idem |
| `PJN_SCRAPER_SUPABASE_URL` vs `NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL` | Scripts aceptan ambos |
| `SYNC_TOKEN` (Tampermonkey `scripts/tampermonkey/pjn-sync.user.js`) vs `PJN_SYNC_SECRET` (API) | **Posible inconsistencia documental** — verificar cuál está activo en producción |

## Variables duplicadas / solapadas

- `RAILWAY_OCR_URL` y `RAILWAY_CARGAR_PJN_URL`: mismo host si un solo servicio, distintos si OCR y PJN están separados (`docs/PJN_CARGAR_CONTEXTO.md`).
- `PJN_LOCAL_URL` incluido en cadena de fallback de `pjnVpsBaseUrl()` junto con Railway.

---

# 6. Base de datos y almacenamiento

## Plataforma

- **Supabase** = PostgreSQL + Auth + Storage + RPC PostgreSQL.
- Segunda base **pjn-scraper** (opcional): tablas `cases`, `case_snapshots` referenciadas en `app/api/search-expediente-pjn/route.ts`, `app/api/pjn/get-movimientos/route.ts`.

## Storage — buckets detectados

| Bucket | Propósito | Archivos |
|--------|-----------|----------|
| `cedulas` | PDF/DOCX cédulas y oficios | `README.md`, `lib/auditoria-tipo-documento-pdf.ts`, RLS migrations |
| `transfers` | Archivos enviados entre usuarios | `migrations/create_transfers_bucket.sql`, `app/api/transfers/*` |
| `mediaciones` | PDFs generados mediaciones | `migrations/create_mediaciones_module.sql`, `app/api/mediaciones/lotes/send/route.ts` |
| `ordenes-medicas` | Adjuntos órdenes médicas | `app/api/ordenes-medicas/upload/route.ts` |

## RPC / Functions (PostgreSQL)

| Función | Propósito | Archivos |
|---------|-----------|----------|
| `is_superadmin` | Chequeo rol | `app/cambiar-password/page.tsx`, `app/superadmin/config/page.tsx` |
| `is_admin_cedulas` | RLS admin cédulas | `migrations/add_admin_cedulas.sql` |
| `is_admin_expedientes` | RLS expedientes | `migrations/add_admin_expedientes.sql` |
| `is_abogado` | RLS abogado | `migrations/add_abogado_role_and_juzgados.sql` |
| `mark_notification_read` | Leer notificación | `migrations/create_notifications_table.sql`, `app/app/notificaciones/page.tsx` |
| `get_thread_root` | Hilos notificaciones | `migrations/add_notifications_threading.sql` |
| `get_or_create_direct_conversation` | Chat | `migrations/create_chat_system.sql` |
| `mark_conversation_read` | Chat | Idem |
| `generate_mediacion_numero` | Numeración mediación | `migrations/create_mediaciones_module.sql` |
| `normalize_juzgado` | Normalización juzgado PJN | `migrations/normalize_pjn_favoritos_juzgado.sql` |
| `parse_expediente` | Parseo número exp | `migrations/migrate_cases_to_pjn_favoritos.sql` |
| `get_transfer_id_from_path` | RLS storage transfers | `migrations/create_transfers_bucket.sql` |
| `check_max_archivos_per_orden` | Límite archivos orden médica | `migrations/add_ordenes_medicas_archivos_table.sql` |

**No verificado:** definición SQL de `is_superadmin` (usada vía RPC pero migración exacta no listada en grep de `CREATE OR REPLACE FUNCTION is_superadmin`).

## Tabla de entidades

| Entidad | Propósito | Archivos donde aparece |
|---------|-----------|------------------------|
| `profiles` | Perfil usuario, `must_change_password` | `README.md`, `app/cambiar-password/page.tsx` |
| `user_roles` | Flags de rol (superadmin, admin_*, abogado, mediador…) | `README.md`, `lib/auth-api.ts`, migraciones roles |
| `user_juzgados` | Juzgados asignados a abogados | `migrations/add_abogado_role_and_juzgados.sql` |
| `cedulas` | Núcleo cédulas/oficios + OCR + PJN | `README.md`, `migrations/add_ocr_cedulas.sql`, APIs `cedulas/*` |
| `expedientes` | Expedientes del estudio | `migrations/add_admin_expedientes.sql`, `app/app/expedientes/` |
| `pjn_favoritos` | Copia local favoritos PJN | `migrations/create_pjn_favoritos_table.sql`, sync API |
| `pjn_sync_metadata` | Metadata última sync | `migrations/create_pjn_sync_metadata_table.sql` |
| `cedulas_tipo_documento_pdf_audit` | Auditoría contenido PDF vs tipo | `migrations/create_cedulas_tipo_documento_pdf_audit.sql` |
| `cedulas_tipo_documento_audit` | Reclasificación histórica SQL | `migrations/audit_reclasificar_tipo_documento_oficio.sql` |
| `mediaciones` + tablas hijas | Módulo mediaciones | `migrations/create_mediaciones_module.sql` |
| `notifications` | Notificaciones in-app | `migrations/create_notifications_table.sql` |
| `conversations`, `messages` | Chat | `migrations/create_chat_system.sql` |
| `file_transfers`, `file_transfer_versions` | Transferencias archivos | `migrations/create_file_transfers_tables.sql` |
| `ordenes_medicas`, `gestiones_estudio`, `comunicaciones`, `ordenes_medicas_archivos` | Órdenes médicas / pericia | `migrations/create_ordenes_medicas_tables.sql` |
| `scraper_errors` | Errores scraper PJN | `migrations/create_scraper_errors_table.sql` |
| `admin_digest_prefs` | Preferencias reportes superadmin | `app/superadmin/config/page.tsx` (**tabla puede no existir** — UI muestra mensaje si falta) |
| `cases`, `case_snapshots` | Base scraper externa | `app/api/search-expediente-pjn/route.ts` |

## Relaciones observadas

- `cedulas.owner_user_id` → `auth.users` (implícito RLS).
- `cedulas_tipo_documento_pdf_audit.cedula_id` → `cedulas.id` ON DELETE CASCADE.
- `mediacion_lote_items` → `mediacion_lotes`, `mediaciones`.
- `file_transfer_versions` → `file_transfers`.
- `user_juzgados.user_id` → usuarios abogados.

## Migraciones

- **64 archivos** en `migrations/`.
- Aplicación: manual en Supabase SQL Editor (`README.md`) — **sin** herramienta de migración versionada en CI detectada.

---

# 7. APIs e integraciones

## Resumen por integración

| Integración | Propósito | Archivos involucrados | Criticidad |
|-------------|-----------|----------------------|------------|
| **Supabase** | DB, Auth, Storage, RPC | `lib/supabase.ts`, `lib/supabase-server.ts`, casi todos `app/api/*` | Crítica |
| **Vercel** | Hosting + cron sync | `vercel.json`, `docs/deployment/*` | Crítica |
| **Railway** | OCR + carga PJN Playwright | `lib/cedula-procesar-ocr.ts`, `railway-service/cargar-pjn/`, env `RAILWAY_*` | Crítica |
| **VPS (PJN local)** | Reiteratorios / fallback PJN | `lib/pjn-payload.ts`, `app/api/reiteratorios/[id]/presentar/route.ts` | Alta |
| **PDF Extractor (Render/Docker)** | Texto PDF carátula/juzgado | `app/api/extract-pdf/route.ts`, `pdf-extractor-service/` | Alta |
| **OpenAI** | Vision tipo documento, auditoría PDF | `lib/gpt-vision-tipo-documento.ts`, `lib/auditoria-tipo-documento-pdf.ts`, `app/api/detect-type-upload/route.ts` | Alta |
| **PJN (portal)** | Login cookies, expedientes, carga documentos | `app/api/pjn-login/route.ts`, `app/api/pjn-update-cookies/route.ts`, scripts `pjn-scraper.ts` | Crítica |
| **PJN Scraper DB** | Autocompletado expedientes, movimientos | `lib/pjn-scraper-supabase.ts`, `app/api/search-expediente-pjn/route.ts` | Media-Alta |
| **Resend** | Email lotes mediaciones | `app/api/mediaciones/lotes/send/route.ts` | Media |
| **GitHub** | Trigger deploy Vercel | Documentado README | Media |
| **Anthropic** | — | No detectado | — |
| **Cloudflare** | — | No detectado en código app | — |

## APIs internas destacadas (por dominio)

**Cédulas / OCR / PJN:** `app/api/cedulas/[id]/procesar-ocr`, `cargar-pjn`, `confirmar-pjn`, `app/api/diligenciamiento/*`, `app/api/detect-type-upload`.

**Auditoría admin:** `app/api/admin/auditoria-tipo-documento-pdf/*` (list, run, preview, apply, review, manual-classification, auto-confirm).

**Mediaciones:** `app/api/mediaciones/**` (create, list, lotes, send, generate-pdf, generate-doc).

**Órdenes médicas:** `app/api/ordenes-medicas/**`.

**Transferencias:** `app/api/transfers/*`.

**Cron:** `GET/POST app/api/pjn/sync-favoritos` — schedule `0 0 * * *` en `vercel.json`.

**Endpoints con autenticación débil o ausente (revisar):**

| Endpoint | Nota |
|----------|------|
| `app/api/detect-type/route.ts` | Usa service role; auth en header opcional |
| `app/api/extract-*` | Documentado README como sin auth requerida |
| `app/api/pjn-update-cookies/route.ts` | Puppeteer + credenciales default en código (**riesgo**) |
| `app/api/pjn/sync-favoritos/route.ts` | Protegido solo si `PJN_SYNC_SECRET` está definido |

---

# 8. Flujos funcionales

> Pasos basados en código y `docs/CONTEXTO_PROYECTO_COMPLETO.md`. Donde el paso depende de infra no presente en el repo, se marca.

## Ingreso de datos (cédula/oficio nueva)

1. Usuario con rol admin cédulas accede a `/app/nueva` (`app/app/nueva/page.tsx`).
2. Sube PDF/DOCX; para PDF llama detección (`/api/detect-type-upload` o extracción local).
3. Autorrelleno: DOCX vía `mammoth` (`/api/extract-caratula`, `/api/extract-juzgado`); PDF vía `PDF_EXTRACTOR_URL` o Railway OCR.
4. Persistencia en `cedulas` + upload Storage bucket `cedulas` (**patrón en páginas/API** — detalle de insert en `app/app/nueva/page.tsx` no re-leído línea a línea).

## Procesamiento OCR (cédula)

1. Desde lista (`app/app/page.tsx`) o flujo nueva, `POST /api/cedulas/[id]/procesar-ocr`.
2. `lib/cedula-procesar-ocr.ts` envía PDF a `RAILWAY_OCR_URL` (timeout 600s).
3. Actualiza `estado_ocr`, `ocr_exp_nro`, `ocr_caratula`, `pdf_acredita_url`, etc. (`migrations/add_ocr_cedulas.sql`).
4. `vercel.json` asigna `maxDuration: 300` a esta ruta.

## Diligenciamiento / carga PJN

1. `app/diligenciamiento/page.tsx` lista cédulas OCR listas (`/api/diligenciamiento`).
2. Usuario confirma → `/api/cedulas/[id]/confirmar-pjn`.
3. Carga → `/api/cedulas/[id]/cargar-pjn` → multipart a `{base}/cargar-pjn` en Railway/VPS (`lib/pjn-payload.ts`, `railway-service/cargar-pjn/server.mjs`).
4. Playwright sube PDF al portal PJN; marca `pjn_cargado_at` en éxito.

## Auditoría tipo documento PDF

1. Superadmin en `/admin/auditoria-tipo-documento` (`app/admin/auditoria-tipo-documento/page.tsx`).
2. `POST /api/admin/auditoria-tipo-documento-pdf/run` — lee PDF de Storage, clasifica (OpenAI / heurísticas en `lib/auditoria-tipo-documento-pdf.ts`).
3. Registra en `cedulas_tipo_documento_pdf_audit` sin modificar `cedulas` en fase preview.
4. Apply vía `/api/admin/auditoria-tipo-documento-pdf/apply` (estados `apply_estado` en migración reciente).

## Clasificación al upload

1. `POST /api/detect-type-upload` — GPT Vision si `OPENAI_API_KEY` y flag; fallback Railway `/procesar` + `/procesar-oficio` (`lib/detect-type-upload-classify.ts`).

## Búsqueda expedientes PJN

1. UI expedientes llama `POST /api/search-expediente-pjn` → consulta `cases` / `case_snapshots` en Supabase scraper.
2. `POST /api/fetch-expediente-pjn` para datos completos (**No verificado**: lógica interna completa).

## Mediaciones

1. CRUD en `app/app/mediaciones/*` + APIs `app/api/mediaciones/*`.
2. Lotes: armado en UI, envío `app/api/mediaciones/lotes/send/route.ts` (Resend si `RESEND_API_KEY`).
3. PDFs en bucket `mediaciones`.

## Reiteratorios

1. UI `app/reiteratorios/page.tsx` — oficios con `pjn_cargado_at` antiguo.
2. `POST /api/reiteratorios/[id]/presentar` — genera PDF, Storage, luego VPS/Railway `/procesar-reiteratorio` (**servicio OCR externo**).

## Sincronizaciones

1. **Cron Vercel** diario: `/api/pjn/sync-favoritos` (`vercel.json`).
2. Copia/normaliza favoritos desde scraper a `pjn_favoritos` local.
3. Scripts manuales: `scripts/sync-pjn-favoritos.mjs`, Tampermonkey `scripts/tampermonkey/pjn-sync.user.js`.

## Almacenamiento

- Upload vía Supabase Storage SDK en APIs y páginas.
- Descarga controlada: `/api/open-file` (JWT en query; validación parcial por decode sin verificar firma — ver sección 11).

## Publicación

- Deploy automático push a `main` → Vercel (`README.md`).
- Microservicios: deploy separado documentado en `docs/deployment/`.

---

# 9. Pantallas y UX

## Rutas de página (`app/**/page.tsx`)

| Ruta | Archivo | Rol / módulo |
|------|---------|--------------|
| `/` | `app/page.tsx` | Redirección por rol |
| `/login` | `app/login/page.tsx` | Auth |
| `/logout` | `app/logout/page.tsx` | Cierre sesión |
| `/select-role` | `app/select-role/page.tsx` | Multi-rol |
| `/cambiar-password` | `app/cambiar-password/page.tsx` | Password obligatorio |
| `/app` | `app/app/page.tsx` | Lista cédulas/oficios |
| `/app/nueva` | `app/app/nueva/page.tsx` | Alta cédula |
| `/app/abogado` | `app/app/abogado/page.tsx` | Vista abogado |
| `/app/expedientes` | `app/app/expedientes/page.tsx` | Expedientes |
| `/app/expedientes/nueva` | `app/app/expedientes/nueva/page.tsx` | Alta expediente |
| `/app/expedientes/[id]` | `app/app/expedientes/[id]/page.tsx` | Detalle |
| `/app/enviar` | `app/app/enviar/page.tsx` | Transferencias envío |
| `/app/recibidos` | `app/app/recibidos/page.tsx` | Transferencias recibidas |
| `/app/notificaciones` | `app/app/notificaciones/page.tsx` | Notificaciones (~1986 líneas) |
| `/app/mediaciones/*` | `app/app/mediaciones/**` | Mediaciones |
| `/superadmin` | `app/superadmin/page.tsx` | Dashboard (~3235 líneas) |
| `/superadmin/mis-juzgados` | `app/superadmin/mis-juzgados/page.tsx` | Vista juzgados (~3912 líneas) |
| `/superadmin/config` | `app/superadmin/config/page.tsx` | Config reportes |
| `/superadmin/removidos` | `app/superadmin/removidos/page.tsx` | Casos removidos PJN |
| `/diligenciamiento` | `app/diligenciamiento/page.tsx` | Carga PJN |
| `/webmaster`, `/webmaster/login` | `app/webmaster/**` | CRUD usuarios |
| `/admin/auditoria-tipo-documento` | `app/admin/auditoria-tipo-documento/page.tsx` | Auditoría PDF |
| `/reiteratorios` | `app/reiteratorios/page.tsx` | Reiteratorios |
| `/prueba-pericia` | `app/prueba-pericia/page.tsx` | Pericia + órdenes (~4721 líneas) |

## Componentes globales importantes

- `app/components/NotificationBell.tsx` + `NotificationBellWrapper.tsx` — campana en todas las páginas (`app/layout.tsx`).
- `app/components/FilterableTh.tsx`, `ResponsableAvatars.tsx` — tablas.
- `app/hooks/useColumnFilters.ts` — filtros columnas.

## Observaciones UX (desde estructura de código)

| Tema | Evidencia |
|------|-----------|
| **Páginas muy grandes** | `prueba-pericia`, `mis-juzgados`, `superadmin`, `app/page` — difícil mantenimiento y renders pesados |
| **Duplicación** | Lógica PJN Supabase repetida en varias páginas (`NEXT_PUBLIC_PJN_SCRAPER_*` en `superadmin`, `mis-juzgados`, `prueba-pericia`) |
| **Responsive** | CSS global `app/globals.css` + módulos puntuales (`diligenciamiento/page.module.css`) — **No verificado** comportamiento mobile sistemático |
| **Pantallas posiblemente obsoletas** | `docs/CONTEXTO` vs README difieren en rutas chat API — **No verificado** si chat UI está expuesta |
| **Oportunidades rediseño** | Extraer módulos por dominio (cédulas, expedientes, pericia) desde mega-páginas; design system ausente (CSS ad hoc) |

---

# 10. Calidad del código

## Métricas cualitativas

| Dimensión | Evaluación | Evidencia |
|-----------|------------|-----------|
| **Acoplamiento** | Alto entre UI ↔ Supabase ↔ env | Páginas llaman Supabase directo además de APIs |
| **Cohesión** | Media en `lib/`; baja en páginas | Lógica de negocio en `.tsx` miles de líneas |
| **Modularidad** | Parcial | Buenas libs (`auditoria`, `ocr-oficio-historico`); mal en pages |
| **Duplicación** | Alta | Patrones PJN/roles repetidos; scripts con mismas env |
| **Complejidad** | Alta | Auditoría PDF, sync favoritos, clasificación multi-fuente |
| **Deuda técnica** | Significativa | Ver sección 15 |

## Archivos gigantes (líneas aproximadas)

| Archivo | Líneas |
|---------|--------|
| `app/prueba-pericia/page.tsx` | ~4721 |
| `app/superadmin/mis-juzgados/page.tsx` | ~3912 |
| `app/superadmin/page.tsx` | ~3235 |
| `app/app/page.tsx` | ~2131 |
| `lib/auditoria-tipo-documento-pdf.ts` | ~2131 |
| `app/app/notificaciones/page.tsx` | ~1986 |

## Otros hallazgos

- **Lógica mezclada**: fetch + estado + reglas negocio + render en un solo componente.
- **Dependencias pesadas en serverless**: `puppeteer` y `playwright` en app principal (`package.json`) — cold start y límites Vercel.
- **Sin middleware central** de auth: cada ruta valida por su cuenta (`getUserFromRequest`, checks manuales).
- **Tests**: `scripts/test-auditoria-tipo-documento.ts`, `pdf-extractor-service/test/` — cobertura **No verificada** como suite CI.

---

# 11. Seguridad

## Riesgos identificados

| Riesgo | Severidad | Evidencia |
|--------|-----------|-----------|
| Credenciales PJN hardcodeadas como fallback | **Crítica** | `app/api/pjn-update-cookies/route.ts` líneas 100-101: defaults `PJN_USER` / `PJN_PASS` en código |
| Credenciales en README | **Crítica** | `README.md` tabla con emails y contraseñas iniciales |
| `SUPABASE_SERVICE_ROLE_KEY` en múltiples APIs | Alta | Bypass RLS — correcto si solo servidor, peligroso si filtra |
| JWT decode sin verificación firma en `open-file` | Alta | `app/api/open-file/route.ts` decodifica payload sin `getUser` Supabase |
| Endpoints extract/detect sin auth obligatoria | Media | `README.md`, `detect-type/route.ts` |
| Cron sync público sin secret | Media | `PJN_SYNC_SECRET` opcional |
| `RAILWAY_INTERNAL_SECRET` opcional | Media | Si vacío, microservicio acepta requests sin header |
| Cliente PJN scraper con anon key en browser | Media | `NEXT_PUBLIC_PJN_SCRAPER_*` en páginas superadmin |

## Autenticación

- Supabase Auth JWT.
- Helper `lib/auth-api.ts` → `getUserFromRequest` valida token con `supabase.auth.getUser(token)`.

## Autorización

- Flags en `user_roles` + RLS en Supabase.
- Checks adicionales en APIs (p. ej. `requireSuperadmin` en rutas admin).
- `user_juzgados` para abogados.
- **No hay** capa única middleware.

## Operaciones sensibles

- WebMaster CRUD usuarios (`app/api/webmaster/users/*`) — service role + verificación superadmin en rutas.
- Apply auditoría modifica `cedulas.tipo_documento`.
- Renuncia pericia solo superadmin (`app/api/prueba-pericia/renunciar/route.ts`).

## Manejo de secretos

- `.env*` en `.gitignore`.
- Variables públicas `NEXT_PUBLIC_*` expuestas al cliente por diseño.

---

# 12. Performance

| Área | Hallazgo | Archivos |
|------|----------|----------|
| Funciones largas Vercel | `maxDuration` 300s en OCR y cargar-pjn | `vercel.json` |
| OCR / PJN bloqueantes | Requests síncronos hasta 10 min (comentarios reiteratorios) | `lib/ocr-oficio-historico.ts`, `app/api/reiteratorios/*` |
| Páginas con miles de líneas | Re-renders costosos, bundles grandes | Ver sección 10 |
| Consultas N+1 potenciales | `ordenes-medicas/list` múltiples queries perfiles | `app/api/ordenes-medicas/list/route.ts` |
| Payload upload | Límite 4MB órdenes por límite Vercel 413 | `app/api/ordenes-medicas/upload/route.ts` |
| PDF extractor cold start | Documentado 15 min inactividad plan free | `pdf-extractor-service/README.md` |

**Tareas que deberían ser background (recomendación):** auditoría PDF masiva, OCR histórico batch, sync favoritos largo — hoy corren en request HTTP o cron único (**parcialmente** en cron para sync).

---

# 13. Observabilidad

| Capacidad | Estado |
|-----------|--------|
| **Logs** | `console.log/error/warn` en APIs (ej. 34 en `sync-favoritos`, 25 en `search-expediente-pjn`) |
| **Monitoreo APM** | **No detectado** (Sentry, Datadog, etc.) |
| **Métricas** | **No detectado** |
| **Trazabilidad** | Parcial vía campos DB (`created_by`, `ocr_procesado_at`, historial mediaciones) |
| **Manejo errores** | JSON errors en APIs; algunos incluyen `details` solo en `NODE_ENV=development` |

Logs operativos: Vercel Dashboard (documentado `README.md`, `docs/troubleshooting/`).

Tabla `scraper_errors` para errores del scraper PJN.

---

# 14. Dependencias transversales

## Otros proyectos que podrían depender de este

- **No verificado** consumidores externos explícitos.
- Tampermonkey `scripts/tampermonkey/pjn-sync.user.js` llama API del gestor (dependencia browser-side).

## Servicios compartidos

| Recurso | Compartido con |
|---------|----------------|
| Supabase principal | Esta app únicamente (**No verificado** otros clientes) |
| Supabase pjn-scraper | Proyecto scraper separado + esta app |
| `RAILWAY_OCR_URL` | Posible servicio `cedula-mvp` u homólogo (**No verificado** repo) |
| Storage bucket `cedulas` | Solo gestor |

## Bases compartidas

- `pjn_favoritos` es réplica derivada de `cases` del scraper.
- Posible misma instancia Supabase para scraper y app en algunos entornos (fallback en scripts).

## Procesos compartidos

- Cron sync favoritos vs scripts manuales `sync-pjn-favoritos.mjs` — mismos datos destino.
- Playwright: Vercel (`pjn-update-cookies`) vs Railway (`cargar-pjn`) — duplicación de capacidad.

---

# 15. Deuda técnica priorizada

## Crítica

| # | Descripción | Evidencia | Impacto | Recomendación |
|---|-------------|-----------|---------|---------------|
| C1 | Credenciales PJN por defecto en código fuente | `app/api/pjn-update-cookies/route.ts` | Compromiso cuenta PJN estudio | Eliminar defaults; rotar password; exigir env |
| C2 | Contraseñas de usuarios en README | `README.md` líneas 82-92 | Exposición credenciales reales/históricas | Quitar del repo; rotar passwords |
| C3 | Validación JWT débil en descarga archivos | `app/api/open-file/route.ts` | Acceso no autorizado a PDFs | Usar `getUser(token)` Supabase o signed URLs Storage |

## Alta

| # | Descripción | Evidencia | Impacto | Recomendación |
|---|-------------|-----------|---------|---------------|
| A1 | Mega-componentes UI (4k+ líneas) | `app/prueba-pericia/page.tsx` | Bugs, performance, onboarding | Dividir por features y hooks |
| A2 | Sin middleware auth central | Ausencia `middleware.ts` | Rutas olvidadas sin proteger | Middleware + política por rol |
| A3 | Migraciones SQL manuales sin versionado aplicado | `migrations/`, README | Drift prod/staging | Pipeline migraciones (Supabase CLI) |
| A4 | Servicio OCR no versionado en monorepo | Solo consumo `RAILWAY_OCR_URL` | Imposible auditar cambios OCR | Subir servicio o contrato OpenAPI |
| A5 | `node_modules` en `railway-service/cargar-pjn` | Glob listados | Repo pesado, supply chain | .gitignore + install en build |

## Media

| # | Descripción | Evidencia | Impacto | Recomendación |
|---|-------------|-----------|---------|---------------|
| M1 | Duplicación nombres env PJN_USER vs PJN_USUARIO | scripts vs railway | Config errónea deploy | Unificar documentación y nombres |
| M2 | SYNC_TOKEN vs PJN_SYNC_SECRET | tampermonkey vs API | Sync roto o inseguro | Una sola variable documentada |
| M3 | Puppeteer en Vercel serverless | `package.json`, pjn-update-cookies | Timeouts, tamaño función | Mover a worker dedicado |
| M4 | README desactualizado vs código | Faltan módulos mediaciones, órdenes, auditoría | Onboarding incorrecto | Actualizar o apuntar a este doc |
| M5 | Endpoints públicos extract/detect | README rutas API | Abuso extracción documentos | Auth obligatoria + rate limit |

## Baja

| # | Descripción | Evidencia | Impacto | Recomendación |
|---|-------------|-----------|---------|---------------|
| B1 | `admin_digest_prefs` sin migración en repo | `app/superadmin/config/page.tsx` | Feature incompleta | Agregar migración o quitar UI |
| B2 | Carpetas vacías pjn-agent, chrome-extension | Listado raíz | Confusión | Documentar o eliminar |
| B3 | `next.config.ts` vacío | Sin optimizaciones | Menor | Configurar headers, imágenes si aplica |
| B4 | Tests no integrados en CI | Sin `.github/workflows` raíz | Regresiones | Añadir job `npm test` / lint |

---

# 16. Propuesta de arquitectura objetivo

> Propuesta conceptual — **no implementada**.

## Módulos sugeridos

```
packages/
  domain-cedulas/      # entidades, semáforo, tipos documento
  domain-expedientes/
  domain-mediaciones/
  domain-pjn/
  infra-supabase/
  infra-ocr-client/
apps/
  web/                 # Next.js solo UI + BFF liviano
services/
  ocr-worker/          # Railway: procesar, procesar-oficio, reiteratorio
  pjn-worker/          # Playwright cargar-pjn (ya existe, extraer del monorepo)
  pdf-extract/         # pdf-extractor-service
  sync-worker/         # cron favoritos + colas
```

## Frontend

- Next.js con páginas < 500 líneas; state server via React Query o Server Components.
- Feature flags centralizados.
- Design tokens en CSS modules o Tailwind (decisión pendiente).

## Backend

- BFF delgado: validación auth + orquestación.
- Reglas de negocio en `packages/domain-*`.
- Service role solo en workers, no en rutas públicas de lectura.

## Workers y colas

- Cola (Supabase pg_cron + tablas jobs, o Redis/BullMQ) para: OCR batch, auditoría PDF, sync favoritos, emails mediaciones.
- Vercel cron dispara enqueue, worker procesa.

## OCR

- Contrato HTTP versionado (`/v1/procesar`, `/v1/procesar-oficio`).
- Timeouts y idempotency keys por `cedula_id`.

## Agentes

- `pjn-agent/` podría albergar automatización IA **No verificado** intención original.

## Servicios compartidos

- Un solo proyecto Supabase con schemas separados (`app`, `scraper`) o dos instancias con API de sync clara.
- Secrets en Vercel/Railway only; nunca en repo.

## Escalabilidad

- Separar OCR y PJN en instancias Railway independientes (ya previsto por env).
- CDN para assets `public/`.
- Read replicas Supabase si crece lectura dashboard.

## Mantenimiento

- Migraciones con Supabase CLI + revisiones en PR.
- ADRs en `docs/adr/`.
- Este archivo como entrada; detalle operativo en runbooks por servicio.

---

# 17. Archivos sensibles

| Archivo / patrón | Por qué no modificar sin revisión |
|------------------|-----------------------------------|
| `migrations/*.sql` | Alteran producción; orden y RLS irreversibles |
| `lib/auditoria-tipo-documento-pdf.ts` | Clasificación masiva; error afecta miles de `cedulas` |
| `lib/pjn-payload.ts` | Contrato con VPS/Railway PJN |
| `lib/cedula-procesar-ocr.ts` | Flujo diligenciamiento en producción |
| `app/api/cedulas/[id]/cargar-pjn/route.ts` | Automatización judicial real |
| `app/api/pjn/sync-favoritos/route.ts` | Cron diario; datos `pjn_favoritos` |
| `app/api/admin/auditoria-tipo-documento-pdf/apply/route.ts` | Escribe `tipo_documento` |
| `vercel.json` | Crons y límites tiempo funciones |
| `railway-service/cargar-pjn/pjn_uploader.js` | Selectores UI PJN frágiles |
| `migrations/add_superadmin_cedulas_rls.sql` y familia RLS | Seguridad datos |
| `.env.local` / secrets Vercel | Credenciales |
| `README.md` (sección credenciales) | Riesgo exposición si se “actualiza” con datos reales |

---

# 18. Preguntas abiertas

1. ¿Dónde está desplegado el código de `RAILWAY_OCR_URL` (repositorio, versión, endpoints exactos)?
2. ¿Producción usa `PJN_LOCAL_URL` (VPS) o solo Railway para diligenciamiento y reiteratorios?
3. ¿`PJN_SYNC_SECRET` y/o `SYNC_TOKEN` están configurados en Vercel producción?
4. ¿La tabla `admin_digest_prefs` existe en producción?
5. ¿Existe UI de chat (`conversations`/`messages`) o solo esquema DB?
6. ¿`pjn-agent/` y `chrome-extension/` tienen código en otro branch o repositorio?
7. ¿Instancias Supabase principal y pjn-scraper son proyectos distintos en todos los entornos?
8. ¿Hay CI (GitHub Actions) no commiteado o solo Vercel git integration?
9. ¿Política actual de retención/borrado en buckets Storage?
10. ¿Render sigue siendo el host de `PDF_EXTRACTOR_URL` en producción?

---

# 19. INPUT PARA REFACTORIZACIÓN

## Conservar

- Modelo de datos núcleo: `cedulas`, `expedientes`, `user_roles`, `user_juzgados`, `pjn_favoritos`.
- Librerías maduras: `lib/semaforo.ts`, `lib/pjn-payload.ts`, reglas validación `lib/ocr-oficio-historico.ts`.
- Microservicio `pdf-extractor-service` (lógica `text-util.js` probada).
- Flujo diligenciamiento end-to-end (UI + APIs + Railway cargar-pjn) — estabilizar antes que reescribir.
- Migraciones existentes como historial (aplicar baseline, no borrar).

## Separar

- UI por dominio: cédulas, expedientes, superadmin, pericia/mediaciones.
- Workers OCR y PJN del deploy Vercel.
- Cliente Supabase anon (browser) vs service role (workers only).
- Documentación operativa (`docs/deployment`) vs contexto arquitectura (este archivo).

## Eliminar (candidatos — validar en prod primero)

- Defaults de credenciales en `pjn-update-cookies`.
- Credenciales en `README.md`.
- `node_modules` commiteado bajo `railway-service/cargar-pjn/`.
- Carpetas vacías sin plan (`pjn-agent`, `chrome-extension`) si confirman vacías.

## Unificar

- Variables `PJN_USER` / `PJN_USUARIO` y `PJN_PASS` / `PJN_PASSWORD`.
- Secret de sync cron y Tampermonkey en un solo nombre.
- Documentos de contexto: `README.md`, `docs/CONTEXTO_PROYECTO_COMPLETO.md`, este archivo — un índice maestro.
- Patrón auth API: siempre `getUserFromRequest` + chequeo rol explícito.

## Migrar

- Migraciones SQL a Supabase CLI con historial aplicado.
- Puppeteer fuera de Vercel → worker Railway/VPS.
- Auditoría PDF masiva a jobs en background.
- Tests `scripts/test-auditoria-tipo-documento.ts` → CI automatizado.

## Rediseñar

- Páginas > 2000 líneas → feature modules + componentes.
- Autorización → middleware + políticas declarativas por ruta.
- `open-file` → signed URLs Supabase con TTL corto.
- Dashboard superadmin → API agregada de métricas (evitar queries masivas en cliente).
- Onboarding roles: flujo único post-login sin lógica dispersa en cada `page.tsx`.

---

## Referencias rápidas en el repositorio

| Documento | Uso |
|-----------|-----|
| `README.md` | Instalación, roles, rutas (parcialmente desactualizado) |
| `docs/CONTEXTO_PROYECTO_COMPLETO.md` | Contexto previo detallado por dominio |
| `docs/PJN_CARGAR_CONTEXTO.md` | Flujo cargar-pjn y variables Railway |
| `docs/deployment/*` | Deploy Vercel, Render, PDF extractor |
| `vercel.json` | Cron y timeouts |

---

*Fin del documento — `gestor-cedulas-plataforma-context.md`*
