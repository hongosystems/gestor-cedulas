-- =============================================================================
-- Auditoría de clasificación de PDFs (CEDULA vs OFICIO vs INDETERMINADO)
--
-- Objetivo: registrar el resultado de leer el PDF de cada cédula y compararlo
-- contra cedulas.tipo_documento. Esta tabla es SOLO LECTURA / SOLO AUDIT:
--   * NO modifica cedulas.tipo_documento
--   * NO modifica pjn_cargado_at, estado_ocr, pdf_acredita_url, pdf_url ni pdf_acredita_path
--   * NO toca archivos en Storage
--   * Permite rollback futuro (Fase 7) sin pérdida de información
--
-- Esta tabla es COMPLEMENTARIA a `cedulas_tipo_documento_audit`
-- (creada por migrations/audit_reclasificar_tipo_documento_oficio.sql),
-- que registra reclasificaciones por criterio SQL (lote bug histórico).
-- Esta nueva tabla registra el análisis del CONTENIDO del PDF.
--
-- Acceso esperado: solo superadmin vía /api/admin/auditoria-tipo-documento-pdf/*
-- (usando supabaseService, sin RLS adicional — mismo modelo que la tabla previa).
-- =============================================================================

CREATE TABLE IF NOT EXISTS cedulas_tipo_documento_pdf_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cedula_id UUID NOT NULL REFERENCES cedulas(id) ON DELETE CASCADE,

  -- Snapshot del valor de cedulas.tipo_documento al momento de auditar.
  -- Texto libre (no CHECK) porque puede ser NULL/CEDULA/OFICIO o algo legacy.
  tipo_documento_actual TEXT,

  -- Resultado de leer el PDF.
  clasificacion_pdf TEXT NOT NULL
    CHECK (clasificacion_pdf IN ('CEDULA', 'OFICIO', 'INDETERMINADO')),

  -- Confianza 0..1 calculada por el clasificador.
  confianza NUMERIC,

  -- Lista de razones / patrones detectados, en formato JSON.
  -- Ej: [{"patron":"OFICIO","peso":3,"clasificacion":"OFICIO","pagina":1}, ...]
  razones JSONB,

  -- Primeros N caracteres del texto extraído del PDF (para auditoría manual).
  texto_detectado TEXT,

  -- Origen del archivo analizado: cedulas.pdf_path | cedulas.pdf_acredita_url | etc.
  archivo_origen TEXT,

  -- Marca de aplicación (Fase 7). Mientras la corrección no esté implementada,
  -- estos campos quedan en false / NULL.
  aplicado BOOLEAN NOT NULL DEFAULT false,
  aplicado_at TIMESTAMPTZ,

  -- Snapshot reversible: estado anterior de la fila antes de aplicar.
  -- Ej: {"tipo_documento":"CEDULA"} para poder restaurar en rollback.
  rollback_data JSONB,

  -- Quien generó el registro (UUID del superadmin que disparó el run).
  created_by UUID,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Índices
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cedulas_tipo_documento_pdf_audit_cedula_id
  ON cedulas_tipo_documento_pdf_audit (cedula_id);

CREATE INDEX IF NOT EXISTS idx_cedulas_tipo_documento_pdf_audit_clasificacion_pdf
  ON cedulas_tipo_documento_pdf_audit (clasificacion_pdf);

CREATE INDEX IF NOT EXISTS idx_cedulas_tipo_documento_pdf_audit_aplicado
  ON cedulas_tipo_documento_pdf_audit (aplicado);

-- Índice extra para la pantalla /admin/auditoria-tipo-documento (orden por reciente).
CREATE INDEX IF NOT EXISTS idx_cedulas_tipo_documento_pdf_audit_created_at
  ON cedulas_tipo_documento_pdf_audit (created_at DESC);

-- -----------------------------------------------------------------------------
-- Comentarios
-- -----------------------------------------------------------------------------
COMMENT ON TABLE cedulas_tipo_documento_pdf_audit IS
  'Auditoría reversible del contenido del PDF vs cedulas.tipo_documento. Solo registra, no modifica. Apply queda en Fase 7.';

COMMENT ON COLUMN cedulas_tipo_documento_pdf_audit.tipo_documento_actual IS
  'Snapshot de cedulas.tipo_documento al momento del análisis (NULL admisible).';

COMMENT ON COLUMN cedulas_tipo_documento_pdf_audit.clasificacion_pdf IS
  'Resultado del análisis del PDF. CEDULA/OFICIO/INDETERMINADO.';

COMMENT ON COLUMN cedulas_tipo_documento_pdf_audit.confianza IS
  'Confianza 0..1 del clasificador (suma de pesos sobre cota).';

COMMENT ON COLUMN cedulas_tipo_documento_pdf_audit.razones IS
  'JSONB con patrones detectados (patron, peso, clasificación, página).';

COMMENT ON COLUMN cedulas_tipo_documento_pdf_audit.texto_detectado IS
  'Primer fragmento del texto extraído del PDF (para revisión manual).';

COMMENT ON COLUMN cedulas_tipo_documento_pdf_audit.archivo_origen IS
  'Path/URL del archivo analizado (snapshot del campo usado, ej. pdf_path).';

COMMENT ON COLUMN cedulas_tipo_documento_pdf_audit.aplicado IS
  'true si la corrección sugerida fue aplicada (Fase 7). false mientras tanto.';

COMMENT ON COLUMN cedulas_tipo_documento_pdf_audit.aplicado_at IS
  'Cuándo se aplicó la corrección. NULL hasta Fase 7.';

COMMENT ON COLUMN cedulas_tipo_documento_pdf_audit.rollback_data IS
  'Snapshot reversible (ej. {"tipo_documento":"CEDULA"}). Permite rollback futuro.';

COMMENT ON COLUMN cedulas_tipo_documento_pdf_audit.created_by IS
  'UUID del superadmin que generó el registro (auth.users.id).';

-- -----------------------------------------------------------------------------
-- Verificación post-migración
-- -----------------------------------------------------------------------------
-- SELECT COUNT(*) FROM cedulas_tipo_documento_pdf_audit;  -- esperado: 0
-- \d cedulas_tipo_documento_pdf_audit
