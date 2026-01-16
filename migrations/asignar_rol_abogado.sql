-- Script para asignar rol ABOGADO a abogado@gmail.com
-- Ejecutar este SQL en Supabase SQL Editor

-- 1. Verificar que el usuario existe en auth.users
SELECT 
  id,
  email,
  created_at,
  email_confirmed_at
FROM auth.users
WHERE email = 'abogado@gmail.com';

-- 2. Verificar estado actual en user_roles
SELECT
  ur.user_id,
  ur.is_superadmin,
  ur.is_admin_expedientes,
  ur.is_abogado,
  u.email
FROM user_roles ur
JOIN auth.users u ON u.id = ur.user_id
WHERE u.email = 'abogado@gmail.com';

-- 3. Asignar rol ABOGADO (método robusto)
DO $$
DECLARE
  v_user_id UUID;
  v_email TEXT := 'abogado@gmail.com';
  v_exists BOOLEAN;
BEGIN
  -- Buscar el user_id
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = v_email
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario % no encontrado en auth.users. Por favor crea el usuario primero.', v_email;
  END IF;

  RAISE NOTICE 'Usuario encontrado: % (ID: %)', v_email, v_user_id;

  -- Verificar si ya existe un registro en user_roles
  SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id = v_user_id) INTO v_exists;

  IF v_exists THEN
    -- Actualizar el registro existente (ABOGADO tiene también SUPERADMIN y EXPEDIENTES)
    UPDATE user_roles
    SET 
      is_superadmin = TRUE,
      is_admin_expedientes = TRUE,
      is_abogado = TRUE
    WHERE user_id = v_user_id;
    
    RAISE NOTICE '✅ Rol actualizado: is_abogado = TRUE, is_superadmin = TRUE, is_admin_expedientes = TRUE para usuario %', v_email;
  ELSE
    -- Insertar nuevo registro (ABOGADO tiene también SUPERADMIN y EXPEDIENTES)
    INSERT INTO user_roles (user_id, is_superadmin, is_admin_expedientes, is_abogado)
    VALUES (v_user_id, TRUE, TRUE, TRUE);
    
    RAISE NOTICE '✅ Rol insertado: is_abogado = TRUE, is_superadmin = TRUE, is_admin_expedientes = TRUE para usuario %', v_email;
  END IF;

  -- Asegurar que el perfil existe
  INSERT INTO profiles (id, email, full_name, must_change_password)
  VALUES (v_user_id, v_email, 'Usuario Abogado', TRUE)
  ON CONFLICT (id) 
  DO UPDATE SET 
    email = v_email,
    full_name = COALESCE(profiles.full_name, 'Usuario Abogado');

  RAISE NOTICE '✅ Perfil verificado/actualizado para usuario %', v_email;

EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE '❌ Error: %', SQLERRM;
    RAISE;
END $$;

-- 4. Verificar resultado final
SELECT
  u.email,
  u.id as user_id,
  COALESCE(ur.is_superadmin, FALSE) as is_superadmin,
  COALESCE(ur.is_admin_expedientes, FALSE) as is_admin_expedientes,
  COALESCE(ur.is_abogado, FALSE) as is_abogado,
  CASE
    WHEN COALESCE(ur.is_abogado, FALSE) = TRUE THEN '✅ Abogado (CORRECTO)'
    WHEN COALESCE(ur.is_admin_expedientes, FALSE) = TRUE THEN '⚠️ Admin Expedientes'
    WHEN COALESCE(ur.is_superadmin, FALSE) = TRUE THEN '⚠️ SuperAdmin'
    WHEN ur.user_id IS NULL THEN '❌ Sin registro en user_roles'
    ELSE '❌ Sin rol asignado'
  END as estado_rol,
  p.full_name
FROM auth.users u
LEFT JOIN user_roles ur ON u.id = ur.user_id
LEFT JOIN profiles p ON u.id = p.id
WHERE u.email = 'abogado@gmail.com';

-- 5. Si aún no funciona, intentar método alternativo directo
-- (Descomentar solo si el método anterior falla)
/*
UPDATE user_roles
SET is_abogado = TRUE,
    is_superadmin = FALSE,
    is_admin_expedientes = FALSE
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'abogado@gmail.com');
*/
