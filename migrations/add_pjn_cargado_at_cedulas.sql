-- Migración: Agregar columna pjn_cargado_at a la tabla cedulas
-- Marca cuándo el abogado cargó la cédula diligenciada en PJN
-- Ejecutar en Supabase SQL Editor

ALTER TABLE cedulas
ADD COLUMN IF NOT EXISTS pjn_cargado_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_cedulas_pjn_cargado_at
ON cedulas(pjn_cargado_at) WHERE pjn_cargado_at IS NOT NULL;

COMMENT ON COLUMN cedulas.pjn_cargado_at IS
'Timestamp cuando el abogado marcó la cédula como cargada en PJN';
