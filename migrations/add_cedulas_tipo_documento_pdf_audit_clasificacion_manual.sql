-- =============================================================================
-- Clasificación manual de INDETERMINADO — cedulas_tipo_documento_pdf_audit
--
-- Resolución humana sin tocar cedulas.tipo_documento hasta apply.
-- =============================================================================

ALTER TABLE cedulas_tipo_documento_pdf_audit
  ADD COLUMN IF NOT EXISTS clasificacion_manual TEXT;

ALTER TABLE cedulas_tipo_documento_pdf_audit
  ADD COLUMN IF NOT EXISTS clasificacion_manual_at TIMESTAMPTZ;

ALTER TABLE cedulas_tipo_documento_pdf_audit
  ADD COLUMN IF NOT EXISTS clasificacion_manual_by UUID;

ALTER TABLE cedulas_tipo_documento_pdf_audit
  ADD COLUMN IF NOT EXISTS clasificacion_manual_nota TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cedulas_tipo_documento_pdf_audit_clasificacion_manual_check'
  ) THEN
    ALTER TABLE cedulas_tipo_documento_pdf_audit
      ADD CONSTRAINT cedulas_tipo_documento_pdf_audit_clasificacion_manual_check
      CHECK (
        clasificacion_manual IS NULL
        OR clasificacion_manual IN ('CEDULA', 'OFICIO', 'INDETERMINADO')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cedulas_tipo_documento_pdf_audit_clasificacion_manual
  ON cedulas_tipo_documento_pdf_audit (clasificacion_manual);

COMMENT ON COLUMN cedulas_tipo_documento_pdf_audit.clasificacion_manual IS
  'CEDULA | OFICIO | INDETERMINADO. Resolución humana cuando clasificacion_pdf=INDETERMINADO.';

COMMENT ON COLUMN cedulas_tipo_documento_pdf_audit.clasificacion_manual_at IS
  'Momento de la última clasificación manual.';

COMMENT ON COLUMN cedulas_tipo_documento_pdf_audit.clasificacion_manual_by IS
  'UUID del superadmin que clasificó manualmente.';

COMMENT ON COLUMN cedulas_tipo_documento_pdf_audit.clasificacion_manual_nota IS
  'Nota obligatoria al resolver como CEDULA u OFICIO.';
