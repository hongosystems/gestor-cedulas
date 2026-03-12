-- Migración: Agregar campo admin_cedulas_en_tramite_at a la tabla cedulas
-- Cuando Admin Cedulas marca "En Tramite", se registra el timestamp.
-- Estados: Completa (admin_cedulas_completada_at), En Tramite (admin_cedulas_en_tramite_at), Pendiente (ninguno).

ALTER TABLE cedulas 
ADD COLUMN IF NOT EXISTS admin_cedulas_en_tramite_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_cedulas_admin_en_tramite 
ON cedulas(admin_cedulas_en_tramite_at) WHERE admin_cedulas_en_tramite_at IS NOT NULL;

COMMENT ON COLUMN cedulas.admin_cedulas_en_tramite_at IS 
'Timestamp cuando Admin Cedulas marcó esta cédula/oficio como "En Tramite". Se muestra el bubble En Tramite en Mis Juzgados.';
