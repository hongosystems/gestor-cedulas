-- Migración: Agregar campo tipo_documento a la tabla cedulas
-- Ejecutar este SQL en Supabase SQL Editor

-- Agregar columna tipo_documento (puede ser NULL para documentos existentes)
ALTER TABLE cedulas 
ADD COLUMN IF NOT EXISTS tipo_documento VARCHAR(10) CHECK (tipo_documento IN ('CEDULA', 'OFICIO')) DEFAULT NULL;

-- Crear índice para búsquedas rápidas por tipo (opcional pero recomendado)
CREATE INDEX IF NOT EXISTS idx_cedulas_tipo_documento ON cedulas(tipo_documento);

-- Comentario: Los documentos existentes tendrán tipo_documento = NULL
-- Los nuevos documentos tendrán el tipo detectado automáticamente al crearse
