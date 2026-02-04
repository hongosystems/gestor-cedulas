# Eliminar Duplicados en Cases (pjn-scraper)

## Descripción

Este script identifica y elimina duplicados en la tabla `cases` de pjn-scraper basándose en el número de expediente (ej: "047456/2020").

## Cómo Funciona

1. **Normaliza números de expediente**: Convierte "CIV 047456/2020" o "CIV 47456/2020" a "047456/2020" para comparar correctamente
2. **Identifica duplicados**: Agrupa casos con el mismo número de expediente normalizado
3. **Selecciona el mejor registro**: Para cada grupo de duplicados, mantiene el registro con:
   - Prioridad 1: NO removido (si uno está removido y otro no)
   - Prioridad 2: Más reciente según `ult_act`
   - Prioridad 3: Mayor completitud (más información: carátula, dependencia, movimientos, etc.)
   - Prioridad 4: ID más reciente
4. **Elimina duplicados**: Elimina los registros que no se mantienen

## Requisitos

### Variables de Entorno

El script necesita acceso a la base de datos de pjn-scraper con permisos de eliminación:

**Si pjn-scraper está en la MISMA base de datos que gestor-cedulas:**
```env
NEXT_PUBLIC_SUPABASE_URL=tu_url
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
```

**Si pjn-scraper está en una base de datos DIFERENTE (caso actual):**

Agrega estas variables a tu archivo `.env.local`:

```env
# Opción 1: Variables específicas de pjn-scraper (recomendado)
NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL=https://npfcgsrrhhmwywierpbf.supabase.co
PJN_SCRAPER_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5wZmNnc3JyaGhtd3l3aWVycGJmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODgxNjAyOCwiZXhwIjoyMDg0MzkyMDI4fQ.raeANGakN1lJiHrdKkyGmuP68KEyiBAuIWxcVvye1FI
```

O también puedes usar:
```env
# Opción 2: Variables directas (también funciona)
SUPABASE_URL=https://npfcgsrrhhmwywierpbf.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5wZmNnc3JyaGhtd3l3aWVycGJmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODgxNjAyOCwiZXhwIjoyMDg0MzkyMDI4fQ.raeANGakN1lJiHrdKkyGmuP68KEyiBAuIWxcVvye1FI
```

**Nota:** Necesitas la **Service Role Key** (no la anon key) porque el script necesita permisos para eliminar registros.

## Uso

### 1. Verificar Variables de Entorno

Asegúrate de tener las variables configuradas en `.env.local`:

```bash
# Verificar que las variables estén cargadas
cat .env.local | grep -E "PJN_SCRAPER|SUPABASE_SERVICE"
```

### 2. Ejecutar el Script

```bash
npm run remove:duplicates-cases
```

O directamente:
```bash
node scripts/remove-duplicates-cases.mjs
```

### 3. Revisar los Resultados

El script mostrará:
- Cuántos expedientes tienen duplicados
- Qué registros se mantendrán
- Qué registros se eliminarán
- Un resumen final con el total eliminado

**Ejemplo de salida:**
```
📊 Resumen:
   📋 Expedientes con duplicados: 15
   🗑️  Registros a eliminar: 18
   ✅ Registros a mantener: 982

📊 Resumen final:
   ✅ Eliminados exitosamente: 18 registros
   📋 Total de registros restantes: 982
```

## Seguridad

El script incluye una pausa de 5 segundos antes de eliminar para que puedas cancelar con Ctrl+C si es necesario.

## Ejemplo de Duplicados

Si tienes estos registros en `cases`:

| ID | key | caratula | ult_act |
|----|-----|----------|---------|
| 1 | CIV 047456/2020 | Carátula completa | 2024-01-15 |
| 2 | CIV 47456/2020 | Carátula parcial | 2024-01-10 |
| 3 | CIV 047456/2020 | Carátula completa | 2024-01-20 |

El script:
- Normalizará todos a "047456/2020"
- Mantendrá el ID 3 (más reciente)
- Eliminará los IDs 1 y 2

## Troubleshooting

### Error: "Invalid API key"

**Causa:** La service role key no es válida o no corresponde a la base de datos de pjn-scraper.

**Solución:**
1. Verifica que `PJN_SCRAPER_SERVICE_ROLE_KEY` o `SUPABASE_SERVICE_ROLE_KEY` esté configurada correctamente
2. Si pjn-scraper está en una base diferente, necesitas la service role key de ESA base
3. Obtén la service role key desde el dashboard de Supabase de pjn-scraper:
   - Settings → API → service_role key (secret)

### Error: "Permission denied" al eliminar

**Causa:** La anon key no tiene permisos de eliminación.

**Solución:** Usa la service role key en lugar de la anon key.

### El script no encuentra duplicados

**Causa:** Los números de expediente pueden tener formatos diferentes que no se normalizan correctamente.

**Solución:** Revisa manualmente algunos casos para ver si hay variaciones en el formato que el script no está detectando.

## Notas Importantes

- ⚠️ **Este script ELIMINA registros permanentemente**. Asegúrate de tener un backup antes de ejecutarlo.
- El script mantiene el mejor registro según los criterios mencionados
- Los duplicados se identifican solo por número de expediente, no por otros campos
- Si necesitas un criterio diferente para decidir qué mantener, modifica la función `getCompletenessScore` o el ordenamiento en el script
