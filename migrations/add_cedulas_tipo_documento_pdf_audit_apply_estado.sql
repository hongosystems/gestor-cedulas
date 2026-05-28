-- =============================================================================
-- apply_estado, aplicado_by y VALIDADO_SIN_CAMBIOS en revision_estado
-- =============================================================================

ALTER TABLE cedulas_tipo_documento_pdf_audit
  ADD COLUMN IF NOT EXISTS aplicado_by UUID;

ALTER TABLE cedulas_tipo_documento_pdf_audit
  ADD COLUMN IF NOT EXISTS apply_estado TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cedulas_tipo_documento_pdf_audit_revision_estado_check'
  ) THEN
    ALTER TABLE cedulas_tipo_documento_pdf_audit
      DROP CONSTRAINT cedulas_tipo_documento_pdf_audit_revision_estado_check;
  END IF;
END $$;

ALTER TABLE cedulas_tipo_documento_pdf_audit
  ADD CONSTRAINT cedulas_tipo_documento_pdf_audit_revision_estado_check
  CHECK (
    revision_estado IS NULL
    OR revision_estado IN (
      'CONFIRMADO',
      'RECHAZADO',
      'DUDA',
      'VALIDADO_SIN_CAMBIOS'
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cedulas_tipo_documento_pdf_audit_apply_estado_check'
  ) THEN
    ALTER TABLE cedulas_tipo_documento_pdf_audit
      ADD CONSTRAINT cedulas_tipo_documento_pdf_audit_apply_estado_check
      CHECK (
        apply_estado IS NULL
        OR apply_estado IN ('APLICADO', 'SIN_CAMBIOS', 'RECHAZADO', 'ERROR')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cedulas_tipo_documento_pdf_audit_apply_estado
  ON cedulas_tipo_documento_pdf_audit (apply_estado);

COMMENT ON COLUMN cedulas_tipo_documento_pdf_audit.aplicado_by IS
  'UUID del superadmin que ejecutó apply (UPDATE o SIN_CAMBIOS).';

COMMENT ON COLUMN cedulas_tipo_documento_pdf_audit.apply_estado IS
  'APLICADO | SIN_CAMBIOS | RECHAZADO | ERROR — resultado del último apply.';
