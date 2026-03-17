-- PASO 5 — Convención de almacenamiento PDF Carta Documento
-- Los PDFs generados por generate-doc se guardan en el bucket 'mediaciones'
-- con path: {mediacion_id}/{numero_tramite}.pdf
-- Ejemplo: a1b2c3d4-.../MED-2025-0001.pdf
-- Si numero_tramite es NULL, la API usa un fallback (ej. id del documento).
-- No se requieren cambios de esquema; las tablas mediacion_documentos y
-- storage.buckets ya existen. Solo documentación.

-- Asegurar que el bucket mediaciones existe (idempotente)
INSERT INTO storage.buckets (id, name, public)
VALUES ('mediaciones', 'mediaciones', false)
ON CONFLICT (id) DO NOTHING;
