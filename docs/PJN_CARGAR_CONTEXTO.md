# Contexto: automatización «Cargar en PJN»

Documento para handoff (otra IA, equipo o futuro mantenimiento). Proyecto: **gestor-cedulas**.

---

## 1. Objetivo de negocio

En la sección **Diligenciamiento**, cada cédula lista tiene un botón **«Cargar en PJN»**. El sistema debe subir el PDF de acreditación al **Portal PJN** (`portalpjn.pjn.gov.ar`), usando datos de expediente (`ocr_exp_nro`, etc.) ya extraídos por OCR.

Las credenciales PJN son del **estudio** (variables de entorno en Railway), nunca en código.

---

## 2. Arquitectura

```
Usuario → Next.js (Vercel) → POST /api/cedulas/[id]/cargar-pjn
         → Descarga PDF desde Supabase Storage (bucket cedulas, path acredita/{id}.pdf)
         → POST multipart a Railway: {base}/cargar-pjn
         → Microservicio Node (Express) ejecuta Playwright (Chromium)
         → Automatización en portal PJN (login SSO, flujo de escritos, adjunto PDF)
         → Respuesta { ok: true } o error
         → Vercel actualiza columna pjn_cargado_at en tabla cedulas (si envío real)
```

**Por qué Playwright no corre en Vercel:** los límites de serverless y ausencia de navegador estable para automatización prolongada. Por eso el trabajo pesado vive en **Railway**.

**Rutas relevantes en el repo**

| Ubicación | Rol |
|-----------|-----|
| `app/api/cedulas/[id]/cargar-pjn/route.ts` | API Next: auth, permisos, descarga PDF, fetch a Railway, actualización DB |
| `app/diligenciamiento/page.tsx` | UI: botón, modal, spinner, mensajes éxito/error |
| `railway-service/cargar-pjn/server.mjs` | Express: `POST /cargar-pjn`, `GET /cargar-pjn` (health) |
| `railway-service/cargar-pjn/pjn_uploader.js` | Playwright: flujo portal (login, popup escritos, expediente, adjunto, opcionalmente Enviar) |
| `railway-service/cargar-pjn/lib/pjn-upload.mjs` | Wrapper: `PJN_UPLOAD_DRY_RUN`, llama a `cargarEnPJN` |

---

## 3. Variables de entorno

### Vercel / `.env.local` (Next)

| Variable | Uso |
|----------|-----|
| `RAILWAY_CARGAR_PJN_URL` | **Prioridad** sobre `RAILWAY_OCR_URL` para este flujo. Base URL **sin** sufijo `/cargar-pjn` (el código concatena `/cargar-pjn`). Permite dejar OCR en la nube y PJN en otro host. |
| `RAILWAY_OCR_URL` | Fallback si no hay `RAILWAY_CARGAR_PJN_URL`. Usado también por `procesar-ocr`. |
| `RAILWAY_INTERNAL_SECRET` | Opcional: header `X-Internal-Secret` hacia Railway. |

### Railway (microservicio `cargar-pjn`)

| Variable | Uso |
|----------|-----|
| `PJN_USUARIO` / `PJN_PASSWORD` | Login portal (también acepta `PJN_USER` / `PJN_PASS` en algunos archivos). |
| `PJN_JURISDICCION` | Código para el desplegable del flujo de escritos (ej. `CIV`). |
| `PORT` | Puerto HTTP (default 3000). |
| `PJN_UPLOAD_DRY_RUN=true` | No abre Playwright; útil para cableado API. |
| `PJN_HEADFUL=true` | Chromium visible (solo tiene sentido **en máquina local** con display). |
| `PJN_SKIP_FINAL_SEND=true` | Ejecuta el flujo hasta **antes** del clic en **Enviar**; no presenta el escrito. Devuelve `{ ok: true, pruebaSinEnvio: true }`. |
| `PJN_SLOW_MO_MS`, `PJN_HEADFUL_PAUSE_MS` | Pausas/ralentización para depuración local. |
| `RAILWAY_INTERNAL_SECRET` | Si está definido, el POST exige `X-Internal-Secret`. |

---

## 4. Comportamiento de respuesta y DB

- **Envío real (sin skip):** Railway responde `{ ok: true }`; la API puede devolver `{ ok: true, pjn_cargado_at }` y persiste fecha en `cedulas`.
- **`pruebaSinEnvio`:** Si Railway devuelve `pruebaSinEnvio: true`, la **ruta Next no actualiza** `pjn_cargado_at`. El frontend muestra mensaje verde explicando que fue prueba sin envío.
- **`PJN_UPLOAD_DRY_RUN`:** Sin Playwright; el wrapper puede devolver `{ ok: true, dryRun: true }` según implementación.

---

## 5. Limitación importante: «ver Chrome» en producción

Playwright en **Railway** corre en un **servidor sin monitor**. **No** se puede abrir una ventana de Chrome en la PC del usuario desde ese proceso.

Para que el usuario **vea** el navegador y pulse **Enviar** manualmente haría falta otro enfoque: **extensión de Chrome**, **app de escritorio**, o **Playwright solo en local** en la máquina del usuario.

---

## 6. Problemas frecuentes ya vistos

1. **`Cannot POST /cargar-pjn` / 404 HTML**  
   - El host en `RAILWAY_OCR_URL` / `RAILWAY_CARGAR_PJN_URL` **no** es el proceso `server.mjs` de `railway-service/cargar-pjn`, o el puerto no coincide.  
   - **Doble ruta:** si la env terminaba en `/cargar-pjn`, el fetch generaba `.../cargar-pjn/cargar-pjn`. El código ahora normaliza quitando ese sufijo.

2. **Prioridad de URL:** `RAILWAY_CARGAR_PJN_URL` tiene prioridad para no mezclar el servicio solo-OCR con el de PJN.

3. **Comprobación rápida:** `GET http://HOST:PUERTO/cargar-pjn` debe devolver JSON `{ ok: true, service: "cargar-pjn", ... }`.

---

## 7. Cómo tener confianza de que «está bien hecho»

- **Modo skip:** solo certifica el flujo **hasta antes de Enviar**; no certifica aceptación del PJN.
- **Modo real:** validar en portal (escrito presentado, PDF en expediente) y pilotos con pocas cédulas.
- Reforzar en código: más **aserciones** tras cada paso (texto/URL visible), **logs** en Railway, opcionalmente **screenshots** en fallo o antes de Enviar (modo debug).

---

## 8. Checklist sugerido para pasar a producción

- [ ] `RAILWAY_CARGAR_PJN_URL` (o `RAILWAY_OCR_URL` unificado) apunta al servicio que expone `POST /cargar-pjn`.
- [ ] `PJN_JURISDICCION`, `PJN_USUARIO`, `PJN_PASSWORD` en Railway.
- [ ] Decidir: **`PJN_SKIP_FINAL_SEND`** en `true` (solo pre-carga) vs `false` (envío real).
- [ ] Vercel: plan/timeouts suficientes para la duración del Playwright (p. ej. `maxDuration` en ruta + `vercel.json` si aplica).
- [ ] Secret interno alineado si se usa `RAILWAY_INTERNAL_SECRET`.
- [ ] Probar una cédula real en staging o piloto antes de volumen.

---

## 9. Archivos de migración / columnas

- Columna típica: `pjn_cargado_at` en `cedulas` (ver migraciones en `migrations/`, p. ej. `add_pjn_cargado_at_cedulas.sql`).

---

## 10. Referencia rápida de endpoints

| Método | Ruta | Dónde |
|--------|------|--------|
| `POST` | `/api/cedulas/[id]/cargar-pjn` | Next (Vercel) |
| `GET` / `POST` | `/cargar-pjn` | Railway `server.mjs` |

---

*Última actualización: documento generado para contexto de IA / equipo; ajustar fechas y envs según el despliegue real.*
