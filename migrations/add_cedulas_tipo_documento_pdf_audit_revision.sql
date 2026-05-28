-- =============================================================================
-- Revisión humana y trazabilidad de apply — cedulas_tipo_documento_pdf_audit
--
-- Fase A: revisado, revisado_at, revisado_by, revision_estado, revision_nota
-- Fase B: aplicado / aplicado_at / rollback_data ya existen en create_*.sql
-- =============================================================================

ALTER TABLE cedulas_tipo_documento_pdf_audit
  ADD COLUMN IF NOT EXISTS revisado BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE cedulas_tipo_documento_pdf_audit
  ADD COLUMN IF NOT EXISTS revisado_at TIMESTAMPTZ;

ALTER TABLE cedulas_tipo_documento_pdf_audit
  ADD COLUMN IF NOT EXISTS revisado_by UUID;

ALTER TABLE cedulas_tipo_documento_pdf_audit
  ADD COLUMN IF NOT EXISTS revision_estado TEXT;

ALTER TABLE cedulas_tipo_documento_pdf_audit
  ADD COLUMN IF NOT EXISTS revision_nota TEXT;

-- CHECK solo cuando revision_estado no es NULL
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cedulas_tipo_documento_pdf_audit_revision_estado_check'
  ) THEN
    ALTER TABLE cedulas_tipo_documento_pdf_audit
      ADD CONSTRAINT cedulas_tipo_documento_pdf_audit_revision_estado_check
      CHECK (
        revision_estado IS NULL
        OR revision_estado IN ('CONFIRMADO', 'RECHAZADO', 'DUDA')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cedulas_tipo_documento_pdf_audit_revisado
  ON cedulas_tipo_documento_pdf_audit (revisado);

CREATE INDEX IF NOT EXISTS idx_cedulas_tipo_documento_pdf_audit_revision_estado
  ON cedulas_tipo_documento_pdf_audit (revision_estado);

COMMENT ON COLUMN cedulas_tipo_documento_pdf_audit.revisado IS
  'true si un superadmin marcó revisión humana (CONFIRMADO/RECHAZADO/DUDA).';

COMMENT ON COLUMN cedulas_tipo_documento_pdf_audit.revisado_at IS
  'Momento de la última revisión humana.';

COMMENT ON COLUMN cedulas_tipo_documento_pdf_audit.revisado_by IS
  'UUID del superadmin que revisó (auth.users.id).';

COMMENT ON COLUMN cedulas_tipo_documento_pdf_audit.revision_estado IS
  'CONFIRMADO | RECHAZADO | DUDA. Solo CONFIRMADO habilita apply.';

COMMENT ON COLUMN cedulas_tipo_documento_pdf_audit.revision_nota IS
  'Nota opcional del revisor humano.';
