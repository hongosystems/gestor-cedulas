-- Migración: Agregar rol Admin Cedulas
-- Ejecutar este SQL en Supabase SQL Editor
-- Los usuarios con este rol pueden gestionar cédulas/oficios en la sección "Mis Cédulas"

-- 1. Agregar campo is_admin_cedulas a user_roles
ALTER TABLE user_roles
ADD COLUMN IF NOT EXISTS is_admin_cedulas BOOLEAN DEFAULT FALSE;

-- 2. Crear función RPC para verificar si es admin_cedulas
CREATE OR REPLACE FUNCTION is_admin_cedulas()
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
  
  SELECT COALESCE(ur.is_admin_cedulas, FALSE) INTO v_result
  FROM user_roles ur
  WHERE ur.user_id = v_user_id;
  
  RETURN COALESCE(v_result, FALSE);
END;
$$;

-- 3. Comentario: Los usuarios con is_admin_cedulas = TRUE pueden gestionar cédulas/oficios
-- Este rol es para usuarios que solo manejan la sección "Mis Cédulas/Oficios" (/app)
-- Tienen acceso similar a los usuarios regulares pero con rol explícito para facilitar gestión
