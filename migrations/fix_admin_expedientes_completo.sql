-- Script completo para configurar Admin Expedientes
-- Ejecutar TODO este SQL en Supabase SQL Editor

-- ============================================
-- 1. Asegurar que el campo existe en user_roles
-- ============================================
ALTER TABLE user_roles
ADD COLUMN IF NOT EXISTS is_admin_expedientes BOOLEAN DEFAULT FALSE;

-- ============================================
-- 2. Crear/Actualizar la función RPC is_admin_expedientes
-- ============================================
CREATE OR REPLACE FUNCTION is_admin_expedientes()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_result BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RETURN FALSE;
  END IF;
  
  SELECT COALESCE(ur.is_admin_expedientes, FALSE) INTO v_result
  FROM user_roles ur
  WHERE ur.user_id = v_user_id;
  
  RETURN COALESCE(v_result, FALSE);
END;
$$;

-- ============================================
-- 3. Verificar y corregir el rol del usuario expedientes@gmail.com
-- ============================================
DO $$
DECLARE
  v_user_id UUID;
  v_email TEXT := 'expedientes@gmail.com';
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = v_email
  LIMIT 1;

  IF v_user_id IS NOT NULL THEN
    -- Asegurar que el registro existe en user_roles
    INSERT INTO user_roles (user_id, is_superadmin, is_admin_expedientes)
    VALUES (v_user_id, FALSE, TRUE)
    ON CONFLICT (user_id)
    DO UPDATE SET 
      is_superadmin = FALSE,
      is_admin_expedientes = TRUE;

    RAISE NOTICE '✅ Usuario % configurado correctamente. ID: %, is_admin_expedientes=TRUE', v_email, v_user_id;
  ELSE
    RAISE NOTICE '⚠️ Usuario % no encontrado. Debes crearlo primero con el script Node.js.', v_email;
  END IF;
END $$;

-- ============================================
-- 4. Verificación final - Mostrar el estado
-- ============================================
SELECT 
  u.email,
  u.id as user_id,
  COALESCE(ur.is_superadmin, FALSE) as is_superadmin,
  COALESCE(ur.is_admin_expedientes, FALSE) as is_admin_expedientes,
  CASE 
    WHEN COALESCE(ur.is_admin_expedientes, FALSE) = TRUE THEN '✅ Admin Expedientes (CORRECTO)'
    WHEN COALESCE(ur.is_superadmin, FALSE) = TRUE THEN '⚠️ SuperAdmin (INCORRECTO para este usuario)'
    ELSE '❌ Sin rol o Admin Regular (INCORRECTO)'
  END as estado_rol,
  p.full_name,
  p.must_change_password
FROM auth.users u
LEFT JOIN user_roles ur ON u.id = ur.user_id
LEFT JOIN profiles p ON u.id = p.id
WHERE u.email = 'expedientes@gmail.com';

-- ============================================
-- 5. Probar la función RPC (esto solo funcionará si estás autenticado como ese usuario)
-- ============================================
-- Descomentar la siguiente línea solo si estás autenticado como expedientes@gmail.com
-- SELECT is_admin_expedientes() as resultado_prueba;
