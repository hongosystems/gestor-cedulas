-- Oficios quitados manualmente del listado de reiteratorios (no corresponden).
ALTER TABLE cedulas
ADD COLUMN IF NOT EXISTS reiteratorio_excluido_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_cedulas_reiteratorio_excluido_at
ON cedulas(reiteratorio_excluido_at)
WHERE reiteratorio_excluido_at IS NOT NULL;

COMMENT ON COLUMN cedulas.reiteratorio_excluido_at IS
'Timestamp cuando un superadmin excluyó el oficio del listado de reiteratorios';
