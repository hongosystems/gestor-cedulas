-- Migración: Agregar columna created_by_user_id a la tabla cedulas
-- Ejecutar este SQL en Supabase SQL Editor

-- 1. Agregar columna created_by_user_id a cedulas
ALTER TABLE cedulas
ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Crear índice para mejor rendimiento
CREATE INDEX IF NOT EXISTS idx_cedulas_created_by_user_id ON cedulas(created_by_user_id);

-- 3. Si hay cédulas existentes sin created_by_user_id, asignar el owner_user_id como created_by
-- (asumiendo que el owner fue quien creó la cédula)
UPDATE cedulas
SET created_by_user_id = owner_user_id
WHERE created_by_user_id IS NULL;

-- Comentario: 
-- - La columna created_by_user_id rastrea quién creó cada cédula/oficio
-- - Para cédulas existentes, se asigna el owner_user_id como created_by_user_id
-- - Las nuevas cédulas deberán establecer created_by_user_id al crearse
