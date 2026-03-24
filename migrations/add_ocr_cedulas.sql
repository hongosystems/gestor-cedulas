-- Migración: Agregar columnas OCR a la tabla cedulas
-- Para integración con Railway OCR: estado, PDF acredita, expediente, carátula extraídos
-- Ejecutar en Supabase SQL Editor

ALTER TABLE cedulas
ADD COLUMN IF NOT EXISTS estado_ocr TEXT DEFAULT NULL;

ALTER TABLE cedulas
ADD COLUMN IF NOT EXISTS pdf_acredita_url TEXT DEFAULT NULL;

ALTER TABLE cedulas
ADD COLUMN IF NOT EXISTS ocr_exp_nro TEXT DEFAULT NULL;

ALTER TABLE cedulas
ADD COLUMN IF NOT EXISTS ocr_caratula TEXT DEFAULT NULL;

ALTER TABLE cedulas
ADD COLUMN IF NOT EXISTS ocr_procesado_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE cedulas
ADD COLUMN IF NOT EXISTS ocr_error TEXT DEFAULT NULL;

-- Índice para filtrar cédulas listas (estado_ocr = 'listo')
CREATE INDEX IF NOT EXISTS idx_cedulas_estado_ocr 
ON cedulas(estado_ocr) WHERE estado_ocr = 'listo';

COMMENT ON COLUMN cedulas.estado_ocr IS 
'Estado del proceso OCR: null/pendiente, listo, error';

COMMENT ON COLUMN cedulas.pdf_acredita_url IS 
'URL del PDF "Acredita Diligenciamiento" generado por Railway OCR';

COMMENT ON COLUMN cedulas.ocr_exp_nro IS 
'Número de expediente extraído por OCR (header X-Exp-Nro)';

COMMENT ON COLUMN cedulas.ocr_caratula IS 
'Carátula extraída por OCR (header X-Caratula)';

COMMENT ON COLUMN cedulas.ocr_procesado_at IS 
'Timestamp cuando el OCR se procesó correctamente';

COMMENT ON COLUMN cedulas.ocr_error IS 
'Mensaje de error si estado_ocr = error';
