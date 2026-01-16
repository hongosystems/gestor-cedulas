-- Migración: Corregir políticas RLS para que ABOGADO pueda ver expedientes de otros usuarios cuando coincida el juzgado
-- Ejecutar este SQL en Supabase SQL Editor

-- 1. Eliminar la política restrictiva "Users can view their own expedientes" si existe
--    (pero mantenerla si el usuario no es ABOGADO ni ADMIN_EXPEDIENTES)
DROP POLICY IF EXISTS "Users can view their own expedientes" ON expedientes;

-- 2. Crear nueva política que permita a usuarios normales ver solo sus propios expedientes
--    PERO si es ABOGADO o ADMIN_EXPEDIENTES, las otras políticas aplicarán
CREATE POLICY "Users can view their own expedientes"
  ON expedientes FOR SELECT
  USING (
    -- Si es dueño del expediente, puede verlo
    owner_user_id = auth.uid()
    OR
    -- Si NO es ABOGADO ni ADMIN_EXPEDIENTES, solo puede ver los propios (la otra condición ya lo permite)
    NOT (
      EXISTS (
        SELECT 1 FROM user_roles 
        WHERE user_roles.user_id = auth.uid() 
        AND (user_roles.is_abogado = TRUE OR user_roles.is_admin_expedientes = TRUE)
      )
    )
  );

-- 3. Verificar que la política de ABOGADO permite ver expedientes de otros usuarios
--    (esta ya debería existir, pero la verificamos)
-- La política "Abogado can view expedientes for assigned juzgados" ya permite esto
-- pero necesitamos asegurarnos de que no hay conflicto con otras políticas

-- 4. Crear política similar para cédulas: ABOGADO puede ver cédulas de otros usuarios cuando coincida el juzgado
DROP POLICY IF EXISTS "Abogado can view cedulas for assigned juzgados" ON cedulas;

CREATE POLICY "Abogado can view cedulas for assigned juzgados"
  ON cedulas FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN user_juzgados uj ON uj.user_id = ur.user_id
      WHERE ur.user_id = auth.uid()
      AND ur.is_abogado = TRUE
      AND uj.juzgado = cedulas.juzgado
    )
  );

-- 5. Crear política para ADMIN_EXPEDIENTES para ver todas las cédulas
DROP POLICY IF EXISTS "Admin Expedientes can view all cedulas" ON cedulas;

CREATE POLICY "Admin Expedientes can view all cedulas"
  ON cedulas FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_roles.user_id = auth.uid() 
      AND user_roles.is_admin_expedientes = TRUE
    )
  );

-- 6. Actualizar política para usuarios normales de cédulas (solo ver sus propias cédulas)
DROP POLICY IF EXISTS "Users can view their own cedulas" ON cedulas;

CREATE POLICY "Users can view their own cedulas"
  ON cedulas FOR SELECT
  USING (
    -- Si es dueño de la cédula, puede verla
    owner_user_id = auth.uid()
    OR
    -- Si NO es ABOGADO ni ADMIN_EXPEDIENTES, solo puede ver las propias
    NOT (
      EXISTS (
        SELECT 1 FROM user_roles 
        WHERE user_roles.user_id = auth.uid() 
        AND (user_roles.is_abogado = TRUE OR user_roles.is_admin_expedientes = TRUE)
      )
    )
  );

-- Comentario:
-- - Los usuarios ABOGADO ahora pueden ver expedientes y cédulas de OTROS usuarios si el juzgado coincide
-- - Los usuarios ADMIN_EXPEDIENTES pueden ver todos los expedientes y cédulas
-- - Los usuarios normales solo pueden ver sus propios expedientes y cédulas
-- - Las políticas se evalúan con OR, por lo que si alguna aplica, el usuario puede ver el registro
