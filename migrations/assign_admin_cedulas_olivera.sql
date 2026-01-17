-- Migración: Asignar rol Admin Cedulas a oliverarodrigo86@gmail.com
-- Ejecutar este SQL en Supabase SQL Editor DESPUÉS de ejecutar add_admin_cedulas.sql

-- 1. Verificar que el campo is_admin_cedulas existe (si no existe, ejecutar add_admin_cedulas.sql primero)
-- ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS is_admin_cedulas BOOLEAN DEFAULT FALSE;

-- 2. Buscar el usuario por email
DO $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Obtener el ID del usuario por email
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = 'oliverarodrigo86@gmail.com';

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'Usuario oliverarodrigo86@gmail.com no encontrado';
    RETURN;
  END IF;

  -- Asegurar que existe un registro en user_roles
  INSERT INTO user_roles (user_id, is_superadmin, is_admin_expedientes, is_admin_cedulas, is_abogado)
  VALUES (v_user_id, FALSE, FALSE, TRUE, FALSE)
  ON CONFLICT (user_id) 
  DO UPDATE SET 
    is_admin_cedulas = TRUE;

  RAISE NOTICE 'Rol Admin Cedulas asignado correctamente a oliverarodrigo86@gmail.com (user_id: %)', v_user_id;

END $$;

-- 3. Verificar la asignación
SELECT 
  u.email,
  u.id as user_id,
  ur.is_superadmin,
  ur.is_admin_expedientes,
  ur.is_admin_cedulas,
  ur.is_abogado
FROM auth.users u
LEFT JOIN user_roles ur ON u.id = ur.user_id
WHERE u.email = 'oliverarodrigo86@gmail.com';
