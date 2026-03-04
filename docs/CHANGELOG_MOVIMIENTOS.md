# Changelog: Mejoras en Filtrado de Prueba/Pericia

## Fecha: 2026-03-04

## Cambios Implementados

### 1. ✅ Arreglo del Endpoint de Sincronización
**Archivo:** `app/api/pjn/sync-favoritos/route.ts`

- **Problema:** El endpoint no estaba guardando el campo `movimientos` en `pjn_favoritos`
- **Solución:** Agregado `movimientos: c.movimientos || null` en el upsert
- **Impacto:** Ahora los movimientos se sincronizarán correctamente desde `cases` a `pjn_favoritos`

### 2. ✅ Fallback para Buscar Movimientos en Cases
**Archivos:** 
- `app/api/pjn/get-movimientos/route.ts` (nuevo)
- `app/superadmin/page.tsx` (mejorado)

- **Problema:** Si un expediente no tiene movimientos en `pjn_favoritos`, no se puede filtrar
- **Solución:** 
  - Creado endpoint `/api/pjn/get-movimientos` para buscar movimientos en `cases` como fallback
  - Mejorado el `useEffect` existente que ya cargaba movimientos desde `cases`
  - Mejorado logging para detectar expedientes sin movimientos

### 3. ✅ Script para Actualizar Movimientos Actuales
**Archivo:** `scripts/update-movimientos-pjn-favoritos.mjs` (nuevo)

- **Propósito:** Actualizar movimientos de expedientes que ya están en `pjn_favoritos` pero no tienen movimientos
- **Uso:** `node scripts/update-movimientos-pjn-favoritos.mjs`
- **Funcionalidad:** 
  - Identifica favoritos sin movimientos
  - Busca movimientos en `cases` (pjn-scraper)
  - Actualiza `pjn_favoritos` con los movimientos encontrados

### 4. ✅ Mejoras en Patrones de Detección
**Archivos:** 
- `app/superadmin/page.tsx`
- `app/superadmin/mis-juzgados/page.tsx`
- `app/prueba-pericia/page.tsx`

- **Mejoras:**
  - Agregado soporte para "EXPERTA" y "EXPERTO" (género femenino y variantes)
  - Mejorada extracción del texto "Detalle" (captura completa)
  - Agregados patrones adicionales:
    - `AGRÉGUENSE ESTUDIOS MÉDICOS... EXPERTA/EXPERTO`
    - `PRESENTACION DEL INFORME PERICIAL`
    - `INFORME PERICIAL`

### 5. ✅ Mejora en Frecuencia de Sincronización
**Archivo:** `vercel.json`

- **Cambio:** Frecuencia de sincronización aumentada de 1 vez al día (2 AM) a cada 6 horas
- **Antes:** `"schedule": "0 2 * * *"` (2 AM diario)
- **Ahora:** `"schedule": "0 */6 * * *"` (cada 6 horas: 00:00, 06:00, 12:00, 18:00)

### 6. ✅ Mejoras en Logging
**Archivo:** `app/api/pjn/sync-favoritos/route.ts`

- Agregadas estadísticas de:
  - Casos con/sin movimientos en `cases`
  - Favoritos con movimientos sincronizados
  - Mejor visibilidad del proceso de sincronización

## ⚠️ Acciones Requeridas

### Para GitHub Actions (si tienes configuraciones automáticas)

Si tienes workflows de GitHub Actions que:
- Ejecutan tests
- Hacen builds automáticos
- Despliegan automáticamente

**No se requieren cambios** porque:
- Los cambios son compatibles hacia atrás
- No se modificaron dependencias
- No se cambiaron estructuras de base de datos (solo se usa un campo existente)

### Para Actualizar Expedientes Actuales

**Ejecutar el script de actualización:**

```bash
node scripts/update-movimientos-pjn-favoritos.mjs
```

Este script:
1. Identifica expedientes sin movimientos en `pjn_favoritos`
2. Busca sus movimientos en `cases` (pjn-scraper)
3. Actualiza `pjn_favoritos` con los movimientos encontrados

**Recomendación:** Ejecutar este script después del deploy para actualizar los expedientes existentes.

### Verificación Post-Deploy

Después del deploy, verificar:

1. **Sincronización automática:**
   - Verificar en logs de Vercel que el cron job se ejecuta cada 6 horas
   - Verificar que los movimientos se están guardando correctamente

2. **Filtro de Prueba/Pericia:**
   - Probar con expedientes conocidos:
     - `CIV 027462/2023` (debería detectarse)
     - `CIV 084812/2019` (debería detectarse con EXPERTA)
     - `CIV 019891/2020` (debería detectarse)

3. **Fallback:**
   - Verificar que expedientes sin movimientos en `pjn_favoritos` se cargan desde `cases` automáticamente

## Archivos Modificados

1. `app/api/pjn/sync-favoritos/route.ts` - Arreglo y mejoras
2. `app/api/pjn/get-movimientos/route.ts` - Nuevo endpoint
3. `app/superadmin/page.tsx` - Mejoras en filtrado y logging
4. `app/superadmin/mis-juzgados/page.tsx` - Mejoras en patrones
5. `app/prueba-pericia/page.tsx` - Mejoras en patrones
6. `vercel.json` - Frecuencia de sincronización
7. `scripts/update-movimientos-pjn-favoritos.mjs` - Nuevo script

## Notas Importantes

- Los cambios son **compatibles hacia atrás**
- No se requieren migraciones de base de datos
- El campo `movimientos` ya existía en `pjn_favoritos`, solo no se estaba sincronizando
- El fallback a `cases` funciona automáticamente cuando se activa el filtro de Prueba/Pericia
