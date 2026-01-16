-- Migración: Asegurar que SUPERADMIN pueda ver TODOS los datos (expedientes, cédulas, oficios)
-- incluso si también tiene rol de ABOGADO
-- Ejecutar este SQL en Supabase SQL Editor

-- ============================================
-- EXPEDIENTES
-- ============================================

-- 1. Eliminar política existente de SUPERADMIN si existe
DROP POLICY IF EXISTS "SuperAdmin can view all expedientes" ON expedientes;

-- 2. Crear política para SUPERADMIN que permita ver TODOS los expedientes
-- Esta política tiene prioridad sobre las políticas de ABOGADO
CREATE POLICY "SuperAdmin can view all expedientes"
  ON expedientes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_roles.user_id = auth.uid() 
      AND user_roles.is_superadmin = TRUE
    )
  );

-- ============================================
-- CÉDULAS
-- ============================================

-- 3. Eliminar política existente de SUPERADMIN si existe
DROP POLICY IF EXISTS "SuperAdmin can view all cedulas" ON cedulas;

-- 4. Crear política para SUPERADMIN que permita ver TODAS las cédulas
-- Esta política tiene prioridad sobre las políticas de ABOGADO
CREATE POLICY "SuperAdmin can view all cedulas"
  ON cedulas FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_roles.user_id = auth.uid() 
      AND user_roles.is_superadmin = TRUE
    )
  );

-- ============================================
-- VERIFICACIÓN
-- ============================================

-- Comentario importante:
-- - Las políticas RLS se evalúan con OR, por lo que si CUALQUIERA permite el acceso, el usuario puede ver el registro
-- - Si un usuario es SUPERADMIN (incluso si también es ABOGADO), estas políticas permitirán ver TODOS los registros
-- - Las políticas de ABOGADO seguirán funcionando para usuarios que SOLO son ABOGADO (sin SUPERADMIN)
-- - Las políticas de SUPERADMIN tienen prioridad porque se evalúan primero y permiten acceso sin restricciones

-- Para verificar que las políticas están activas:
-- SELECT * FROM pg_policies WHERE tablename IN ('expedientes', 'cedulas') AND policyname LIKE '%SuperAdmin%';
