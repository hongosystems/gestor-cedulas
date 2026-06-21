# Integración HIF Asistencia

API de solo lectura para que [HIF Asistencia](https://github.com/) consuma expedientes PJN sincronizados en Gestor Cédulas.

## Fuente de datos

- Tabla: `pjn_favoritos` (639 favoritos PJN)
- Movimientos/novedades: campo JSONB `movimientos`
- **No** usa la tabla `expedientes` del estudio

## Autenticación

Header obligatorio en todas las requests:

```
X-API-Key: <HIF_INTEGRATION_API_KEY>
```

## Variables de entorno

| Variable | Descripción |
|----------|-------------|
| `HIF_INTEGRATION_API_KEY` | Secret compartido con HIF (64 chars hex) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Gestor Cédulas |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role para leer `pjn_favoritos` |

Generar key:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Agregar a `.env.local` y a Vercel (Production + Preview).

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/integrations/hif/expedientes/search?q=` | Búsqueda (mín. 3 chars, máx. 20 resultados) |
| GET | `/api/integrations/hif/expedientes/{id}` | Detalle del expediente |
| GET | `/api/integrations/hif/expedientes/{id}/movimientos` | Actuaciones parseadas |
| GET | `/api/integrations/hif/expedientes/{id}/novedades?desde=` | Mismas actuaciones + `raw` (filtro opcional) |

`{id}` = UUID de `pjn_favoritos.id`.

## Desarrollo local

```bash
npm run dev
```

## Probar con curl

```bash
# Search
curl -s -H "X-API-Key: $HIF_INTEGRATION_API_KEY" \
  "http://localhost:3000/api/integrations/hif/expedientes/search?q=guaita"

# Detalle
curl -s -H "X-API-Key: $HIF_INTEGRATION_API_KEY" \
  "http://localhost:3000/api/integrations/hif/expedientes/{UUID}"

# Movimientos
curl -s -H "X-API-Key: $HIF_INTEGRATION_API_KEY" \
  "http://localhost:3000/api/integrations/hif/expedientes/{UUID}/movimientos"

# Novedades (desde opcional, ISO 8601)
curl -s -H "X-API-Key: $HIF_INTEGRATION_API_KEY" \
  "http://localhost:3000/api/integrations/hif/expedientes/{UUID}/novedades?desde=2026-01-01T00:00:00.000Z"
```

## Test automatizado

```bash
node scripts/test-hif-integration.mjs
```

Requiere `npm run dev` en otra terminal.

## HIF Asistencia

Proyecto consumidor: app de asistencia al cliente que vincula expedientes PJN con clientes. Esta API expone el universo de favoritos del estudio para búsqueda, detalle y sincronización de novedades.
