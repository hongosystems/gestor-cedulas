-- Marca carga manual en PJN (solo trazabilidad en Diligenciamiento; no dispara automatización).
-- Ejecutar en Supabase SQL Editor

ALTER TABLE cedulas
ADD COLUMN IF NOT EXISTS pjn_cargado_manual_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_cedulas_pjn_cargado_manual_at
ON cedulas(pjn_cargado_manual_at) WHERE pjn_cargado_manual_at IS NOT NULL;

COMMENT ON COLUMN cedulas.pjn_cargado_manual_at IS
'Timestamp cuando un operador marcó manualmente la cédula como cargada en PJN (trazabilidad, sin carga automática)';
