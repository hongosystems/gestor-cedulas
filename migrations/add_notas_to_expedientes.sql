-- Migración: Agregar campo notas a las tablas expedientes y pjn_favoritos
-- Ejecutar este SQL en Supabase SQL Editor
--
-- Este campo permite a los abogados agregar notas personales sobre expedientes
-- para mencionar a otros colaboradores o dejarse notas a sí mismos

-- Agregar columna notas a expedientes (puede ser NULL para expedientes existentes)
ALTER TABLE expedientes 
ADD COLUMN IF NOT EXISTS notas TEXT DEFAULT NULL;

-- Crear índice para búsquedas rápidas por notas en expedientes (opcional pero recomendado)
CREATE INDEX IF NOT EXISTS idx_expedientes_notas ON expedientes(notas) WHERE notas IS NOT NULL;

-- Agregar columna notas a pjn_favoritos (puede ser NULL para favoritos existentes)
ALTER TABLE pjn_favoritos 
ADD COLUMN IF NOT EXISTS notas TEXT DEFAULT NULL;

-- Crear índice para búsquedas rápidas por notas en pjn_favoritos (opcional pero recomendado)
CREATE INDEX IF NOT EXISTS idx_pjn_favoritos_notas ON pjn_favoritos(notas) WHERE notas IS NOT NULL;

-- IMPORTANTE: Verificar y actualizar políticas RLS si es necesario
-- Si pjn_favoritos tiene RLS habilitado, asegurarse de que los usuarios autenticados puedan actualizar
-- Eliminar política de UPDATE si existe (para hacer la migración idempotente)
DROP POLICY IF EXISTS "Authenticated users can update pjn_favoritos notas" ON pjn_favoritos;
DROP POLICY IF EXISTS "Authenticated users can update pjn_favoritos" ON pjn_favoritos;

-- Crear política de UPDATE para usuarios autenticados
-- Esta política permite a los usuarios autenticados actualizar cualquier campo de pjn_favoritos
CREATE POLICY "Authenticated users can update pjn_favoritos"
  ON pjn_favoritos FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Comentario: Los expedientes y favoritos existentes tendrán notas = NULL
-- Los abogados pueden agregar notas desde la UI de "Mis Juzgados"
