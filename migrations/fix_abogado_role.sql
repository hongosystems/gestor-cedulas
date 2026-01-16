-- Script para verificar y corregir el rol de ABOGADO
-- Ejecutar este SQL en Supabase SQL Editor

-- 1. Verificar si la columna is_abogado existe
DO $$
BEGIN
  -- Intentar agregar la columna si no existe
  ALTER TABLE user_roles
  ADD COLUMN IF NOT EXISTS is_abogado BOOLEAN DEFAULT FALSE;
  
  RAISE NOTICE '✅ Columna is_abogado verificada/creada';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE '⚠️ Error al verificar columna: %', SQLERRM;
END $$;

-- 2. Verificar estado actual del usuario abogado@gmail.com
SELECT
  u.email,
  u.id,
  COALESCE(ur.is_superadmin, FALSE) as is_superadmin,
  COALESCE(ur.is_admin_expedientes, FALSE) as is_admin_expedientes,
  COALESCE(ur.is_abogado, FALSE) as is_abogado,
  p.full_name,
  p.must_change_password
FROM auth.users u
LEFT JOIN user_roles ur ON u.id = ur.user_id
LEFT JOIN profiles p ON u.id = p.id
WHERE u.email = 'abogado@gmail.com';

-- 3. Asignar rol ABOGADO al usuario
DO $$
DECLARE
  v_user_id UUID;
  v_email TEXT := 'abogado@gmail.com';
BEGIN
  -- Buscar el user_id por email
  SELECT id
  INTO v_user_id
  FROM auth.users
  WHERE email = v_email
  LIMIT 1;

  IF v_user_id IS NOT NULL THEN
    -- Asegurar que existe un registro en user_roles
    INSERT INTO user_roles (user_id, is_superadmin, is_admin_expedientes, is_abogado)
    VALUES (v_user_id, FALSE, FALSE, TRUE)
    ON CONFLICT (user_id)
    DO UPDATE SET 
      is_superadmin = FALSE,
      is_admin_expedientes = FALSE,
      is_abogado = TRUE;

    -- Actualizar perfil si no existe
    INSERT INTO profiles (id, email, full_name, must_change_password)
    VALUES (v_user_id, v_email, 'Usuario Abogado', TRUE)
    ON CONFLICT (id) 
    DO UPDATE SET 
      email = v_email,
      full_name = COALESCE(profiles.full_name, 'Usuario Abogado'),
      must_change_password = COALESCE(profiles.must_change_password, TRUE);

    RAISE NOTICE '✅ Rol ABOGADO asignado correctamente para usuario % (ID: %)', v_email, v_user_id;
  ELSE
    RAISE NOTICE '⚠️ Usuario % no encontrado en auth.users. Por favor verifica que el usuario existe.', v_email;
  END IF;
END $$;

-- 4. Verificar nuevamente después de la actualización
SELECT
  u.email,
  u.id,
  COALESCE(ur.is_superadmin, FALSE) as is_superadmin,
  COALESCE(ur.is_admin_expedientes, FALSE) as is_admin_expedientes,
  COALESCE(ur.is_abogado, FALSE) as is_abogado,
  CASE
    WHEN COALESCE(ur.is_abogado, FALSE) = TRUE THEN '✅ Abogado (CORRECTO)'
    WHEN COALESCE(ur.is_admin_expedientes, FALSE) = TRUE THEN '⚠️ Admin Expedientes'
    WHEN COALESCE(ur.is_superadmin, FALSE) = TRUE THEN '⚠️ SuperAdmin'
    ELSE '❌ Sin rol asignado (INCORRECTO)'
  END as estado_rol,
  p.full_name
FROM auth.users u
LEFT JOIN user_roles ur ON u.id = ur.user_id
LEFT JOIN profiles p ON u.id = p.id
WHERE u.email = 'abogado@gmail.com';

-- 5. Si hay error, verificar estructura de la tabla user_roles
SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'user_roles'
  AND column_name IN ('is_superadmin', 'is_admin_expedientes', 'is_abogado')
ORDER BY column_name;
