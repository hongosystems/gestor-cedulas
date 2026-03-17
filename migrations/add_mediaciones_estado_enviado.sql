-- Agregar estado 'enviado' a mediaciones (tras despacho por lotes)
-- Ejecutar en Supabase SQL Editor

ALTER TABLE mediaciones
  DROP CONSTRAINT IF EXISTS mediaciones_estado_check;

ALTER TABLE mediaciones
  ADD CONSTRAINT mediaciones_estado_check CHECK (estado IN (
    'borrador', 'pendiente_rta', 'devuelto', 'reenviado', 'aceptado', 'doc_generado', 'enviado'
  ));
