-- =============================================================================
-- PREVIEW (solo lectura): candidatos CEDULA → OFICIO (alta confianza)
--
-- Bug histórico: oficios presentados/cargados en PJN como CEDULA (endpoint /procesar).
-- En este universo ocr_destinatario suele estar vacío (0/39 en análisis prod).
--
-- NO ejecuta UPDATE. Seguro en producción como SELECT.
--
-- Criterio alta confianza (v2 — alineado a audit_reclasificar_tipo_documento_oficio.sql):
--   tipo_documento = 'CEDULA'
--   AND estado_ocr = 'listo'
--   AND pjn_cargado_at IS NOT NULL
--   AND NULLIF(TRIM(ocr_exp_nro), '') IS NOT NULL
--   AND NULLIF(TRIM(caratula), '') IS NOT NULL
--
-- NO exige ocr_destinatario.
--
-- Excluye: tipo_documento NULL, CEDULA sin pjn_cargado_at, sin ocr_exp_nro, sin caratula.
--
-- Resultado esperado (validado en análisis prod):
--   total_candidatos = 39
--   candidatos_con_14_dias_o_mas = 29
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Resumen de impacto
-- -----------------------------------------------------------------------------
WITH candidatos AS (
  SELECT
    c.id,
    c.ocr_exp_nro,
    c.caratula,
    c.juzgado,
    c.ocr_destinatario,
    c.pjn_cargado_at,
    FLOOR(EXTRACT(EPOCH FROM (NOW() - c.pjn_cargado_at)) / 86400)::int AS dias_desde_pjn
  FROM cedulas c
  WHERE c.tipo_documento = 'CEDULA'
    AND c.estado_ocr = 'listo'
    AND c.pjn_cargado_at IS NOT NULL
    AND NULLIF(TRIM(c.ocr_exp_nro), '') IS NOT NULL
    AND NULLIF(TRIM(c.caratula), '') IS NOT NULL
)
SELECT
  COUNT(*)::bigint AS total_candidatos,
  COUNT(*) FILTER (WHERE dias_desde_pjn >= 14)::bigint AS candidatos_con_14_dias_o_mas,
  COUNT(*) FILTER (WHERE dias_desde_pjn < 14)::bigint AS candidatos_menos_de_14_dias,
  COUNT(*) FILTER (WHERE NULLIF(TRIM(ocr_destinatario), '') IS NOT NULL)::bigint AS con_ocr_destinatario,
  COUNT(*) FILTER (WHERE NULLIF(TRIM(ocr_destinatario), '') IS NULL)::bigint AS sin_ocr_destinatario,
  MIN(pjn_cargado_at) AS pjn_cargado_at_min,
  MAX(pjn_cargado_at) AS pjn_cargado_at_max
FROM candidatos;

-- -----------------------------------------------------------------------------
-- 2) Comparación con listado actual /reiteratorios (OFICIO + 14+ días)
-- -----------------------------------------------------------------------------
WITH candidatos AS (
  SELECT
    c.id,
    FLOOR(EXTRACT(EPOCH FROM (NOW() - c.pjn_cargado_at)) / 86400)::int AS dias_desde_pjn
  FROM cedulas c
  WHERE c.tipo_documento = 'CEDULA'
    AND c.estado_ocr = 'listo'
    AND c.pjn_cargado_at IS NOT NULL
    AND NULLIF(TRIM(c.ocr_exp_nro), '') IS NOT NULL
    AND NULLIF(TRIM(c.caratula), '') IS NOT NULL
),
oficios_ui AS (
  SELECT
    c.id,
    FLOOR(EXTRACT(EPOCH FROM (NOW() - c.pjn_cargado_at)) / 86400)::int AS dias_desde_pjn
  FROM cedulas c
  WHERE c.tipo_documento = 'OFICIO'
    AND c.estado_ocr = 'listo'
    AND c.pjn_cargado_at IS NOT NULL
)
SELECT
  (SELECT COUNT(*) FROM candidatos) AS total_candidatos_reclasificacion,
  (SELECT COUNT(*) FROM candidatos WHERE dias_desde_pjn >= 14) AS candidatos_14d_entrarian_reiteratorios,
  (SELECT COUNT(*) FROM oficios_ui) AS oficios_actuales_pipeline,
  (SELECT COUNT(*) FROM oficios_ui WHERE dias_desde_pjn >= 14) AS oficios_actuales_ui_14d,
  (SELECT COUNT(*) FROM oficios_ui WHERE dias_desde_pjn >= 14)
    + (SELECT COUNT(*) FROM candidatos WHERE dias_desde_pjn >= 14) AS oficios_ui_14d_despues_de_reclasificar;

-- -----------------------------------------------------------------------------
-- 3) Muestra de 30 registros (más antiguos en PJN primero)
-- -----------------------------------------------------------------------------
SELECT
  c.id,
  c.ocr_exp_nro,
  LEFT(NULLIF(TRIM(c.caratula), ''), 100) AS caratula_preview,
  c.juzgado,
  LEFT(NULLIF(TRIM(c.ocr_destinatario), ''), 80) AS ocr_destinatario_preview,
  c.pjn_cargado_at,
  FLOOR(EXTRACT(EPOCH FROM (NOW() - c.pjn_cargado_at)) / 86400)::int AS dias_desde_pjn,
  c.fecha_carga,
  c.ocr_procesado_at
FROM cedulas c
WHERE c.tipo_documento = 'CEDULA'
  AND c.estado_ocr = 'listo'
  AND c.pjn_cargado_at IS NOT NULL
  AND NULLIF(TRIM(c.ocr_exp_nro), '') IS NOT NULL
  AND NULLIF(TRIM(c.caratula), '') IS NOT NULL
ORDER BY c.pjn_cargado_at ASC
LIMIT 30;

-- -----------------------------------------------------------------------------
-- 4) Controles de exclusión
-- -----------------------------------------------------------------------------
SELECT
  (SELECT COUNT(*) FROM cedulas WHERE tipo_documento IS NULL
     AND estado_ocr = 'listo' AND pjn_cargado_at IS NOT NULL
     AND NULLIF(TRIM(ocr_exp_nro), '') IS NOT NULL) AS null_tipo_no_incluidos,
  (SELECT COUNT(*) FROM cedulas WHERE tipo_documento = 'CEDULA'
     AND estado_ocr = 'listo' AND pjn_cargado_at IS NULL
     AND NULLIF(TRIM(ocr_exp_nro), '') IS NOT NULL) AS cedula_sin_pjn_no_incluidos,
  (SELECT COUNT(*) FROM cedulas WHERE tipo_documento = 'CEDULA'
     AND estado_ocr = 'listo' AND pjn_cargado_at IS NOT NULL
     AND NULLIF(TRIM(ocr_exp_nro), '') IS NULL) AS cedula_sin_ocr_exp_nro_no_incluidos,
  (SELECT COUNT(*) FROM cedulas WHERE tipo_documento = 'CEDULA'
     AND estado_ocr = 'listo' AND pjn_cargado_at IS NOT NULL
     AND NULLIF(TRIM(ocr_exp_nro), '') IS NOT NULL
     AND NULLIF(TRIM(caratula), '') IS NULL) AS cedula_sin_caratula_no_incluidos;
