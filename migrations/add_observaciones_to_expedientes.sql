-- Migración: Agregar campo observaciones a la tabla expedientes
-- Ejecutar este SQL en Supabase SQL Editor

ALTER TABLE expedientes
ADD COLUMN IF NOT EXISTS observaciones TEXT DEFAULT NULL;

-- Crear índice para búsquedas si es necesario (opcional)
-- CREATE INDEX IF NOT EXISTS idx_expedientes_observaciones ON expedientes USING gin(to_tsvector('spanish', observaciones));
