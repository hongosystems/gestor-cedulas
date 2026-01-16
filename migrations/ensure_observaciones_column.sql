-- Migración: Asegurar que la columna observaciones existe en expedientes
-- Ejecutar este SQL en Supabase SQL Editor

-- 1. Agregar columna observaciones si no existe
ALTER TABLE expedientes
ADD COLUMN IF NOT EXISTS observaciones TEXT DEFAULT NULL;

-- 2. Comentar la columna para documentación
COMMENT ON COLUMN expedientes.observaciones IS 'Observaciones opcionales del expediente';

-- 3. Verificar que la columna fue creada (esto no hará nada si ya existe, pero ayuda a confirmar)
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns
WHERE table_name = 'expedientes' 
  AND column_name = 'observaciones';

-- Comentario:
-- Esta migración asegura que la columna observaciones existe en la tabla expedientes.
-- Los usuarios pueden agregar observaciones al crear expedientes, y estas se mostrarán
-- en la columna "Observaciones" de las tablas de expedientes.
