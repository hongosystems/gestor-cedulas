# Migración de Cases a PJN Favoritos

## ⚠️ IMPORTANTE: Diferencia entre archivos

### 1. Script Node.js (`.mjs`) - **USAR ESTE**
**Archivo:** `scripts/migrate_cases_to_pjn_favoritos.mjs`

**Cómo ejecutar:**
```bash
node scripts/migrate_cases_to_pjn_favoritos.mjs
```

**Cuándo usar:**
- ✅ Cuando `cases` está en una base de datos diferente (pjn-scraper)
- ✅ Cuando necesitas extraer observaciones de movimientos JSONB
- ✅ Cuando quieres actualizar registros existentes con nuevas observaciones y fechas

**Características:**
- Lee desde la base de datos pjn-scraper
- Extrae observaciones de movimientos usando el mismo criterio que el autocompletado
- Maneja fechas en formato DD/MM/YYYY o ISO
- Actualiza registros existentes con `upsert`

---

### 2. Script SQL (`.sql`) - **SOLO si cases está en la misma DB**
**Archivo:** `migrations/migrate_cases_to_pjn_favoritos.sql`

**Cómo ejecutar:**
- Abre Supabase SQL Editor
- Copia y pega el contenido del archivo `.sql`
- Ejecuta el script

**Cuándo usar:**
- ⚠️ SOLO si la tabla `cases` está en la MISMA base de datos que `pjn_favoritos`
- Si `cases` está en otra base de datos (pjn-scraper), **NO uses este archivo**

**Características:**
- Extrae observaciones de movimientos JSONB usando función SQL
- Maneja fechas en formato DD/MM/YYYY o ISO
- Actualiza registros existentes con `ON CONFLICT`

---

## ❌ Error común

**Error:**
```
ERROR: 42601: syntax error at or near "{" 
LINE 14: import { createClient } from '@supabase/supabase-js';
```

**Causa:**
Estás intentando ejecutar el archivo `.mjs` (JavaScript) en el editor SQL de Supabase.

**Solución:**
- El archivo `.mjs` debe ejecutarse desde la terminal con Node.js
- El archivo `.sql` debe ejecutarse en Supabase SQL Editor

---

## ✅ Estado actual

La migración ya se ejecutó correctamente usando el script Node.js:
- ✅ 984 casos actualizados/insertados
- ✅ 860 registros únicos en `pjn_favoritos`
- ✅ Todos los registros tienen fechas de última modificación
- ✅ Observaciones extraídas de movimientos cuando están disponibles

Si necesitas actualizar nuevamente, ejecuta:
```bash
node scripts/migrate_cases_to_pjn_favoritos.mjs
```

## 🧹 Limpieza de juzgado (quitar "- SECRETARIA N° X")

Si en `pjn_favoritos.juzgado` quedaron valores del estilo:
- `JUZGADO CIVIL 89 - SECRETARIA N° 2`

y querés que quede solo:
- `JUZGADO CIVIL 89`

Ejecutá este SQL en **Supabase SQL Editor** (base principal):
- `migrations/normalize_pjn_favoritos_juzgado.sql`
