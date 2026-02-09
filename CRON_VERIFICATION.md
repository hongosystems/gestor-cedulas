# Verificación del Cron de Sincronización PJN

## ✅ Configuración Actual

El cron está configurado en `vercel.json` para ejecutarse **todos los días a las 2:00 AM UTC**:

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

## 🔍 Cómo Verificar que el Cron Funciona

### 1. Verificar en el Dashboard de Vercel

1. Ve a [Vercel Dashboard](https://vercel.com/dashboard)
2. Selecciona tu proyecto `gestor-cedulas`
3. Ve a la pestaña **"Cron Jobs"** o **"Functions"**
4. Busca el cron job `/api/pjn/sync-favoritos`
5. Verifica:
   - ✅ Estado: **Active** (activo)
   - ✅ Schedule: `0 2 * * *` (todos los días a las 2 AM UTC)
   - ✅ Última ejecución: Debe mostrar la fecha/hora de la última ejecución
   - ✅ Próxima ejecución: Debe mostrar cuándo se ejecutará la próxima vez

### 2. Verificar los Logs de Vercel

1. En el Dashboard de Vercel, ve a **"Logs"**
2. Filtra por `/api/pjn/sync-favoritos`
3. Busca logs que contengan:
   - `[sync-favoritos] GET request recibido (probablemente desde Vercel Cron)`
   - `[sync-favoritos] Iniciando sincronización...`
   - `[sync-favoritos] ✅ Metadata de sincronización actualizada exitosamente`

### 3. Verificar en la Base de Datos

Ejecuta este script para ver la última fecha de sincronización:

```bash
node scripts/check-sync-metadata.mjs
```

Deberías ver la fecha de la última sincronización. Si el cron está funcionando, esta fecha debería actualizarse todos los días alrededor de las 2:00 AM UTC.

### 4. Verificar en la UI

1. Ve a la página **"Mis Juzgados"**
2. En el header, a la derecha del título, deberías ver:
   - **"ÚLTIMA ACTUALIZACIÓN CON PJN"**
   - La fecha y hora de la última sincronización en formato `DD/MM/AA HH:MM`

## 🚨 Solución de Problemas

### El cron no se ejecuta

1. **Verifica que el archivo `vercel.json` esté en la raíz del proyecto**
2. **Verifica que el archivo esté en el repositorio Git** (no en .gitignore)
3. **Haz un nuevo deploy** después de agregar/modificar `vercel.json`
4. **Verifica que el endpoint funcione manualmente:**
   ```bash
   curl https://tu-dominio.vercel.app/api/pjn/sync-favoritos
   ```

### El cron se ejecuta pero falla

1. **Revisa los logs en Vercel** para ver el error específico
2. **Verifica las variables de entorno** en Vercel:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL` (si aplica)
   - `NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_ANON_KEY` (si aplica)
3. **Verifica que la tabla `pjn_sync_metadata` exista** ejecutando la migración SQL

### La fecha no se actualiza en la UI

1. **Recarga la página** (Ctrl+F5 o Cmd+Shift+R)
2. **Abre la consola del navegador** (F12) y busca logs que empiecen con `[Mis Juzgados]`
3. **Verifica que la tabla `pjn_sync_metadata` tenga datos:**
   ```bash
   node scripts/check-sync-metadata.mjs
   ```

## 📝 Notas Importantes

- **Zona horaria**: El cron se ejecuta a las **2:00 AM UTC**. Si estás en Argentina (UTC-3), esto corresponde a las **11:00 PM del día anterior** (hora local).
- **Primera ejecución**: El cron se activará automáticamente después del próximo deploy a Vercel.
- **Ejecución manual**: Puedes ejecutar el cron manualmente en cualquier momento:
  ```bash
  npm run sync:pjn-favoritos
  ```
  O haciendo un GET request al endpoint:
  ```bash
  curl https://tu-dominio.vercel.app/api/pjn/sync-favoritos
  ```

## 🔧 Cambiar el Horario del Cron

Para cambiar el horario, edita `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/pjn/sync-favoritos",
      "schedule": "0 2 * * *"  // Cambia esto
    }
  ]
}
```

**Formatos comunes:**
- `"0 2 * * *"` - Todos los días a las 2 AM UTC (actual)
- `"0 0 * * *"` - Todos los días a medianoche UTC
- `"0 */6 * * *"` - Cada 6 horas
- `"0 0,12 * * *"` - Dos veces al día (medianoche y mediodía UTC)
- `"0 5 * * *"` - Todos los días a las 5 AM UTC (11 PM hora Argentina)

Después de cambiar, haz commit y push. Vercel actualizará el cron automáticamente.
