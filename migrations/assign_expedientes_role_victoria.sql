-- Script para asignar rol de usuario de expedientes a victoria.estudiohisi@gmail.com
-- Ejecutar este SQL en Supabase SQL Editor

-- 1. Verificar el estado actual del usuario
SELECT
  u.email,
  u.id,
  COALESCE(ur.is_superadmin, FALSE) as is_superadmin,
  COALESCE(ur.is_admin_expedientes, FALSE) as is_admin_expedientes,
  p.full_name,
  p.must_change_password
FROM auth.users u
LEFT JOIN user_roles ur ON u.id = ur.user_id
LEFT JOIN profiles p ON u.id = p.id
WHERE u.email = 'victoria.estudiohisi@gmail.com';

-- 2. Asignar/actualizar el rol de admin_expedientes
DO $$
DECLARE
  v_user_id UUID;
  v_email TEXT := 'victoria.estudiohisi@gmail.com';
BEGIN
  -- Buscar el user_id por email
  SELECT id
  INTO v_user_id
  FROM auth.users
  WHERE email = v_email
  LIMIT 1;

  IF v_user_id IS NOT NULL THEN
    -- Insertar o actualizar el rol (asegurar que is_admin_expedientes = TRUE)
    INSERT INTO user_roles (user_id, is_superadmin, is_admin_expedientes)
    VALUES (v_user_id, FALSE, TRUE)
    ON CONFLICT (user_id)
    DO UPDATE SET
      is_superadmin = FALSE,
      is_admin_expedientes = TRUE;

    RAISE NOTICE '✅ Rol asignado correctamente para usuario % (ID: %). is_admin_expedientes=TRUE', v_email, v_user_id;
  ELSE
    RAISE NOTICE '⚠️ Usuario % no encontrado en auth.users. Por favor crea el usuario primero desde Supabase Auth Dashboard o ejecuta: node scripts/create_users.mjs', v_email;
  END IF;
END $$;

-- 3. Verificar nuevamente después de la actualización
SELECT
  u.email,
  u.id,
  COALESCE(ur.is_superadmin, FALSE) as is_superadmin,
  COALESCE(ur.is_admin_expedientes, FALSE) as is_admin_expedientes,
  CASE
    WHEN COALESCE(ur.is_admin_expedientes, FALSE) = TRUE THEN '✅ Admin Expedientes (CORRECTO)'
    WHEN COALESCE(ur.is_superadmin, FALSE) = TRUE THEN '⚠️ SuperAdmin'
    ELSE '❌ Sin rol o Admin Regular (INCORRECTO)'
  END as estado_rol,
  p.full_name
FROM auth.users u
LEFT JOIN user_roles ur ON u.id = ur.user_id
LEFT JOIN profiles p ON u.id = p.id
WHERE u.email = 'victoria.estudiohisi@gmail.com';
