-- Migración: Agregar rol ABOGADO, tabla user_juzgados y columna created_by_user_id
-- Ejecutar este SQL en Supabase SQL Editor

-- 1. Agregar campo is_abogado a user_roles
ALTER TABLE user_roles
ADD COLUMN IF NOT EXISTS is_abogado BOOLEAN DEFAULT FALSE;

-- 2. Crear función RPC para verificar si es abogado
CREATE OR REPLACE FUNCTION is_abogado()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_result BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN FALSE;
  END IF;
  
  SELECT COALESCE(ur.is_abogado, FALSE) INTO v_result
  FROM user_roles ur
  WHERE ur.user_id = v_user_id;
  
  RETURN COALESCE(v_result, FALSE);
END;
$$;

-- 3. Crear tabla user_juzgados para almacenar juzgados asignados a usuarios
CREATE TABLE IF NOT EXISTS user_juzgados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  juzgado VARCHAR(200) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, juzgado)
);

-- 4. Crear índices para mejor rendimiento
CREATE INDEX IF NOT EXISTS idx_user_juzgados_user_id ON user_juzgados(user_id);
CREATE INDEX IF NOT EXISTS idx_user_juzgados_juzgado ON user_juzgados(juzgado);

-- 5. Habilitar RLS (Row Level Security)
ALTER TABLE user_juzgados ENABLE ROW LEVEL SECURITY;

-- 6. Política: los usuarios solo pueden ver sus propios juzgados asignados
CREATE POLICY "Users can view their own juzgados"
  ON user_juzgados FOR SELECT
  USING (auth.uid() = user_id);

-- 7. Política: SuperAdmin puede ver todos los juzgados asignados
CREATE POLICY "SuperAdmin can view all juzgados"
  ON user_juzgados FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_roles.user_id = auth.uid() 
      AND user_roles.is_superadmin = TRUE
    )
  );

-- 8. Política: SuperAdmin puede insertar/actualizar/eliminar juzgados
CREATE POLICY "SuperAdmin can manage juzgados"
  ON user_juzgados FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_roles.user_id = auth.uid() 
      AND user_roles.is_superadmin = TRUE
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_roles.user_id = auth.uid() 
      AND user_roles.is_superadmin = TRUE
    )
  );

-- 9. Agregar columna created_by_user_id a expedientes
ALTER TABLE expedientes
ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 10. Crear índice para created_by_user_id
CREATE INDEX IF NOT EXISTS idx_expedientes_created_by_user_id ON expedientes(created_by_user_id);

-- 11. Crear índice para juzgado en expedientes (si no existe)
CREATE INDEX IF NOT EXISTS idx_expedientes_juzgado ON expedientes(juzgado);

-- 12. Actualizar política RLS: ABOGADO puede ver expedientes de sus juzgados asignados
CREATE POLICY "Abogado can view expedientes for assigned juzgados"
  ON expedientes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN user_juzgados uj ON uj.user_id = ur.user_id
      WHERE ur.user_id = auth.uid()
      AND ur.is_abogado = TRUE
      AND uj.juzgado = expedientes.juzgado
    )
  );

-- 13. Actualizar política: Admin Expedientes puede ver todos los expedientes
CREATE POLICY "Admin Expedientes can view all expedientes"
  ON expedientes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_roles.user_id = auth.uid() 
      AND user_roles.is_admin_expedientes = TRUE
    )
  );

-- 14. Actualizar política: Admin Expedientes puede insertar expedientes
CREATE POLICY "Admin Expedientes can insert expedientes"
  ON expedientes FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_roles.user_id = auth.uid() 
      AND user_roles.is_admin_expedientes = TRUE
    )
  );

-- 15. Actualizar política: Admin Expedientes puede actualizar expedientes
CREATE POLICY "Admin Expedientes can update expedientes"
  ON expedientes FOR UPDATE
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

-- Comentario: 
-- - Los usuarios con is_abogado = TRUE pueden ver expedientes para sus juzgados asignados
-- - Los usuarios con is_admin_expedientes = TRUE pueden gestionar todos los expedientes
-- - Los usuarios con is_superadmin = TRUE pueden ver y gestionar todo
-- - La columna created_by_user_id rastrea quién creó cada expediente
