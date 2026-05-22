-- =============================================================================
-- Migración REVERSIBLE (preparación): reclasificar CEDULA → OFICIO (alta confianza)
--
-- ALCANCE: solo bug histórico de oficios cargados/presentados como CEDULA en PJN.
-- NO usar como regla genérica para futuros documentos mal clasificados.
--
-- ESTADO: INSERT y UPDATE en cedulas están COMENTADOS. Ejecutar primero:
--   migrations/preview_reclasificar_cedula_a_oficio.sql
--
-- Criterio alta confianza v2 (validado: 39 candidatos, 29 con 14+ días):
--   tipo_documento = 'CEDULA'
--   AND estado_ocr = 'listo'
--   AND pjn_cargado_at IS NOT NULL
--   AND NULLIF(TRIM(ocr_exp_nro), '') IS NOT NULL
--   AND NULLIF(TRIM(caratula), '') IS NOT NULL
--
-- NO exige ocr_destinatario (0/39 lo tenían en análisis prod).
--
-- NO incluye: tipo_documento NULL, CEDULA sin pjn_cargado_at, sin ocr_exp_nro, sin caratula.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Tabla de auditoría / backup lógico
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cedulas_tipo_documento_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cedula_id UUID NOT NULL REFERENCES cedulas(id) ON DELETE CASCADE,
  tipo_documento_anterior VARCHAR(10),
  tipo_documento_nuevo VARCHAR(10) NOT NULL CHECK (tipo_documento_nuevo IN ('CEDULA', 'OFICIO')),
  motivo TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  aplicado_at TIMESTAMPTZ,
  revertido_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cedulas_tipo_documento_audit_cedula_id
  ON cedulas_tipo_documento_audit(cedula_id);

CREATE INDEX IF NOT EXISTS idx_cedulas_tipo_documento_audit_aplicado
  ON cedulas_tipo_documento_audit(aplicado_at)
  WHERE aplicado_at IS NOT NULL AND revertido_at IS NULL;

COMMENT ON TABLE cedulas_tipo_documento_audit IS
  'Backup lógico para reclasificación tipo_documento (CEDULA→OFICIO). Solo lote bug histórico PJN. Permite rollback.';

COMMENT ON COLUMN cedulas_tipo_documento_audit.tipo_documento_anterior IS
  'Valor en cedulas.tipo_documento antes del cambio (esperado: CEDULA).';

COMMENT ON COLUMN cedulas_tipo_documento_audit.aplicado_at IS
  'Cuándo se aplicó el UPDATE en cedulas (NULL = solo registrado en audit, pendiente).';

COMMENT ON COLUMN cedulas_tipo_documento_audit.revertido_at IS
  'Cuándo se revirtió el cambio vía rollback.';

-- -----------------------------------------------------------------------------
-- 2) FASE APLICAR — TODO COMENTADO (no modifica cedulas ni audit hasta descomentar)
--    Orden recomendado:
--      a) Ejecutar preview_reclasificar_cedula_a_oficio.sql (esperar 39 / 29)
--      b) Descomentar bloque INSERT en audit
--      c) Descomentar bloque UPDATE cedulas + aplicado_at
-- -----------------------------------------------------------------------------
/*
-- 2a) Registrar candidatos en audit (idempotente)
INSERT INTO cedulas_tipo_documento_audit (
  cedula_id,
  tipo_documento_anterior,
  tipo_documento_nuevo,
  motivo
)
SELECT
  c.id,
  c.tipo_documento,
  'OFICIO',
  'Bug histórico: CEDULA con OCR listo, PJN cargado, ocr_exp_nro y caratula (oficio presentado como cédula; sin exigir ocr_destinatario)'
FROM cedulas c
WHERE c.tipo_documento = 'CEDULA'
  AND c.estado_ocr = 'listo'
  AND c.pjn_cargado_at IS NOT NULL
  AND NULLIF(TRIM(c.ocr_exp_nro), '') IS NOT NULL
  AND NULLIF(TRIM(c.caratula), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM cedulas_tipo_documento_audit a
    WHERE a.cedula_id = c.id
      AND a.tipo_documento_nuevo = 'OFICIO'
      AND a.revertido_at IS NULL
      AND a.aplicado_at IS NULL
  );

-- 2b) Aplicar en cedulas
BEGIN;

UPDATE cedulas c
SET tipo_documento = 'OFICIO'
FROM cedulas_tipo_documento_audit a
WHERE a.cedula_id = c.id
  AND a.tipo_documento_nuevo = 'OFICIO'
  AND a.aplicado_at IS NULL
  AND a.revertido_at IS NULL
  AND c.tipo_documento = 'CEDULA'
  AND c.estado_ocr = 'listo'
  AND c.pjn_cargado_at IS NOT NULL
  AND NULLIF(TRIM(c.ocr_exp_nro), '') IS NOT NULL
  AND NULLIF(TRIM(c.caratula), '') IS NOT NULL;

UPDATE cedulas_tipo_documento_audit a
SET aplicado_at = now()
WHERE a.tipo_documento_nuevo = 'OFICIO'
  AND a.aplicado_at IS NULL
  AND a.revertido_at IS NULL
  AND EXISTS (
    SELECT 1 FROM cedulas c
    WHERE c.id = a.cedula_id AND c.tipo_documento = 'OFICIO'
  );

COMMIT;
*/

-- =============================================================================
-- ROLLBACK (documentado — ejecutar manualmente si hubo que revertir)
-- =============================================================================
-- Restaura tipo_documento desde audit para filas aplicadas y no revertidas.
--
/*
BEGIN;

UPDATE cedulas c
SET tipo_documento = a.tipo_documento_anterior
FROM cedulas_tipo_documento_audit a
WHERE a.cedula_id = c.id
  AND a.tipo_documento_nuevo = 'OFICIO'
  AND a.aplicado_at IS NOT NULL
  AND a.revertido_at IS NULL;

UPDATE cedulas_tipo_documento_audit a
SET revertido_at = now()
WHERE a.tipo_documento_nuevo = 'OFICIO'
  AND a.aplicado_at IS NOT NULL
  AND a.revertido_at IS NULL;

COMMIT;
*/

-- Verificación post-rollback (debe devolver 0):
/*
SELECT COUNT(*) AS filas_inconsistentes
FROM cedulas c
JOIN cedulas_tipo_documento_audit a ON a.cedula_id = c.id
WHERE a.revertido_at IS NOT NULL
  AND c.tipo_documento = 'OFICIO'
  AND a.tipo_documento_anterior = 'CEDULA';
*/
