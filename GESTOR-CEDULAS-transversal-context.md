# Contexto transversal — Ecosistema Gestor Cédulas

> Auditoría del repositorio `gestor-cedulas` enfocada en **dependencias transversales** (mayo 2026).  
> Solo lectura del código y documentación en repo. Sin secretos. Incertidumbres marcadas como **No verificado**.

---

# 1. Rol del proyecto dentro del ecosistema

## Rol principal detectado

Este repositorio es la **aplicación principal (hub operativo)** del ecosistema: frontend Next.js + BFF (`app/api/*`) desplegado en **Vercel**, con lógica de negocio y orquestación hacia servicios externos.

No es únicamente “frontend”: incluye workers lógicos embebidos (OCR en background, sync favoritos, Puppeteer en rutas PJN) y **dos microservicios empaquetados** en subcarpetas.

## Funciones que cumple (en el mismo repo)

| Función | ¿En este repo? | Evidencia |
|---------|----------------|-----------|
| App principal / BFF | **Sí** | `app/`, `package.json` (`next dev/build`) |
| Worker OCR PJN (procesar PDF) | **Parcial** — consume servicio externo | `lib/cedula-procesar-ocr.ts` → `RAILWAY_OCR_URL` |
| Worker carga PJN (Playwright) | **Parcial** — subcarpeta + consume host configurable | `railway-service/cargar-pjn/` |
| Scraper PJN favoritos | **No** — repo separado referenciado | `docs/troubleshooting/SCRAPER_ERRORS_SETUP.md` → `c:\proyectos\pjn-scraper` |
| Extracción PDF texto (Poppler/Tesseract) | **Sí** (microservicio) | `pdf-extractor-service/` |
| Generación documental (mediaciones, reportes) | **Sí** (en Vercel) | `jspdf` en `app/api/mediaciones/*` |
| Auditoría / clasificación PDF | **Sí** (en Vercel + OpenAI) | `lib/auditoria-tipo-documento-pdf.ts`, `app/api/admin/auditoria-tipo-documento-pdf/*` |
| Base de datos operativa | **No** — Supabase hosted | Clientes en `lib/supabase.ts`, `lib/supabase-server.ts` |

## Posición en el diagrama del ecosistema

```
[pjn-scraper] ──cases──► Supabase scraper
        │
        │ sync (cron / manual)
        ▼
[gestor-cedulas] ◄──► Supabase principal (cedulas, expedientes, …)
        │
        ├──► RAILWAY_OCR_URL (cedula-mvp u otro) — /procesar, /procesar-oficio, /procesar-reiteratorio
        ├──► RAILWAY_CARGAR_PJN_URL / PJN_LOCAL_URL — POST /cargar-pjn (Playwright)
        ├──► PDF_EXTRACTOR_URL (Render) — POST /extract
        └──► OpenAI, Resend (APIs cloud)
```

**No verificado:** existencia y despliegue actual de repos `cedula-mvp`, `pjn-local` en VPS, ni topología exacta en producción.

---

# 2. Supabase

## Proyectos Supabase usados

| Proyecto (lógico) | Variables | Uso |
|-------------------|-----------|-----|
| **Principal (gestor)** | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Auth, tablas operativas, Storage buckets principales |
| **PJN-scraper** (secundario) | `NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL`, `NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_ANON_KEY`; scripts también `PJN_SCRAPER_SERVICE_ROLE_KEY`, `PJN_SCRAPER_SUPABASE_URL` | Tablas `cases`, `case_snapshots`; origen sync favoritos |

Scripts permiten **fallback** al proyecto principal si faltan vars scraper (`scripts/sync-pjn-favoritos.mjs`, `scripts/migrate_cases_to_pjn_favoritos.mjs`) — riesgo de mezclar bases si están mal configuradas.

## Variables de entorno (Supabase)

| Variable | Criticidad |
|----------|------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Crítica |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Crítica |
| `SUPABASE_SERVICE_ROLE_KEY` | Crítica (secreto servidor) |
| `NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL` | Alta |
| `NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_ANON_KEY` | Alta |
| `PJN_SCRAPER_SERVICE_ROLE_KEY` | Alta (scripts) |
| `PJN_SCRAPER_SUPABASE_URL` | Media (alias legacy scripts) |
| `SUPABASE_URL` | Baja (alias legacy en `scripts/remove-duplicates-cases.mjs`) |

## Tablas (principal — detectadas en código y migraciones)

| Tabla | Origen definición | Uso transversal |
|-------|-------------------|-----------------|
| `profiles` | Implícito Auth + migraciones perfil | Usuarios, nombres |
| `user_roles` | `migrations/add_admin_cedulas.sql`, `create_mediaciones_module.sql`, etc. | Flags rol |
| `user_juzgados` | `migrations/add_abogado_role_and_juzgados.sql` | Segmentación abogados |
| `cedulas` | Core + `migrations/add_ocr_cedulas.sql`, `add_tipo_documento.sql`, … | Documentos, OCR, PJN |
| `expedientes` | `migrations/add_admin_expedientes.sql` | Expedientes estudio |
| `pjn_favoritos` | `migrations/create_pjn_favoritos_table.sql` | Réplica favoritos |
| `pjn_sync_metadata` | `migrations/create_pjn_sync_metadata_table.sql` | Estado última sync |
| `cedulas_tipo_documento_pdf_audit` | `migrations/create_cedulas_tipo_documento_pdf_audit.sql` | Auditoría contenido PDF |
| `cedulas_tipo_documento_audit` | `migrations/audit_reclasificar_tipo_documento_oficio.sql` | Reclasificación SQL histórica |
| `notifications` | `migrations/create_notifications_table.sql` | Notificaciones |
| `conversations`, `conversation_participants`, `messages` | `migrations/create_chat_system.sql` | Chat |
| `file_transfers`, `file_transfer_versions` | `migrations/create_file_transfers_tables.sql` | Transferencias |
| `mediaciones` + hijas | `migrations/create_mediaciones_module.sql` | Mediaciones |
| `mediacion_requirentes` | `migrations/add_mediacion_requirentes.sql` | Requirentes |
| `ordenes_medicas`, `gestiones_estudio`, `comunicaciones`, `ordenes_medicas_archivos` | `migrations/create_ordenes_medicas_tables.sql` | Órdenes médicas |
| `admin_digest_prefs` | **No verificado** migración en repo | UI `app/superadmin/config/page.tsx` (puede no existir en DB) |

## Tablas / vistas (proyecto scraper)

| Objeto | Archivos |
|--------|----------|
| `cases` | `app/api/pjn/sync-favoritos/route.ts`, `app/superadmin/removidos/page.tsx`, scripts sync |
| `case_snapshots` | `app/api/search-expediente-pjn/route.ts` |
| `scraper_errors` | `migrations/create_scraper_errors_table.sql` (doc indica ejecutar en **proyecto pjn-scraper**, `docs/troubleshooting/SCRAPER_ERRORS_SETUP.md`) |

## Vista referenciada sin migración en este repo

| Vista | Archivo |
|-------|---------|
| `pjn_favoritos_v` | `app/api/search-pjn-favoritos/route.ts` — **No verificado** definición SQL (probable VIEW en Supabase principal) |

## Storage buckets

| Bucket | Paths observados | Archivos |
|--------|------------------|----------|
| `cedulas` | `{user_id}/{cedula_id}.{ext}`, `acredita/{cedula_id}.pdf`, `reiteratorios/{cedula_id}.pdf` | `lib/cedula-procesar-ocr.ts`, `app/api/reiteratorios/[id]/presentar/route.ts`, README |
| `transfers` | `transfers/{transferId}/v{n}.docx` (y variantes) | `app/api/transfers/send/route.ts`, `migrations/create_transfers_bucket.sql` |
| `mediaciones` | paths en `mediacion_documentos.storage_path` | `app/api/mediaciones/generate-pdf/route.ts`, `migrations/create_mediaciones_module.sql` |
| `ordenes-medicas` | paths en `ordenes_medicas_archivos` | `app/api/ordenes-medicas/upload/route.ts` |

**Inconsistencia nombre bucket vs tabla:** API `app/api/transfers/sign-download/route.ts` consulta storage `transfers` y también tabla `transfers` (además de `file_transfers`) — revisar modelo real en DB.

## RPC y funciones PostgreSQL

| Función | Migración / uso |
|---------|-----------------|
| `is_superadmin` | Usada en UI (`app/cambiar-password/page.tsx`) — **definición SQL no encontrada** en grep de migraciones |
| `is_admin_cedulas` | `migrations/add_admin_cedulas.sql` |
| `is_admin_expedientes` | `migrations/add_admin_expedientes.sql` |
| `is_abogado` | `migrations/add_abogado_role_and_juzgados.sql` |
| `mark_notification_read` | `migrations/create_notifications_table.sql` |
| `get_thread_root` | `migrations/add_notifications_threading.sql` |
| `get_or_create_direct_conversation` | `migrations/create_chat_system.sql` |
| `mark_conversation_read` | `migrations/create_chat_system.sql` |
| `generate_mediacion_numero` | `migrations/create_mediaciones_module.sql` |
| `normalize_juzgado`, `parse_expediente`, `extract_observaciones` | `migrations/migrate_cases_to_pjn_favoritos.sql`, `normalize_pjn_favoritos_juzgado.sql` |
| `get_transfer_id_from_path` | `migrations/create_transfers_bucket.sql` |
| `check_max_archivos_per_orden` | `migrations/add_ordenes_medicas_archivos_table.sql` |
| Triggers `update_*_updated_at` | Varias migraciones órdenes, transfers, pjn_sync |

**No detectado:** Supabase Edge Functions en este repositorio.

## Policies RLS (mencionadas en migraciones)

Ejemplos documentados en SQL:

- `cedulas`: SuperAdmin view/update (`migrations/add_superadmin_cedulas_rls.sql`, `fix_superadmin_view_all_data.sql`)
- `expedientes`: SuperAdmin, admin expedientes, abogado (`migrations/add_admin_expedientes.sql`, `fix_abogado_expedientes_rls.sql`)
- `pjn_favoritos`: authenticated view/update notas (`migrations/create_pjn_favoritos_table.sql`, `add_notas_to_expedientes.sql`)
- `file_transfers` / `file_transfer_versions`: por participante (`migrations/create_file_transfers_tables.sql`)
- `storage.objects` bucket `transfers`: read/upload/update/delete (`migrations/create_transfers_bucket.sql`)
- `ordenes_medicas`, `gestiones_estudio`, `comunicaciones`: por rol y ownership (`migrations/create_ordenes_medicas_tables.sql`)
- `mediaciones` y tablas hijas (`migrations/create_mediaciones_module.sql`)
- Chat: `conversations`, `messages` (`migrations/create_chat_system.sql`)

Muchas rutas API usan `SUPABASE_SERVICE_ROLE_KEY` y **bypassean RLS** (`lib/supabase-server.ts`).

## Scripts SQL en repo

- **64 archivos** en `migrations/` (aplicación manual según `README.md`).
- Scripts operativos: `scripts/verify-expedientes-counts.sql`, `scripts/diagnostico-andrea-ordenes.sql`, `scripts/supabase/pjn_favoritos.sql`, `migrations/preview_reclasificar_cedula_a_oficio.sql`.

## Queries / accesos transversales relevantes

| Flujo | Tablas |
|-------|--------|
| Sync favoritos | `cases` (scraper) → upsert/delete `pjn_favoritos` + `pjn_sync_metadata` | `app/api/pjn/sync-favoritos/route.ts` |
| Diligenciamiento lista | `cedulas` filtro `estado_ocr=listo` | `app/api/diligenciamiento/route.ts` |
| Búsqueda favoritos UI | `pjn_favoritos` o `pjn_favoritos_v` | `app/api/search-pjn-favoritos/route.ts` |
| Auditoría PDF list | join `cedulas_tipo_documento_pdf_audit` → `cedulas` | `app/api/admin/auditoria-tipo-documento-pdf/list/route.ts` |

## Posibles bases duplicadas / inconsistencias

| Tema | Evidencia |
|------|-----------|
| Misma instancia Supabase para scraper y app | Fallback en scripts si falta URL scraper |
| `cases` vs `pjn_favoritos` | Dos fuentes de verdad; sync cron intenta alinearlas |
| `pjn_favoritos` vs `pjn_favoritos_v` | Vista usada en búsqueda; tabla en sync — **No verificado** equivalencia |
| Columna legacy `tipo` | Comentario explícito: no existe (`lib/auditoria-tipo-documento-pdf.ts`, `lib/pjn-payload.ts`) |
| Tabla `transfers` vs `file_transfers` | Coexisten en `app/api/transfers/sign-download/route.ts` |

---

# 3. VPS / pjn-local

## Menciones a VPS en el código

| Archivo | Contenido |
|---------|-----------|
| `lib/pjn-payload.ts` | Comentario: “POST /cargar-pjn (VPS pjn-local)”; `pjnLocalBaseUrl()` solo `PJN_LOCAL_URL` |
| `app/api/reiteratorios/[id]/presentar/route.ts` | Reiteratorio: generación PDF en Railway, **carga PJN solo vía `pjnLocalBaseUrl()`** (VPS) |
| `lib/cedula-procesar-ocr.ts` | Tras OCR, `pjnVpsBaseUrl()` puede incluir `PJN_LOCAL_URL` **o** Railway |

## Variables

| Variable | Uso |
|----------|-----|
| `PJN_LOCAL_URL` | Base URL servicio Playwright local/VPS (sin sufijo `/cargar-pjn`; normalización en `lib/pjn-payload.ts`) |

## URLs y dominios documentados en repo

| URL / dominio | Contexto |
|---------------|----------|
| `https://gestor-cedulas.vercel.app` | Producción README; Tampermonkey `@connect` |
| `https://cedula-mvp-production.up.railway.app` | Default en `test-cargar-pjn.ps1` (health + cargar-pjn) |
| `https://gestor-pdf.onrender.com` | Ejemplo `docs/deployment/CONFIGURAR_VERCEL_PDF_EXTRACTOR.md` |
| `https://sso.pjn.gov.ar`, `portalpjn.pjn.gov.ar`, `scw.pjn.gov.ar` | PJN (`app/api/pjn-login/route.ts`, scripts) |

## Rutas `/opt/pjn-local`, PM2, Cloudflare Tunnel, SSH

**No detectado** en archivos del proyecto (excl. `node_modules`). Cualquier despliegue VPS con PM2/tunnel **No verificado** — solo inferible por nombre `PJN_LOCAL_URL` y comentarios “VPS pjn-local”.

## Endpoints esperados en VPS (mismo contrato que Railway)

| Método | Ruta | Payload diligenciamiento | Payload reiteratorio |
|--------|------|--------------------------|----------------------|
| POST | `/cargar-pjn` | JSON `PjnCargarPayload` (`pdfUrl`, `cedulaId`, `expNro`, …) | Mismo (`app/api/reiteratorios/[id]/presentar/route.ts`) |

Microservicio empaquetado `railway-service/cargar-pjn/server.mjs` también acepta **multipart** `pdf` + `expNro` (flujo alternativo no usado por rutas Next actuales de diligenciamiento).

## Diferencias VPS vs Railway (según código)

| Aspecto | VPS (`PJN_LOCAL_URL`) | Railway (`RAILWAY_CARGAR_PJN_URL` / `RAILWAY_OCR_URL`) |
|---------|----------------------|--------------------------------------------------------|
| Reiteratorios presentación | **Obligatorio** (`pjnLocalBaseUrl`) | No usado en ese paso |
| Diligenciamiento manual | Opcional vía `pjnVpsBaseUrl()` | Misma prioridad si `PJN_LOCAL_URL` vacío |
| OCR + PDF acredita | `RAILWAY_OCR_URL` exclusivo | Servicio separado (típicamente `cedula-mvp`) |
| Generación PDF reiteratorio | Railway `/procesar-reiteratorio` | No en VPS según flujo actual |
| Credenciales Playwright | Env en host (`PJN_USUARIO`/`PJN_PASSWORD` en `railway-service`) | Idem si mismo binario |

---

# 4. Railway / OCR

## Servicios Express en este repo

| Servicio | Package name | Puerto | Rutas |
|----------|--------------|--------|-------|
| `railway-service/cargar-pjn` | `cedula-pjn-cargar` (`railway-service/cargar-pjn/package.json`) | `PORT` (default 3000) | `GET /`, `GET /cargar-pjn`, `POST /cargar-pjn` |
| `pdf-extractor-service` | (ver su `package.json`) | `PORT` | `POST /extract`, `GET /health` |

## Endpoints OCR consumidos (servicio externo — no implementados aquí)

Documentados por **llamadas fetch** desde este repo:

| Endpoint | Método | Body | Respuesta esperada | Archivos |
|----------|--------|------|-------------------|----------|
| `/procesar` | POST | multipart `pdf` (cédula) | PDF binario + headers `X-Exp-Nro`, `X-Caratula`, … | `lib/cedula-procesar-ocr.ts`, `app/api/detect-type-upload/route.ts` |
| `/procesar-oficio` | POST | multipart `pdf` | Idem + `X-Destinatario` | Idem |
| `/procesar-reiteratorio` | POST | JSON `{ expNro, caratula, destinatario }` | PDF bytes | `app/api/reiteratorios/[id]/presentar/route.ts` |
| `/health` | GET | — | status ok | `test-cargar-pjn.ps1` |

Referencia explícita a otro proyecto: **`cedula-mvp`** (`lib/auditoria-tipo-documento-pdf.ts`, `test-cargar-pjn.ps1` URL `cedula-mvp-production.up.railway.app`).

## Variables Railway / OCR

| Variable | Función |
|----------|---------|
| `RAILWAY_OCR_URL` | Base OCR + fallback cargar-pjn |
| `RAILWAY_CARGAR_PJN_URL` | Prioridad para POST `/cargar-pjn` |
| `RAILWAY_INTERNAL_SECRET` | Header `X-Internal-Secret` |
| `PORT` | Microservicio cargar-pjn |
| `PJN_USUARIO`, `PJN_PASSWORD`, `PJN_USER`, `PJN_PASS` | Login portal |
| `PJN_JURISDICCION` | Desplegable jurisdicción |
| `PJN_UPLOAD_DRY_RUN`, `PJN_HEADFUL`, `PJN_SKIP_FINAL_SEND`, … | Debug / pruebas (`docs/PJN_CARGAR_CONTEXTO.md`) |

## Dockerfile

| Servicio | Archivo |
|----------|---------|
| PDF extractor | `pdf-extractor-service/Dockerfile` — Poppler + Tesseract |
| cargar-pjn | **No verificado** Dockerfile en subcarpeta (Playwright install vía `postinstall`) |

## Workers / procesamiento en background

| Worker | Dónde | Disparo |
|--------|-------|---------|
| `procesarOcrEnBackground` | `lib/cedula-procesar-ocr.ts` | `POST /api/cedulas/[id]/procesar-ocr` (fire-and-forget en route) |
| Playwright cargar-pjn | Railway/VPS proceso largo | API diligenciamiento / OCR auto-carga |
| Sync favoritos | `app/api/pjn/sync-favoritos/route.ts` | Vercel cron |

## OpenAI Vision

| Uso | Archivo |
|-----|---------|
| Detección tipo al upload | `app/api/detect-type-upload/route.ts`, `lib/gpt-vision-tipo-documento.ts` |
| Auditoría PDF | `lib/auditoria-tipo-documento-pdf.ts` (`createGptVisionClient`, `OPENAI_API_KEY`, `AUDIT_OPENAI_MODEL`) |

## Tesseract / Poppler / LibreOffice

| Tecnología | Dónde |
|------------|-------|
| Poppler (`pdftotext`) | `pdf-extractor-service/server.js` |
| Tesseract (`spa`) | Idem |
| LibreOffice | **No detectado** en este repo |
| `pdf-parse`, `mammoth` | Next.js app (`package.json`) — extracción en servidor Vercel, no Railway OCR |

## OCR real vs OCR documentado — diferencias

| Capa | Qué hace | Limitación documentada |
|------|----------|------------------------|
| **Railway OCR** (`cedula-mvp`) | Genera PDF “acredita”, metadatos en headers, destinatario oficio | Implementación **fuera del repo** |
| **pdf-extractor-service** | Texto plano carátula/juzgado (autorrelleno legacy) | No genera acredita; cold start Render |
| **OpenAI Vision** | Clasificación CEDULA/OFICIO, auditoría | Costo/latencia; requiere `OPENAI_API_KEY` |
| **Heurísticas locales** | Regex scoring en `lib/auditoria-tipo-documento-pdf.ts` | Sin llamar `/procesar` en flujo auditoría (comentario explícito) |

---

# 5. PJN

## Credenciales PJN

| Fuente | Variables / riesgo |
|--------|-------------------|
| Railway uploader | `PJN_USUARIO`, `PJN_PASSWORD` (`railway-service/cargar-pjn/pjn_uploader.js`) |
| Scripts / API Vercel | `PJN_USER`, `PJN_PASS` (`scripts/pjn-scraper.ts`, `app/api/pjn-update-cookies/route.ts`) |
| **Riesgo crítico** | Defaults hardcodeados en `app/api/pjn-update-cookies/route.ts` si faltan env |
| Cookies estáticas | `lib/pjn-cookies.ts` — array `COOKIES` embebido (fragilidad por expiración) |

## Playwright / Puppeteer

| Herramienta | Ubicación |
|-------------|-----------|
| Playwright | `railway-service/cargar-pjn/`, dependencia raíz `package.json` |
| Puppeteer | `app/api/pjn-login/route.ts`, `app/api/pjn-update-cookies/route.ts`, `app/api/fetch-expediente-pjn/route.ts` |

## Endpoints de carga y APIs PJN (este repo)

| Endpoint Next | Función |
|---------------|---------|
| `POST /api/cedulas/[id]/cargar-pjn` | Diligenciamiento → JSON a `{base}/cargar-pjn` |
| `POST /api/cedulas/[id]/confirmar-pjn` | Confirmación previa (**No re-leído** detalle en esta auditoría) |
| `POST /api/cedulas/[id]/procesar-ocr` | Dispara OCR Railway |
| `POST /api/reiteratorios/[id]/presentar` | Reiteratorio completo |
| `POST /api/pjn/sync-favoritos` | Sync `cases` → `pjn_favoritos` |
| `POST /api/pjn-login` | Login SSO Puppeteer |
| `POST /api/pjn-update-cookies` | Actualiza `lib/pjn-cookies.ts` |
| `POST /api/search-expediente-pjn` | Busca en scraper DB |
| `POST /api/fetch-expediente-pjn` | Scraping favoritos Puppeteer |
| `POST /api/pjn/get-movimientos` | Movimientos desde `cases` |

## Scraping, favoritos, movimientos

| Mecanismo | Archivo |
|-----------|---------|
| Scraper Python externo | `docs/troubleshooting/SCRAPER_ERRORS_SETUP.md` → `pjn-scraper` |
| Sync API + cron | `app/api/pjn/sync-favoritos/route.ts`, `vercel.json` |
| Script manual | `scripts/sync-pjn-favoritos.mjs`, `npm run sync:pjn-favoritos` |
| Tampermonkey | `scripts/tampermonkey/pjn-sync.user.js` — **apunta a `/api/pjn/sync`** (ver inconsistencias §10) |
| CLI expediente | `npm run pjn:login`, `pjn:check` → `scripts/pjn-scraper.ts` |

## Confirmación de cargas

- Columna `pjn_cargado_at` (`migrations/add_pjn_cargado_at_cedulas.sql`).
- UI diligenciamiento: `app/diligenciamiento/page.tsx`, API `app/api/diligenciamiento/route.ts`.
- Fallos en `observaciones_pjn` (`lib/cedula-procesar-ocr.ts`, `app/api/cedulas/[id]/cargar-pjn/route.ts`).

## Fragilidad / riesgos PJN

| Riesgo | Evidencia |
|--------|-----------|
| UI portal cambia | Selectores Playwright en `pjn_uploader.js` — sin abstracción versionada |
| Cookies hardcodeadas | `lib/pjn-cookies.ts` |
| Puppeteer en serverless Vercel | Timeouts 60s en rutas login/fetch |
| Mezcla hosts OCR vs cargar-pjn | Errores `Cannot POST /cargar-pjn` documentados en `docs/PJN_CARGAR_CONTEXTO.md` |
| SSO / captcha | Dominios `captcha.pjn.gov.ar` en cookies |

---

# 6. Certificados / generación documental

> El término **“certificado”** no aparece en código SQL/TS del repo (**grep sin resultados**). El equivalente operativo es el PDF **“Acredita Diligenciamiento”** y documentos de mediaciones/reiteratorios.

## Generación de PDF

| Flujo | Tecnología | Archivo |
|-------|------------|---------|
| Dashboard reporte | jsPDF | `app/superadmin/page.tsx` (referencia README) |
| Mediación carta/documento | jsPDF | `app/api/mediaciones/generate-pdf/route.ts`, `generate-doc/route.ts` |
| Reiteratorio | Railway genera; Next sube a Storage | `app/api/reiteratorios/[id]/presentar/route.ts` |
| OCR acredita | Railway devuelve PDF binario | `lib/cedula-procesar-ocr.ts` → `acredita/{id}.pdf` |

## DOCX

| Uso | Archivo |
|-----|---------|
| Alta cédula | `mammoth` — `app/api/extract-caratula/route.ts`, `extract-juzgado/route.ts` |
| Transferencias / notificaciones | `.docx` en bucket `transfers` | `app/api/transfers/send/route.ts`, `notifications/reply/route.ts` |

## Imágenes

- Transferencias aceptan `.png`, `.jpg`, `.jpeg` (`app/app/enviar/page.tsx`).

## Storage paths “acredita” / reiteratorios / oficios

| Path pattern | Tipo doc | Archivo |
|--------------|----------|---------|
| `acredita/{cedulaId}.pdf` | Post-OCR diligenciamiento | `lib/cedula-procesar-ocr.ts` |
| `reiteratorios/{cedulaId}.pdf` | Reiteratorio generado | `app/api/reiteratorios/[id]/presentar/route.ts` |
| `{userId}/{cedulaId}.pdf` | Original carga | README, `app/app/nueva/page.tsx` |

## Templates

- Mediaciones: `tipo_plantilla` en `mediacion_documentos` — generación en `app/api/mediaciones/[id]/generate-doc/route.ts` (**plantillas en código jsPDF**, no archivos `.docx` externos detectados).

## Descripciones PJN al cargar

| `tipo_documento` | Descripción enviada a PJN |
|------------------|----------------------------|
| `CEDULA` | `"Acredita Diligenciamiento Cedula"` |
| `OFICIO` | `"Acredita Diligenciamiento Oficio"` |
| Reiteratorio | `"Solicita Oficio Reiteratorio"` | `lib/pjn-payload.ts`, `presentar/route.ts` |

---

# 7. Auditoría PDF / clasificación documental

## Módulos y tablas

| Artefacto | Propósito |
|-----------|-----------|
| `cedulas_tipo_documento_pdf_audit` | Registro análisis PDF vs `cedulas.tipo_documento` |
| `cedulas_tipo_documento_audit` | Lote reclasificación histórica SQL |
| `lib/auditoria-tipo-documento-pdf.ts` | Motor clasificación (~2131 líneas) |
| `lib/ocr-oficio-historico.ts` | Re-OCR oficios históricos (destinatario) |

## Endpoints administración

| Ruta API | Función |
|----------|---------|
| `GET/POST .../auditoria-tipo-documento-pdf/list` | Listado |
| `POST .../preview` | Vista previa reglas |
| `POST .../run` | Ejecución batch (OpenAI opcional) |
| `POST .../apply` | Aplica cambios a `cedulas.tipo_documento` |
| `POST .../review` | Revisión manual estados |
| `POST .../auto-confirm` | Auto-confirmación |
| `POST .../manual-classification` | Clasificación manual |
| `GET .../[id]/pdf` | PDF auditoría |
| `GET .../cedula/[cedula_id]` | Detalle por cédula |
| `POST .../ocr-oficio-historico/preview` | Preview lote OCR histórico |
| `POST .../ocr-oficio-historico/run` | Ejecución (máx. 5, default 3) |
| `POST .../cedulas/[id]/corregir-tipo-documento` | Corrección puntual |
| UI | `app/admin/auditoria-tipo-documento/page.tsx` |

## OCR histórico oficios

Universo (`lib/ocr-oficio-historico.ts`): audit aplicado + `tipo_documento=OFICIO` + `estado_ocr=listo` + `pjn_cargado_at` + `ocr_destinatario` vacío.  
Validación destinatario: `isValidDestinatarioOCR` (longitud, frases prohibidas).

## Clasificación cédula/oficio al upload

`POST /api/detect-type-upload` → GPT Vision o Railway dual `/procesar` + `/procesar-oficio` → `lib/detect-type-upload-classify.ts`.

## Reglas score / confianza

- Patrones con `peso` y `clasificacion` (`lib/auditoria-tipo-documento-pdf.ts`, constantes `PDF_AUDIT_*`).
- `confianza` normalizada ~ peso acumulado / cota empírica (comentarios líneas ~201–223 del mismo archivo).
- GPT devuelve JSON con `clasificacion`, `confianza`, `razones`, campos contexto (`GptVisionRespuesta`).

## Estados revisión (migraciones recientes)

`revision_estado`: `CONFIRMADO`, `RECHAZADO`, `DUDA`, `VALIDADO_SIN_CAMBIOS` (`migrations/add_cedulas_tipo_documento_pdf_audit_apply_estado.sql`).  
`apply_estado`: `APLICADO`, `SIN_CAMBIOS`, `RECHAZADO`, `ERROR`.

Documentación cruzada: `docs/auditoria-tipo-documento-reiteratorios.md`.

---

# 8. Scripts manuales y tareas operativas

## Scripts en `package.json`

| Script | Comando real | Propósito |
|--------|--------------|-----------|
| `dev` | `next dev` | Desarrollo |
| `build` / `start` | Next producción | Deploy Vercel |
| `lint` | `eslint` | Calidad |
| `pjn:login` | `tsx scripts/pjn-scraper.ts login` | Sesión PJN local |
| `pjn:check` | `tsx scripts/pjn-scraper.ts check` | Consulta expediente CLI |
| `sync:pjn-favoritos` | `node scripts/sync-pjn-favoritos.mjs` | Sync manual favoritos |
| `remove:duplicates-cases` | `node scripts/remove-duplicates-cases.mjs` | Limpieza scraper DB |
| `verify:favoritos` | `node scripts/verify-favoritos-discrepancy.mjs` | Diagnóstico |
| `analyze:scraper` | `node scripts/analyze-scraper-completeness.mjs` | Cobertura scraper |
| `view:scraper-errors` | `node scripts/view-scraper-errors.mjs` | Errores `scraper_errors` |

## Scripts adicionales (carpeta `scripts/`, sin npm script)

Ejemplos: `create_users.mjs`, `change_password.mjs`, `clear_storage_for_client.mjs`, `migrate_cases_to_pjn_favoritos.mjs`, `test-auditoria-tipo-documento.ts`, `deploy_pdf_extractor.ps1`, `update_pdf_extractor_url.ps1`, `tampermonkey/pjn-sync.user.js`, `verify-pjn-payload.ts`.

## Python / Bash

| Tipo | Referencia |
|------|------------|
| Python scraper | `docs/troubleshooting/SCRAPER_ERRORS_SETUP.md` — `pw_mirror_favorites_to_supabase_with_retry.py` en repo **`pjn-scraper`** (ruta `c:\proyectos\pjn-scraper`) |
| Bash | **No detectado** scripts `.sh` propios en raíz |

## Cron jobs

| Cron | Schedule | Archivo config |
|------|----------|----------------|
| `GET/POST /api/pjn/sync-favoritos` | `0 0 * * *` (medianoche UTC) | `vercel.json` |

Documentación: `docs/migrations/SYNC_PJN_FAVORITOS.md`, `docs/troubleshooting/CRON_VERIFICATION.md`.

## GitHub Actions

**No detectado** `.github/workflows` en la raíz del repositorio (solo en dependencias `node_modules`). Deploy documentado vía **push → Vercel** (`README.md`).

## Tareas con intervención humana hoy

| Tarea | Por qué |
|-------|---------|
| Ejecutar migraciones SQL | Manual Supabase SQL Editor (`README.md`) |
| Configurar env en Vercel/Railway/Render/VPS | Multi-host |
| Auditoría PDF apply/review | Superadmin (`app/admin/auditoria-tipo-documento/page.tsx`) |
| Reiteratorios presentar | Superadmin + datos OCR completos |
| Sync favoritos fallback | `node scripts/sync-pjn-favoritos.mjs` si cron falla |
| Deploy pdf-extractor | `scripts/deploy_pdf_extractor.ps1` + Render dashboard |
| Prueba cargar-pjn | `test-cargar-pjn.ps1` con token manual |
| Scraper favoritos | Repo `pjn-scraper` separado |
| Rotación cookies PJN | `pjn-update-cookies` o login manual |

---

# 9. Mapa de dependencias externas

| Servicio | Variable/URL | Archivo | Función | Criticidad | Observaciones |
|----------|--------------|---------|---------|------------|---------------|
| Supabase principal | `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY` | `lib/supabase.ts`, `lib/supabase-server.ts` | DB, Auth, Storage | Crítica | RLS bypass en APIs admin |
| Supabase pjn-scraper | `NEXT_PUBLIC_PJN_SCRAPER_*` | `lib/pjn-scraper-supabase.ts`, sync route | `cases`, snapshots | Alta | Puede colapsar con principal en scripts |
| Vercel | (deploy implícito) | `vercel.json` | Hosting + cron | Crítica | `maxDuration` 300s OCR/cargar-pjn |
| Railway OCR (cedula-mvp) | `RAILWAY_OCR_URL` | `lib/cedula-procesar-ocr.ts` | `/procesar`, `/procesar-oficio`, `/procesar-reiteratorio` | Crítica | **Código fuera del repo** |
| Railway/VPS cargar-pjn | `RAILWAY_CARGAR_PJN_URL`, `PJN_LOCAL_URL`, `RAILWAY_OCR_URL` | `lib/pjn-payload.ts`, `cargar-pjn/route.ts` | Playwright subida PJN | Crítica | Subcarpeta `railway-service/cargar-pjn` |
| Render PDF extractor | `PDF_EXTRACTOR_URL` | `app/api/extract-pdf/route.ts` | Texto carátula/juzgado | Alta | `pdf-extractor-service/` |
| OpenAI | `OPENAI_API_KEY`, `AUDIT_OPENAI_MODEL` | `lib/auditoria-tipo-documento-pdf.ts`, `detect-type-upload` | Vision clasificación | Alta | Solo servidor |
| Resend | `RESEND_API_KEY`, `RESEND_FROM` | `app/api/mediaciones/lotes/send/route.ts` | Email lotes | Media | Opcional si no hay key |
| PJN portales | — | Puppeteer/Playwright routes | SSO, favoritos, carga | Crítica | Fragilidad UI |
| Repo pjn-scraper | — | `docs/troubleshooting/SCRAPER_ERRORS_SETUP.md` | Alimenta `cases` | Alta | Path local documentado |
| Tampermonkey | `GESTOR_CEDULAS_SYNC_TOKEN` / `SYNC_TOKEN` (doc) | `scripts/tampermonkey/pjn-sync.user.js` | Sync desde browser PJN | Media | URL endpoint posiblemente obsoleta |
| GitHub | — | README | CI trigger Vercel | Media | Sin Actions en repo |
| Anthropic / Cloudflare | — | — | — | — | **No detectado** |

---

# 10. Duplicaciones o inconsistencias

| Tema | Evidencia |
|------|-----------|
| **Dos servicios Railway** | Mismo nombre `RAILWAY_OCR_URL` usado para OCR y como fallback de `cargar-pjn`; `RAILWAY_CARGAR_PJN_URL` para separar (`docs/PJN_CARGAR_CONTEXTO.md`) |
| **VPS vs Railway reiteratorio** | Solo `PJN_LOCAL_URL` en `presentar/route.ts`; diligenciamiento usa `pjnVpsBaseUrl()` (incluye Railway) |
| **Variables PJN_USER vs PJN_USUARIO** | Scripts vs `railway-service/cargar-pjn` |
| **Sync token naming** | Tampermonkey pide `SYNC_TOKEN`; API usa `PJN_SYNC_SECRET` (`app/api/pjn/sync-favoritos/route.ts`) |
| **Endpoint sync Tampermonkey** | Script: `.../api/pjn/sync` — repo solo tiene `app/api/pjn/sync-favoritos` |
| **Credenciales en código** | `app/api/pjn-update-cookies/route.ts` fallbacks; `lib/pjn-cookies.ts` cookies fijas |
| **Doble clasificación tipo doc** | GPT Vision + Railway + heurísticas + auditoría PDF + SQL audit histórico |
| **PDF extractor vs Railway OCR** | Ambos “leen” PDF con fines distintos (texto vs acredita PDF) |
| **Puppeteer duplicado** | Vercel (login/fetch) + Railway/VPS (carga) |
| **Documentación vs código** | README incompleto respecto a mediaciones/órdenes/auditoría (`gestor-cedulas-plataforma-context.md`) |
| **Tabla `transfers` vs `file_transfers`** | `app/api/transfers/sign-download/route.ts` |
| **Proyecto npm `cedula-pjn-cargar`** vs app `gestor-cedulas` | `railway-service/cargar-pjn/package.json` — naming ecosistema `cedula-mvp` |

---

# 11. Riesgos para refactorización

## Crítico

| Riesgo | Evidencia | Impacto |
|--------|-----------|---------|
| Secreto PJN por defecto en API | `app/api/pjn-update-cookies/route.ts` | Compromiso cuenta judicial |
| Cookies PJN embebidas | `lib/pjn-cookies.ts` | Sesión inválida / seguridad |
| Service role en muchas APIs | `lib/supabase-server.ts`, rutas `app/api/admin/*` | Bypass RLS total |
| Dependencia OCR sin contrato en repo | Solo URLs `RAILWAY_OCR_URL` | Imposible versionar cambios breaking |
| Tampermonkey → endpoint inexistente | `scripts/tampermonkey/pjn-sync.user.js` L25 vs `app/api/pjn/` | Sync manual roto |

## Alto

| Riesgo | Evidencia | Impacto |
|--------|-----------|---------|
| Confusión VPS/Railway en producción | `pjnLocalBaseUrl` vs `pjnVpsBaseUrl` | Reiteratorios fallan si solo hay Railway |
| Cron sync sin secret opcional | `PJN_SYNC_SECRET` opcional en sync route | Endpoint público |
| Dos bases Supabase con fallback | `scripts/sync-pjn-favoritos.mjs` | Datos en proyecto equivocado |
| Playwright en Vercel 60s | `app/api/pjn-login/route.ts` `maxDuration = 60` | Timeouts |
| `node_modules` en `railway-service/cargar-pjn` | Commiteado en árbol repo | Supply chain / peso |

## Medio

| Riesgo | Evidencia | Impacto |
|--------|-----------|---------|
| Migraciones manuales | `README.md`, 64 archivos `migrations/` | Drift entornos |
| Vista `pjn_favoritos_v` sin migración local | `search-pjn-favoritos/route.ts` | Deploy incompleto |
| `admin_digest_prefs` sin migración | `app/superadmin/config/page.tsx` | Feature muerta |
| Headers OCR no estándar | `X-Exp-Nro`, `X-Caratula` en `cedula-procesar-ocr.ts` | Acoplamiento fuerte a cedula-mvp |
| PDF público acredita | `getPublicUrl` en `lib/cedula-procesar-ocr.ts` | Exposición si bucket mal configurado |

## Bajo

| Riesgo | Evidencia | Impacto |
|--------|-----------|---------|
| Render free tier sleep | `pdf-extractor-service/README.md` | Latencia primer request |
| Naming `cedula-mvp` vs `gestor-cedulas` | Varios archivos | Confusión onboarding |
| Sin `.env.example` | Ausencia en repo | Config incompleta |

---

# 12. Recomendación de consolidación

## Quedarse en este repo (`gestor-cedulas`)

- App Next + BFF + UI todos los módulos de negocio.
- Orquestación sync favoritos (cron) y APIs de auditoría/reiteratorios.
- Clientes Supabase y contratos de payload (`lib/pjn-payload.ts`).
- Documentación operativa `docs/PJN_CARGAR_CONTEXTO.md`, migraciones como historial.

## Migrar a otro worker / servicio dedicado

| Componente | Destino sugerido | Motivo |
|------------|------------------|--------|
| OCR `/procesar*` | Repo **`cedula-mvp`** (o worker Railway único) | Ya referenciado; no está aquí |
| Playwright cargar-pjn | VPS `pjn-local` **o** Railway `cedula-pjn-cargar` | Proceso largo; un solo host por entorno |
| Puppeteer login/fetch | VPS o eliminar de Vercel | No apto serverless |
| Scraper favoritos | Mantener **`pjn-scraper`** | Ya separado |
| Auditoría PDF batch masiva | Cola + worker (Railway/Supabase pg_cron) | Evitar timeout Vercel |

## Convertir en paquete compartido

- `lib/pjn-payload.ts`, `lib/detect-type-upload-classify.ts`, tipos OCR headers.
- Normalización juzgado/expediente (hoy duplicada en sync route y migraciones).

## Eliminar o deprecar (tras validar prod)

- Cookies hardcodeadas → solo storage dinámico post-login.
- Rutas Puppeteer en Vercel si VPS asume todo PJN.
- Tampermonkey si cron + scraper cubren sync (o corregir URL a `sync-favoritos`).
- `pdf-extractor` si Railway/GPT cubren 100% autorrelleno (**No verificado** cobertura).

## Documentar mejor

- Matriz única env (un nombre por credencial PJN).
- Diagrama hosts: OCR URL vs CARGAR_PJN_URL vs PJN_LOCAL_URL.
- Contrato OpenAPI para `/procesar`, `/cargar-pjn`.
- Aclarar `SYNC_TOKEN` vs `PJN_SYNC_SECRET` y endpoint Tampermonkey.

## Pasar a cola/job

- `auditoria-tipo-documento-pdf/run` batch.
- `ocr-oficio-historico/run`.
- `procesar-ocr` masivo desde lista cédulas.

## Pasar a Supabase Function

- `mark_notification_read` ya RPC — candidato para lógica liviana.
- Sync favoritos podría ser Edge Function + cron Supabase (**alternativa** a Vercel cron) — no implementado.

## Railway vs VPS (recomendación lógica detectada en código)

| Flujo | Recomendación alineada al código actual |
|-------|----------------------------------------|
| Reiteratorios | **VPS** (`PJN_LOCAL_URL`) — obligatorio hoy |
| Diligenciamiento | **Un host** con `RAILWAY_CARGAR_PJN_URL`; evitar mezclar con OCR |
| OCR | **Railway cedula-mvp** dedicado |

---

# 13. Preguntas abiertas

1. ¿URL y repositorio exactos de producción para `RAILWAY_OCR_URL` y `RAILWAY_CARGAR_PJN_URL`?
2. ¿`PJN_LOCAL_URL` apunta a VPS con el mismo `server.mjs` que `railway-service/cargar-pjn` o a otro binario?
3. ¿Existe despliegue PM2/Cloudflare Tunnel documentado fuera del repo?
4. ¿`pjn_favoritos_v` está definida en Supabase principal y con qué SQL?
5. ¿Tampermonkey sigue en uso y cuál es el token/endpoint correcto?
6. ¿Proyecto scraper es siempre instancia Supabase distinta de la principal en prod?
7. ¿Bucket `cedulas` es público para `pdf_acredita_url` o debería ser privado con signed URLs?
8. ¿Render `gestor-pdf.onrender.com` sigue siendo el `PDF_EXTRACTOR_URL` activo?
9. ¿Hay UI de chat desplegada o solo esquema DB?
10. ¿Repositorios adicionales (`cedula-mvp`, `pjn-local`, certificados) existen en la org y no están referenciados salvo por URL?

---

## Referencias rápidas en este repositorio

| Documento / archivo | Tema transversal |
|-------------------|------------------|
| `docs/PJN_CARGAR_CONTEXTO.md` | Carga PJN Railway/VPS |
| `docs/migrations/SYNC_PJN_FAVORITOS.md` | Cron y sync |
| `docs/troubleshooting/SCRAPER_ERRORS_SETUP.md` | Repo `pjn-scraper` |
| `docs/auditoria-tipo-documento-reiteratorios.md` | Auditoría ↔ reiteratorios |
| `vercel.json` | Cron + timeouts |
| `lib/pjn-payload.ts` | Contrato POST `/cargar-pjn` |
| `test-cargar-pjn.ps1` | Prueba integración diligenciamiento |
| `gestor-cedulas-plataforma-context.md` | Auditoría general previa |

---

*Fin — `GESTOR-CEDULAS-transversal-context.md`*
