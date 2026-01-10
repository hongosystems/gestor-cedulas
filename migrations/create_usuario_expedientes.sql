-- Query para crear y configurar usuario Admin Expedientes
-- IMPORTANTE: Primero debes crear el usuario en Supabase Auth Dashboard
-- O usar el script Node.js: node scripts/create_users.mjs
--
-- Si el usuario ya existe, esta query configurará el perfil y rol automáticamente.

-- Paso 1: Obtener el user_id del usuario (si ya existe)
DO $$
DECLARE
  v_user_id UUID;
  v_email TEXT := 'expedientes@gmail.com';
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
    VALUES (v_user_id, v_email, 'Usuario Expedientes', TRUE)
    ON CONFLICT (id) 
    DO UPDATE SET 
      email = v_email,
      full_name = 'Usuario Expedientes',
      must_change_password = TRUE;

    -- Insertar o actualizar el rol
    INSERT INTO user_roles (user_id, is_superadmin, is_admin_expedientes)
    VALUES (v_user_id, FALSE, TRUE)
    ON CONFLICT (user_id)
    DO UPDATE SET 
      is_superadmin = FALSE,
      is_admin_expedientes = TRUE;

    RAISE NOTICE 'Usuario % configurado correctamente con ID: %', v_email, v_user_id;
  ELSE
    RAISE NOTICE 'Usuario % no encontrado en auth.users. Por favor crea el usuario primero desde Supabase Auth Dashboard o ejecuta: node scripts/create_users.mjs', v_email;
  END IF;
END $$;
