-- Migración: Agregar columna notas a la tabla cedulas
-- Ejecutar este SQL en Supabase SQL Editor
--
-- Este campo permite a los usuarios agregar notas personales sobre cédulas/oficios
-- para mencionar a otros colaboradores o dejarse notas a sí mismos

-- 1. Agregar columna notas (puede ser NULL para cédulas existentes)
ALTER TABLE cedulas 
ADD COLUMN IF NOT EXISTS notas TEXT DEFAULT NULL;

-- 2. Crear índice para búsquedas rápidas por notas (opcional pero recomendado)
CREATE INDEX IF NOT EXISTS idx_cedulas_notas ON cedulas(notas) WHERE notas IS NOT NULL;

-- 3. Comentario en la columna
COMMENT ON COLUMN cedulas.notas IS 'Notas editables con soporte para menciones (@username) que generan notificaciones';

-- 4. Políticas RLS para UPDATE de notas
-- Los usuarios pueden actualizar sus propias cédulas
-- Admin Cédulas y Admin Expedientes pueden actualizar todas las cédulas

-- Eliminar políticas de UPDATE si existen (para hacer la migración idempotente)
DROP POLICY IF EXISTS "Users can update their own cedulas" ON cedulas;
DROP POLICY IF EXISTS "Admin Cédulas can update all cedulas" ON cedulas;
DROP POLICY IF EXISTS "Admin Expedientes can update all cedulas" ON cedulas;

-- Política: Usuarios pueden actualizar sus propias cédulas
CREATE POLICY "Users can update their own cedulas"
  ON cedulas FOR UPDATE
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

-- Política: Admin Cédulas puede actualizar todas las cédulas
CREATE POLICY "Admin Cédulas can update all cedulas"
  ON cedulas FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_roles.user_id = auth.uid() 
      AND user_roles.is_admin_cedulas = TRUE
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_roles.user_id = auth.uid() 
      AND user_roles.is_admin_cedulas = TRUE
    )
  );

-- Política: Admin Expedientes puede actualizar todas las cédulas
CREATE POLICY "Admin Expedientes can update all cedulas"
  ON cedulas FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_roles.user_id = auth.uid() 
      AND user_roles.is_admin_expedientes = TRUE
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_roles.user_id = auth.uid() 
      AND user_roles.is_admin_expedientes = TRUE
    )
  );

-- 5. Verificar que la columna se creó correctamente
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'cedulas' 
    AND column_name = 'notas'
  ) THEN
    RAISE EXCEPTION 'Error: La columna notas no se pudo crear';
  END IF;
END $$;

-- Comentario final:
-- - Los usuarios normales pueden actualizar solo sus propias cédulas
-- - Admin Cédulas y Admin Expedientes pueden actualizar todas las cédulas
-- - Las cédulas existentes tendrán notas = NULL
-- - Los usuarios pueden agregar notas desde la UI de "Mis Cédulas/Oficios"
