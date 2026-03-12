-- Migración: Agregar campo admin_cedulas_completada_at a la tabla cedulas
-- Cuando Admin Cedulas marca "Completa", se congela el conteo de días solo para ese usuario.
-- El semáforo sigue corriendo para el resto de los usuarios del sistema.

ALTER TABLE cedulas 
ADD COLUMN IF NOT EXISTS admin_cedulas_completada_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_cedulas_admin_completada 
ON cedulas(admin_cedulas_completada_at) WHERE admin_cedulas_completada_at IS NOT NULL;

COMMENT ON COLUMN cedulas.admin_cedulas_completada_at IS 
'Timestamp cuando Admin Cedulas marcó esta cédula/oficio como completa. Solo para Admin Cedulas deja de contar días; el semáforo sigue para otros usuarios.';
