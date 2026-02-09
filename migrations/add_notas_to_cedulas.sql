-- Migración: Agregar columna notas a la tabla cedulas
-- Ejecutar este SQL en Supabase SQL Editor

-- Agregar columna notas (puede ser NULL)
ALTER TABLE cedulas 
ADD COLUMN IF NOT EXISTS notas TEXT DEFAULT NULL;

-- Comentario en la columna
COMMENT ON COLUMN cedulas.notas IS 'Notas editables con soporte para menciones (@username) que generan notificaciones';
