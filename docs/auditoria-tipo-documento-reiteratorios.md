# Auditoría: clasificación `tipo_documento` (CEDULA vs OFICIO)

**Contexto:** el diagnóstico `/api/reiteratorios/diagnostico` reportó ~57 registros con señales operativas reales (`pjn_cargado_at`, `estado_ocr = listo`, `ocr_exp_nro`, etc.) pero `tipo_documento = 'CEDULA'`, excluidos de `/reiteratorios` (que exige `OFICIO`).

**Alcance de este documento:** análisis de código + SQL de auditoría + propuesta de migración **reversible**.  
**No ejecutar UPDATE en producción** hasta revisión humana de la muestra.

---

## Advertencia — alcance de la reclasificación histórica

Esta reclasificación **aplica únicamente** al bug histórico en el que **oficios** fueron:

- clasificados como `tipo_documento = 'CEDULA'` al subir (p. ej. Railway `/procesar` antes que `/procesar-oficio`), y  
- **cargados en PJN** con flujo de diligenciamiento de cédula (`pjn_cargado_at` poblado),  
- **sin** `ocr_destinatario` en la mayoría de los casos (análisis prod: **0 de 39** candidatos).

**No** es una regla general para corregir cualquier `CEDULA` mal etiquetada en el futuro.  
Futuros documentos deben corregirse vía fix en `detect-type-upload` / UI, no con este lote SQL.

**Criterio alta confianza v2 (lote bug histórico):**

```text
tipo_documento = 'CEDULA'
AND estado_ocr = 'listo'
AND pjn_cargado_at IS NOT NULL
AND NULLIF(TRIM(ocr_exp_nro), '') IS NOT NULL
AND NULLIF(TRIM(caratula), '') IS NOT NULL
-- NO exige ocr_destinatario
```

**Cantidades esperadas (validadas en prod):**

| Métrica | Valor |
|---------|-------|
| Total candidatos | **39** |
| Con 14+ días desde `pjn_cargado_at` | **29** |

Archivos: `migrations/preview_reclasificar_cedula_a_oficio.sql`, `migrations/audit_reclasificar_tipo_documento_oficio.sql`.

---

## 1. Cómo se asigna `tipo_documento` hoy

### 1.1 Base de datos

| Origen | Comportamiento |
|--------|----------------|
| `migrations/add_tipo_documento.sql` | Columna `VARCHAR(10)`, `CHECK (CEDULA \| OFICIO)`, **default NULL** |
| Datos históricos | Pre-migración: `NULL`. Post-migración sin backfill: mezcla `NULL` + valores explícitos |
| **No hay trigger** que actualice `tipo_documento` después del INSERT |

### 1.2 Carga manual (`app/app/nueva/page.tsx`)

1. Usuario sube PDF/DOCX → `POST /api/detect-type-upload`
2. Si detecta tipo → preselecciona `tipoDocumento` (con confirmación si el usuario cambia)
3. **INSERT** en `cedulas` con `tipo_documento = tipoDocumento` elegido por usuario/detección
4. Si la columna no existía (legacy): INSERT sin tipo → queda `NULL`

**Fallback nombre archivo (sin PDF/DOCX OCR):** regex `OFICIO` / `CEDULA` en el nombre.

### 1.3 Detección al subir (`app/api/detect-type-upload/route.ts`)

**PDF:**

1. En paralelo: heurística local (primeras 4 páginas) + Railway
2. **Railway:** intenta primero `POST /procesar` con `cedula.pdf`; si OK → tipo **`CEDULA`** (o `OFICIO` solo si header `X-Tipo-Documento` dice OFICIO)
3. Si falla `/procesar` → intenta `POST /procesar-oficio` → tipo **`OFICIO`**
4. Si Railway no responde → devuelve heurística local (`\bOFICIO\b` / `\bCEDULA\b` en texto, o `acredita-*.pdf` → OFICIO)

**DOCX:** mammoth + mismas palabras clave en primeros 200–500 caracteres.

**Riesgo principal:** un oficio que el endpoint `/procesar` acepta devuelve clasificación **CEDULA** aunque el documento sea un oficio.

### 1.4 OCR en background (`app/api/cedulas/[id]/procesar-ocr/route.ts`)

- Lee `cedulas.tipo_documento` **ya guardado** en el INSERT
- `OFICIO` → `/procesar-oficio` + `oficio.pdf`
- Cualquier otro valor (incl. `CEDULA`, `NULL`) → `/procesar` + `cedula.pdf`
- Actualiza `ocr_*`, `pdf_acredita_url`, `estado_ocr` — **no modifica `tipo_documento`**

### 1.5 Carga PJN (`app/api/cedulas/[id]/cargar-pjn/route.ts`)

- `buildPjnDiligenciamientoPayload` usa `tipo_documento` para descripción PJN:
  - `OFICIO` → `"Acredita Diligenciamiento Oficio"`
  - `CEDULA` → `"Acredita Diligenciamiento Cedula"`
- `NULL` o valor inválido → **error** en `normalizeTipoDocumentoPjn` (no debería cargar PJN salvo que el registro tenga `CEDULA`/`OFICIO` explícito)

### 1.6 Defaults en UI (tratan NULL como cédula)

| Vista | Regla |
|-------|--------|
| `app/superadmin/page.tsx`, `mis-juzgados` | Cédulas = `!tipo_documento \|\| tipo_documento === 'CEDULA'` |
| `app/diligenciamiento/page.tsx` | Listado incluye `CEDULA` **y** `NULL` |
| `app/app/page.tsx` | Filtros; oficio con PJN → estado "Completa" solo si `tipo_documento === 'OFICIO'` |
| `/reiteratorios` | **Solo** `tipo_documento = 'OFICIO'` |

### 1.7 Migraciones / imports

- No existe migración que haga `UPDATE cedulas SET tipo_documento = ...`
- `clear_cedulas_and_expedientes_for_client.sql` vacía tablas; no reclasifica
- Scripts en `scripts/` no importan cédulas con tipo masivo
- `file_transfers.doc_type` es independiente (CEDULA/OFICIO en transfers, no sincroniza con `cedulas.tipo_documento`)

### 1.8 Resumen del ciclo de vida

```text
INSERT (nueva carga) → tipo_documento fijado
        ↓
procesar-ocr (usa tipo existente, no lo corrige)
        ↓
cargar-pjn / confirmar-pjn (usa tipo existente)
        ↓
/reiteratorios filtra OFICIO solamente
```

**Conclusión:** los 57 casos son casi seguro **clasificación inicial incorrecta o conservadora (CEDULA)**, no corrupción posterior.

---

## 2. ¿Son realmente oficios los 57 excluidos?

### Evidencia indirecta fuerte (operativa)

Si tienen **todas** estas señales, el flujo fue el de diligenciamiento completo (típico de oficios del estudio):

| Señal | Interpretación |
|-------|----------------|
| `estado_ocr = 'listo'` | OCR Railway completado |
| `pjn_cargado_at IS NOT NULL` | Marcado cargado en PJN |
| `ocr_exp_nro` poblado | Extracción de expediente |
| Uso previsto en reiteratorios | Presentación usa `ocr_destinatario` (campo propio del flujo oficio/reiteratorio) |

### Evidencia para scoring automático (sin abrir PDF)

| Regla | Peso sugerido | Lógica |
|-------|---------------|--------|
| `ocr_destinatario` no vacío | **No aplica a este lote** | En los 39 candidatos del bug histórico: **0** con destinatario; no usar como filtro de reclasificación |
| `pdf_acredita_url` / storage `acredita/{id}.pdf` | Media | Ambos tipos post-OCR usan `acredita/`; no discrimina solo |
| `pdf_path` ILIKE '%oficio%' | Media | Nombre original al subir |
| `caratula` / `ocr_caratula` ILIKE '%OFICIO%' | Baja | Puede ser carátula judicial, no tipo documental |
| PJN payload logs / `observaciones_pjn` contiene "Oficio" | Media (si se loguea) | Revisar muestra manual |
| Match en `pjn_favoritos` + movimientos | Contexto expediente | No define tipo documental |

**Hipótesis principal:** gran parte de los 57 son **oficios mal etiquetados como CEDULA** porque:

1. `/api/detect-type-upload` prioriza `/procesar` (CEDULA), o  
2. El operador dejó CEDULA tras detección fallida, o  
3. Carga antigua sin autodetección + convención UI “todo es cédula salvo que digan oficio”.

**Validación obligatoria antes de reclasificar:** revisar PDF original (muestra 10–20) y confirmar encabezado “OFICIO” vs “CEDULA DE NOTIFICACION”.

---

## 3. Patrones automáticos detectables en SQL

Ver sección **5** (queries). Categorías:

- `A_destinatario` — `ocr_destinatario` presente  
- `B_pdf_nombre` — path con OFICIO  
- `C_alta_confianza` — A + listo + pjn_cargado  
- `D_solo_operativo` — pjn + OCR sin destinatario (revisión manual)  
- `E_null_tipo` — NULL con señales (si aparecen en el universo)

---

## 4. Estrategia segura de reclasificación (propuesta)

### Fase 0 — Solo lectura (ahora)

1. Ejecutar SQL §5.1–5.6 en Supabase (copia o prod read-only).  
2. Exportar CSV de `candidatos_reclasificacion` con `score` ≥ 3.  
3. Revisión manual abogado/admin (mín. 15 filas).  

### Fase 1 — Tabla de auditoría (reversible)

```sql
-- migrations/audit_tipo_documento_backup.sql (PROPUESTA — NO EJECUTAR EN PROD SIN APROBACIÓN)
CREATE TABLE IF NOT EXISTS cedulas_tipo_documento_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cedula_id UUID NOT NULL REFERENCES cedulas(id) ON DELETE CASCADE,
  tipo_documento_anterior VARCHAR(10),
  tipo_documento_nuevo VARCHAR(10) NOT NULL,
  score INTEGER NOT NULL,
  reglas TEXT[] NOT NULL,
  motivo TEXT,
  aprobado_por UUID REFERENCES auth.users(id),
  aplicado_at TIMESTAMPTZ,
  revertido_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cedula_id, created_at)
);
```

### Fase 2 — Aplicar solo candidatos de alta confianza (bug histórico v2)

```text
tipo_documento = 'CEDULA'
AND estado_ocr = 'listo'
AND pjn_cargado_at IS NOT NULL
AND NULLIF(TRIM(ocr_exp_nro), '') IS NOT NULL
AND NULLIF(TRIM(caratula), '') IS NOT NULL
-- NO exige ocr_destinatario
```

**Lote esperado:** 39 registros; 29 entrarían en `/reiteratorios` con umbral 14 días tras reclasificar.

### Fase 3 — Rollback

```sql
UPDATE cedulas c
SET tipo_documento = a.tipo_documento_anterior
FROM cedulas_tipo_documento_audit a
WHERE a.cedula_id = c.id
  AND a.aplicado_at IS NOT NULL
  AND a.revertido_at IS NULL
  AND a.tipo_documento_nuevo = 'OFICIO';
-- Luego marcar revertido_at en audit
```

### Qué NO hacer en v1

- No reclasificar `NULL` masivamente sin regla explícita.  
- No tocar registros sin `pjn_cargado_at` (no son el universo reiteratorios).  
- No cambiar `file_transfers.doc_type` en la misma migración.  
- No actualizar código de detección y datos al mismo tiempo (primero datos o primero código, con ventana acotada).

### Mejora de código (futuro, separada)

1. Invertir prioridad en `detect-type-upload`: probar `/procesar-oficio` primero si heurística local ve OFICIO.  
2. Tras OCR exitoso con `X-Destinatario`, **sugerir o fijar** `tipo_documento = OFICIO` si estaba CEDULA.  
3. Endpoint admin “reclasificar con audit” en lugar de SQL manual.

---

## 5. SQL de auditoría (ejecutar en Supabase SQL Editor)

### 5.1 Universo igual al diagnóstico reiteratorios (excluidos por tipo)

```sql
-- Registros NO-OFICIO con señales de pipeline (misma definición que diagnostico/route.ts)
SELECT
  id,
  tipo_documento,
  estado_ocr,
  pjn_cargado_at,
  ocr_exp_nro,
  ocr_destinatario,
  ocr_caratula,
  caratula,
  juzgado,
  pdf_path,
  pdf_acredita_url,
  fecha_carga,
  ocr_procesado_at,
  FLOOR(EXTRACT(EPOCH FROM (NOW() - pjn_cargado_at)) / 86400)::int AS dias_desde_pjn
FROM cedulas
WHERE COALESCE(tipo_documento, 'NULL') <> 'OFICIO'
  AND (
    pjn_cargado_at IS NOT NULL
    OR estado_ocr = 'listo'
    OR NULLIF(TRIM(ocr_exp_nro), '') IS NOT NULL
  )
ORDER BY pjn_cargado_at DESC NULLS LAST;
```

### 5.2 Conteo por `tipo_documento` en ese universo

```sql
SELECT
  COALESCE(tipo_documento, 'NULL') AS tipo,
  COUNT(*) AS n,
  COUNT(*) FILTER (WHERE pjn_cargado_at IS NOT NULL) AS con_pjn,
  COUNT(*) FILTER (WHERE estado_ocr = 'listo') AS ocr_listo,
  COUNT(*) FILTER (WHERE NULLIF(TRIM(ocr_destinatario), '') IS NOT NULL) AS con_destinatario
FROM cedulas
WHERE COALESCE(tipo_documento, 'NULL') <> 'OFICIO'
  AND (
    pjn_cargado_at IS NOT NULL
    OR estado_ocr = 'listo'
    OR NULLIF(TRIM(ocr_exp_nro), '') IS NOT NULL
  )
GROUP BY 1
ORDER BY n DESC;
```

### 5.3 Scoring de candidatos a OFICIO (los ~57 CEDULA)

```sql
WITH candidatos AS (
  SELECT
    c.*,
    (CASE WHEN NULLIF(TRIM(c.ocr_destinatario), '') IS NOT NULL THEN 3 ELSE 0 END) AS pts_destinatario,
    (CASE WHEN c.pdf_path ILIKE '%oficio%' THEN 2 ELSE 0 END) AS pts_pdf_path,
    (CASE WHEN COALESCE(c.ocr_caratula, c.caratula, '') ILIKE '%OFICIO%' THEN 1 ELSE 0 END) AS pts_caratula_oficio,
    (CASE WHEN c.estado_ocr = 'listo' AND c.pjn_cargado_at IS NOT NULL THEN 2 ELSE 0 END) AS pts_pipeline_completo,
    (CASE WHEN c.pdf_acredita_url IS NOT NULL OR c.pdf_path LIKE '%/acredita/%' THEN 1 ELSE 0 END) AS pts_acredita
  FROM cedulas c
  WHERE c.tipo_documento = 'CEDULA'
    AND (
      c.pjn_cargado_at IS NOT NULL
      OR c.estado_ocr = 'listo'
      OR NULLIF(TRIM(c.ocr_exp_nro), '') IS NOT NULL
    )
),
scored AS (
  SELECT
    *,
    (pts_destinatario + pts_pdf_path + pts_caratula_oficio + pts_pipeline_completo + pts_acredita) AS score,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN pts_destinatario > 0 THEN 'ocr_destinatario' END,
      CASE WHEN pts_pdf_path > 0 THEN 'pdf_path_oficio' END,
      CASE WHEN pts_caratula_oficio > 0 THEN 'caratula_oficio' END,
      CASE WHEN pts_pipeline_completo > 0 THEN 'pipeline_listo_pjn' END,
      CASE WHEN pts_acredita > 0 THEN 'acredita_storage' END
    ], NULL) AS reglas
  FROM candidatos
)
SELECT
  COUNT(*) AS total_cedula_con_señales,
  COUNT(*) FILTER (WHERE score >= 5) AS alta_confianza,
  COUNT(*) FILTER (WHERE score BETWEEN 3 AND 4) AS media_confianza,
  COUNT(*) FILTER (WHERE score <= 2) AS baja_confianza,
  COUNT(*) FILTER (WHERE pts_destinatario = 0 AND pts_pipeline_completo > 0) AS pipeline_sin_destinatario
FROM scored;
```

### 5.4 Muestra para revisión manual (top score)

```sql
-- Reutilizar CTE scored del 5.3 y:
SELECT
  id,
  score,
  reglas,
  ocr_exp_nro,
  LEFT(COALESCE(ocr_destinatario, ''), 80) AS destinatario_preview,
  juzgado,
  pjn_cargado_at,
  estado_ocr,
  pdf_path
FROM scored
WHERE score >= 3
ORDER BY score DESC, pjn_cargado_at ASC
LIMIT 30;
```

### 5.5 Impacto en /reiteratorios si se reclasificaran (simulación)

```sql
WITH reclasificar AS (
  SELECT c.id
  FROM cedulas c
  WHERE c.tipo_documento = 'CEDULA'
    AND c.estado_ocr = 'listo'
    AND c.pjn_cargado_at IS NOT NULL
    AND NULLIF(TRIM(c.ocr_exp_nro), '') IS NOT NULL
    AND NULLIF(TRIM(c.caratula), '') IS NOT NULL
)
SELECT
  (SELECT COUNT(*) FROM cedulas WHERE tipo_documento = 'OFICIO' AND estado_ocr = 'listo' AND pjn_cargado_at IS NOT NULL) AS oficios_actuales_en_pipeline,
  (SELECT COUNT(*) FROM reclasificar) AS sumarian_si_reclasificacion_conservadora,
  (SELECT COUNT(*) FROM cedulas c
   JOIN reclasificar r ON r.id = c.id
   WHERE FLOOR(EXTRACT(EPOCH FROM (NOW() - c.pjn_cargado_at)) / 86400) >= 14) AS entrarian_en_ui_14_dias;
```

### 5.6 NULL con señales (universo paralelo)

```sql
SELECT COUNT(*) AS null_con_señales
FROM cedulas
WHERE tipo_documento IS NULL
  AND (pjn_cargado_at IS NOT NULL OR estado_ocr = 'listo' OR NULLIF(TRIM(ocr_exp_nro), '') IS NOT NULL);
```

### 5.7 Distribución por juzgado (patrón operativo)

```sql
SELECT
  COALESCE(juzgado, '(sin juzgado)') AS juzgado,
  COUNT(*) AS n
FROM cedulas
WHERE tipo_documento = 'CEDULA'
  AND pjn_cargado_at IS NOT NULL
  AND estado_ocr = 'listo'
GROUP BY 1
ORDER BY n DESC
LIMIT 25;
```

---

## 6. Migración reversible propuesta (borrador)

Archivo sugerido: `migrations/audit_reclasificar_tipo_documento_oficio.sql` (solo tras aprobación).

```sql
-- PASO 1: backup lógico (ejecutar en transacción)
BEGIN;

INSERT INTO cedulas_tipo_documento_audit (
  cedula_id, tipo_documento_anterior, tipo_documento_nuevo, score, reglas, motivo
)
SELECT
  c.id,
  c.tipo_documento,
  'OFICIO',
  -- pegar score/reglas desde tabla temporal o subquery del §5.3
  5,
  ARRAY['ocr_destinatario','pipeline_listo_pjn'],
  'Auditoría reiteratorios: candidato alta confianza'
FROM cedulas c
WHERE c.tipo_documento = 'CEDULA'
  AND c.estado_ocr = 'listo'
  AND c.pjn_cargado_at IS NOT NULL
  AND NULLIF(TRIM(c.ocr_exp_nro), '') IS NOT NULL
  AND NULLIF(TRIM(c.caratula), '') IS NOT NULL
  -- AND c.id IN (... lista aprobada manualmente ...)
;

-- PASO 2: aplicar (solo si la muestra manual confirma)
-- UPDATE cedulas c
-- SET tipo_documento = 'OFICIO'
-- FROM cedulas_tipo_documento_audit a
-- WHERE a.cedula_id = c.id
--   AND a.aplicado_at IS NULL
--   AND a.tipo_documento_nuevo = 'OFICIO';

-- UPDATE cedulas_tipo_documento_audit SET aplicado_at = now() WHERE aplicado_at IS NULL;

COMMIT;
-- ROLLBACK; -- si algo no cierra
```

---

## 7. Riesgos de reclasificación

| Riesgo | Mitigación |
|--------|------------|
| Cédula judicial real (no oficio) con PJN cargado | Muestra manual de carátulas; criterio acotado al universo bug |
| Cambio rompe reportes históricos “cédulas” | Audit table + export previo |
| PJN ya cargado con descripción “Cedula” | Solo afecta **futuros** reiteratorios/listados; no re-carga PJN automática |
| Registros duplicados mismo expediente | Revisar por `ocr_exp_nro` antes de lote |

---

## 8. Referencias de código

| Archivo | Rol |
|---------|-----|
| `migrations/add_tipo_documento.sql` | Schema |
| `app/app/nueva/page.tsx` | INSERT + detect-type-upload |
| `app/api/detect-type-upload/route.ts` | Clasificación upload (Railway `/procesar` primero) |
| `app/api/cedulas/[id]/procesar-ocr/route.ts` | OCR sin actualizar tipo |
| `app/api/cedulas/[id]/cargar-pjn/route.ts` | PJN según tipo |
| `lib/pjn-payload.ts` | Descripciones PJN por tipo |
| `app/reiteratorios/page.tsx` | Filtro estricto OFICIO |
| `app/api/reiteratorios/diagnostico/route.ts` | Conteo exclusiones por tipo |

---

## 9. Próximos pasos recomendados

1. Ejecutar `migrations/preview_reclasificar_cedula_a_oficio.sql` → confirmar **39** / **29**.  
2. Ejecutar solo CREATE TABLE de `migrations/audit_reclasificar_tipo_documento_oficio.sql`.  
3. Revisión manual muestra de 30 (carátulas) → descomentar fase aplicar (INSERT + UPDATE).  
4. Validar con `GET /api/reiteratorios/diagnostico?dias=14`.  
5. Fix `detect-type-upload` en PR separado (no mezclar con lote histórico).

### Archivos SQL dedicados (etapa preparación)

| Archivo | Uso |
|---------|-----|
| `migrations/preview_reclasificar_cedula_a_oficio.sql` | Solo SELECT — impacto y muestra |
| `migrations/audit_reclasificar_tipo_documento_oficio.sql` | Tabla audit + INSERT/UPDATE/rollback comentados |
