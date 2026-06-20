-- =============================================================================
-- Auditoría de asignación de owner en expedientes (resolución "Sin responsable")
-- =============================================================================

CREATE TABLE IF NOT EXISTS expedientes_owner_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expediente_id UUID REFERENCES expedientes(id) ON DELETE SET NULL,
  pjn_favorito_id UUID,
  owner_asignado UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  owner_anterior UUID,
  senal TEXT NOT NULL,
  ejecutado_por UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  dry_run BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expedientes_owner_audit_expediente_id
  ON expedientes_owner_audit(expediente_id);

CREATE INDEX IF NOT EXISTS idx_expedientes_owner_audit_ejecutado_por
  ON expedientes_owner_audit(ejecutado_por);

CREATE INDEX IF NOT EXISTS idx_expedientes_owner_audit_created_at
  ON expedientes_owner_audit(created_at DESC);

COMMENT ON TABLE expedientes_owner_audit IS
  'Trazabilidad de asignaciones de owner_user_id en expedientes (automáticas y manuales).';

COMMENT ON COLUMN expedientes_owner_audit.senal IS
  'Origen de la señal: cedula_oficio_match, juzgado_unico, manual_superadmin, etc.';

COMMENT ON COLUMN expedientes_owner_audit.pjn_favorito_id IS
  'Si la asignación creó fila local desde favorito PJN, referencia al favorito origen.';

-- Permitir owner_user_id NULL en expedientes (favoritos PJN sincronizados sin abogado)
ALTER TABLE expedientes
  ALTER COLUMN owner_user_id DROP NOT NULL;
