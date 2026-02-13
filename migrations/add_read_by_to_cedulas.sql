-- Migración: Agregar campos read_by_user_id y read_by_name a la tabla cedulas
-- Ejecutar este SQL en Supabase SQL Editor

-- Agregar columna read_by_user_id (puede ser NULL si nadie ha leído la cédula)
ALTER TABLE cedulas 
ADD COLUMN IF NOT EXISTS read_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Agregar columna read_by_name (nombre del usuario que leyó la cédula)
ALTER TABLE cedulas 
ADD COLUMN IF NOT EXISTS read_by_name VARCHAR(255) DEFAULT NULL;

-- Crear índice para búsquedas rápidas por read_by_user_id (opcional pero recomendado)
CREATE INDEX IF NOT EXISTS idx_cedulas_read_by_user_id ON cedulas(read_by_user_id);

-- Comentario: Los campos se actualizarán cuando un usuario abra la cédula por primera vez
