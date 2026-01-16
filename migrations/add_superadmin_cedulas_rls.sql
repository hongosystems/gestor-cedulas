-- Migración: Agregar política RLS para que SUPERADMIN pueda ver todas las cédulas
-- Ejecutar este SQL en Supabase SQL Editor

-- 1. Crear política para SUPERADMIN que permita ver todas las cédulas
DROP POLICY IF EXISTS "SuperAdmin can view all cedulas" ON cedulas;

CREATE POLICY "SuperAdmin can view all cedulas"
  ON cedulas FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_roles.user_id = auth.uid() 
      AND user_roles.is_superadmin = TRUE
    )
  );

-- Comentario:
-- - Los usuarios con is_superadmin = TRUE ahora pueden ver TODAS las cédulas sin restricciones
-- - Esta política se evalúa con OR junto con las otras políticas (ABOGADO, ADMIN_EXPEDIENTES, etc.)
-- - Si un usuario es SUPERADMIN, podrá ver todas las cédulas independientemente de sus juzgados asignados
