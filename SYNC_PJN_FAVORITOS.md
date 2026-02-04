# Sincronización de PJN Favoritos

## Problema

Los expedientes en `pjn-scraper` (tabla `cases`) se actualizan cuando se agregan o remueven favoritos, pero estos cambios no se reflejan automáticamente en `pjn_favoritos` de la base de datos principal. Esto causa que:

- Los expedientes removidos de favoritos (con `removido = TRUE` en `cases`) sigan apareciendo en la UI
- Las actualizaciones de información no se reflejen en la UI

## Solución

Se creó un endpoint de API que sincroniza automáticamente los datos de `cases` (pjn-scraper) a `pjn_favoritos` (base principal).

### Endpoint

**URL:** `POST /api/pjn/sync-favoritos`

**Descripción:**
- Lee todos los casos de la tabla `cases` en pjn-scraper (incluyendo la columna `removido`)
- Los sincroniza a `pjn_favoritos` (inserta nuevos o actualiza existentes)
- **NO sincroniza casos con `removido = TRUE`** (estos no se agregan ni actualizan)
- **Elimina de `pjn_favoritos` los expedientes que tienen `removido = TRUE` en `cases`**
- **Elimina de `pjn_favoritos` los expedientes que ya no están en `cases`** (fueron eliminados completamente)

**Respuesta exitosa:**
```json
{
  "success": true,
  "message": "Sincronización completada",
  "inserted": 0,
  "updated": 150,
  "deleted": 5,
  "removed": 3,
  "totalCases": 150,
  "totalFavoritos": 147
}
```

Donde:
- `updated`: Casos sincronizados (insertados o actualizados)
- `deleted`: Expedientes eliminados de `pjn_favoritos` (removidos o no existentes)
- `removed`: Casos marcados como `removido = TRUE` en `cases`

## Uso

### 0. Sincronización Automática (Ya Configurada) ✅

El cron job ya está configurado para ejecutarse automáticamente todos los días a las 2:00 AM (UTC). Se activará después del próximo deploy a Vercel.

Para ejecutar manualmente ahora mismo, usa el script local:
```bash
node scripts/sync-pjn-favoritos.mjs
```

### 1. Sincronización Manual

Puedes llamar al endpoint manualmente usando curl o cualquier cliente HTTP:

**Sin secret (si no está configurado):**
```bash
curl -X POST https://tu-dominio.vercel.app/api/pjn/sync-favoritos
```

**Con secret (recomendado en producción):**
```bash
curl -X POST https://tu-dominio.vercel.app/api/pjn/sync-favoritos \
  -H "Authorization: Bearer tu-secret-aqui"
```

O como query parameter:
```bash
curl -X POST "https://tu-dominio.vercel.app/api/pjn/sync-favoritos?secret=tu-secret-aqui"
```

O desde el navegador (si tienes autenticación configurada):
```javascript
fetch('/api/pjn/sync-favoritos', { 
  method: 'POST',
  headers: {
    'Authorization': 'Bearer tu-secret-aqui'
  }
})
  .then(res => res.json())
  .then(data => console.log(data));
```

### 2. Sincronización Automática (Cron Job)

#### Opción A: Vercel Cron Jobs ✅ CONFIGURADO

El cron job ya está configurado en `vercel.json` para ejecutarse **todos los días a las 2:00 AM (UTC)**:

```json
{
  "crons": [
    {
      "path": "/api/pjn/sync-favoritos",
      "schedule": "0 2 * * *"
    }
  ]
}
```

**Nota:** El cron job se activará automáticamente después del próximo deploy a Vercel. 

**Horarios comunes:**
- `"0 2 * * *"` - Todos los días a las 2 AM UTC (configurado actualmente)
- `"0 0 * * *"` - Todos los días a medianoche UTC
- `"0 */6 * * *"` - Cada 6 horas
- `"0 0,12 * * *"` - Dos veces al día (medianoche y mediodía UTC)

**Para cambiar el horario:** Edita `vercel.json` y haz push a la rama principal. Vercel actualizará el cron job automáticamente.

**Con secret (opcional, recomendado en producción):**
Si configuraste `PJN_SYNC_SECRET`, puedes agregarlo como query parameter:
```json
{
  "crons": [
    {
      "path": "/api/pjn/sync-favoritos?secret=tu-secret-aqui",
      "schedule": "0 2 * * *"
    }
  ]
}
```

**Schedules comunes:**
- `"0 * * * *"` - Cada hora
- `"0 */6 * * *"` - Cada 6 horas
- `"0 0 * * *"` - Una vez al día (medianoche)
- `"0 0,12 * * *"` - Dos veces al día (medianoche y mediodía)

#### Opción B: Servicio Externo (cron-job.org, EasyCron, etc.)

1. Configura una tarea cron en el servicio
2. URL: `https://tu-dominio.vercel.app/api/pjn/sync-favoritos?secret=tu-secret-aqui`
   - O con header: `Authorization: Bearer tu-secret-aqui`
3. Método: POST
4. Frecuencia: Según tus necesidades (recomendado: cada 6-12 horas)

#### Opción C: Supabase Edge Functions + pg_cron

Si prefieres ejecutar desde Supabase, puedes crear una Edge Function que llame al endpoint o ejecutar directamente la lógica en una función de Supabase.

## Variables de Entorno Requeridas

El endpoint requiere las siguientes variables de entorno:

- `NEXT_PUBLIC_SUPABASE_URL` - URL de la base de datos principal
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key de la base principal
- `NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL` - URL de la base pjn-scraper (opcional, usa la principal si no está configurada)
- `NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_ANON_KEY` - Anon key de pjn-scraper (opcional, usa la principal si no está configurada)
- `PJN_SYNC_SECRET` - (Opcional) Secret para proteger el endpoint. Si está configurado, debe enviarse en el header `Authorization: Bearer <secret>` o como query param `?secret=<secret>`

## Seguridad

El endpoint puede protegerse opcionalmente con un secret:

1. **Configura el secret** en las variables de entorno: `PJN_SYNC_SECRET=tu-secret-aqui`
2. **Envía el secret** en la petición:
   - Como header: `Authorization: Bearer tu-secret-aqui`
   - O como query param: `?secret=tu-secret-aqui`

Si no configuras `PJN_SYNC_SECRET`, el endpoint será público (útil para desarrollo, pero no recomendado en producción).

## Detalles Técnicos

### Proceso de Sincronización

1. **Lectura de casos:** Lee todos los registros de `cases` en pjn-scraper (incluyendo columna `removido`)
2. **Filtrado:** 
   - **NO sincroniza casos con `removido = TRUE`** - estos se marcan para eliminación
   - Solo procesa casos activos (no removidos)
3. **Conversión:** Convierte cada caso activo al formato de `pjn_favoritos`:
   - Parsea el expediente (jurisdicción, número, año)
   - Normaliza el juzgado (remueve "- SECRETARIA N° X")
   - Extrae observaciones de movimientos JSONB
   - Formatea fechas a DD/MM/YYYY
4. **Upsert:** Inserta o actualiza registros en `pjn_favoritos` usando `upsert` con constraint única
5. **Limpieza:** Elimina de `pjn_favoritos`:
   - Expedientes con `removido = TRUE` en `cases`
   - Expedientes que ya no existen en `cases` (fueron eliminados completamente)

### Manejo de Errores

- Si falla la lectura de `cases`, retorna error 500
- Si falla el upsert, continúa con el siguiente lote (no detiene todo el proceso)
- Si falla la eliminación de removidos, retorna éxito parcial con warning

### Performance

- Procesa en lotes de 100 registros
- Elimina duplicados dentro de cada lote antes de insertar
- Usa índices de base de datos para búsquedas rápidas

## Verificación

Después de ejecutar la sincronización, puedes verificar:

1. **En la UI:** Ve a "Mis Juzgados" y verifica que los expedientes removidos ya no aparecen
2. **En la base de datos:** Compara el conteo de `cases` vs `pjn_favoritos`
3. **Logs:** Revisa los logs del endpoint para ver detalles de la sincronización

## Troubleshooting

### Error: "Faltan variables de entorno"
- Verifica que todas las variables de entorno estén configuradas en Vercel/plataforma

### Error: "Error al leer casos de pjn-scraper"
- Verifica que la tabla `cases` exista en la base de datos pjn-scraper
- Verifica que las credenciales de pjn-scraper sean correctas

### Los expedientes removidos siguen apareciendo
- Verifica que la sincronización se ejecutó correctamente (revisa los logs)
- Verifica que el endpoint eliminó los registros (revisa `deleted` y `removed` en la respuesta)
- Verifica que en `cases` los expedientes tienen `removido = TRUE` (no `false` o `null`)
- Ejecuta la sincronización manualmente para forzar una actualización: `npm run sync:pjn-favoritos`

### La sincronización es muy lenta
- Reduce la frecuencia del cron job
- Considera procesar solo los casos modificados recientemente (requiere modificar el endpoint)
