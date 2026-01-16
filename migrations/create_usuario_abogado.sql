-- Script para crear y configurar usuario ABOGADO (abogado@gmail.com)
-- IMPORTANTE: Primero debes crear el usuario en Supabase Auth Dashboard
-- O usar el script Node.js: node scripts/create_users.mjs
--
-- Si el usuario ya existe, esta query configurará el perfil y rol automáticamente.

-- 0. Asegurar que la columna is_abogado existe en user_roles
ALTER TABLE user_roles
ADD COLUMN IF NOT EXISTS is_abogado BOOLEAN DEFAULT FALSE;

-- 1. Verificar el estado actual del usuario (si existe)
-- Nota: Si la columna is_abogado no existe aún, esta query puede fallar.
-- En ese caso, ejecuta primero: migrations/add_abogado_role_and_juzgados.sql
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

-- 2. Crear/actualizar perfil y asignar rol ABOGADO
DO $$
DECLARE
  v_user_id UUID;
  v_email TEXT := 'abogado@gmail.com';
BEGIN
  -- Buscar si el usuario ya existe en auth.users
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = v_email
  LIMIT 1;

  -- Si el usuario existe, configurar perfil y rol
  IF v_user_id IS NOT NULL THEN
    -- Insertar o actualizar el perfil
    INSERT INTO profiles (id, email, full_name, must_change_password)
    VALUES (v_user_id, v_email, 'Usuario Abogado', TRUE)
    ON CONFLICT (id) 
    DO UPDATE SET 
      email = v_email,
      full_name = 'Usuario Abogado',
      must_change_password = TRUE;

    -- Insertar o actualizar el rol (asegurar que is_abogado = TRUE)
    INSERT INTO user_roles (user_id, is_superadmin, is_admin_expedientes, is_abogado)
    VALUES (v_user_id, FALSE, FALSE, TRUE)
    ON CONFLICT (user_id)
    DO UPDATE SET 
      is_superadmin = FALSE,
      is_admin_expedientes = FALSE,
      is_abogado = TRUE;

    RAISE NOTICE '✅ Usuario % configurado correctamente con ID: %. Rol: ABOGADO', v_email, v_user_id;
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
  COALESCE(ur.is_abogado, FALSE) as is_abogado,
  CASE
    WHEN COALESCE(ur.is_abogado, FALSE) = TRUE THEN '✅ Abogado (CORRECTO)'
    WHEN COALESCE(ur.is_admin_expedientes, FALSE) = TRUE THEN '⚠️ Admin Expedientes'
    WHEN COALESCE(ur.is_superadmin, FALSE) = TRUE THEN '⚠️ SuperAdmin'
    ELSE '❌ Sin rol o Admin Regular (INCORRECTO)'
  END as estado_rol,
  p.full_name
FROM auth.users u
LEFT JOIN user_roles ur ON u.id = ur.user_id
LEFT JOIN profiles p ON u.id = p.id
WHERE u.email = 'abogado@gmail.com';

-- 4. Asignar todos los juzgados al usuario abogado@gmail.com
DO $$
DECLARE
  v_user_id UUID;
  v_juzgados TEXT[] := ARRAY[
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°91',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°90',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°44',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°18',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°70',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°96',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°98',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°69',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°99',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°52',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°47',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°94',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°57',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°59',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°60',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°46',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°101',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°107',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°79',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°62',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°13',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°39',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°54',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°80',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°65',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°27',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°89',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°14',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°95',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°22',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°20',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°105',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°108',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°29',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°103',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°109',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°104',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°2',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°40',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°64',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°50',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°36',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°41',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°37',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°31',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°67',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°72',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°34',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°51',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°49',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°42',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°43',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°71',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°48',
    'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N°68'
  ];
  v_juzgado TEXT;
  v_count INTEGER := 0;
BEGIN
  -- Obtener el user_id del usuario abogado@gmail.com
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = 'abogado@gmail.com'
  LIMIT 1;

  IF v_user_id IS NOT NULL THEN
    -- Insertar cada juzgado (evitando duplicados con ON CONFLICT)
    FOREACH v_juzgado IN ARRAY v_juzgados
    LOOP
      INSERT INTO user_juzgados (user_id, juzgado)
      VALUES (v_user_id, v_juzgado)
      ON CONFLICT (user_id, juzgado) DO NOTHING;
      
      IF FOUND THEN
        v_count := v_count + 1;
      END IF;
    END LOOP;

    RAISE NOTICE '✅ Asignados % juzgados al usuario abogado@gmail.com (ID: %)', array_length(v_juzgados, 1), v_user_id;
  ELSE
    RAISE NOTICE '⚠️ Usuario abogado@gmail.com no encontrado. Ejecuta primero la sección 2 de este script.';
  END IF;
END $$;

-- 5. Verificar juzgados asignados
SELECT
  u.email,
  uj.juzgado,
  uj.created_at
FROM auth.users u
JOIN user_juzgados uj ON u.id = uj.user_id
WHERE u.email = 'abogado@gmail.com'
ORDER BY uj.juzgado;
