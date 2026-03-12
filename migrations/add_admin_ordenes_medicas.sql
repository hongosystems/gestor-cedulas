-- Migración: Rol is_admin_ordenes_medicas
-- Permite ver TODAS las órdenes en Órdenes/Seguimiento sin ser admin de expedientes.
-- No afecta select-role (solo se consideran: superadmin, admin_expedientes, admin_cedulas, abogado).

-- 1. Agregar columna a user_roles
ALTER TABLE user_roles
ADD COLUMN IF NOT EXISTS is_admin_ordenes_medicas BOOLEAN DEFAULT FALSE;

-- 2. Asignar a Andrea: puede ver todas las órdenes, SIN is_admin_expedientes (evita select-role)
DO $$
DECLARE
  v_user_id UUID;
  v_email TEXT := 'andreaestudio24@gmail.com';
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = v_email
  LIMIT 1;

  IF v_user_id IS NOT NULL THEN
    INSERT INTO user_roles (user_id, is_superadmin, is_admin_expedientes, is_admin_ordenes_medicas)
    VALUES (v_user_id, FALSE, FALSE, TRUE)
    ON CONFLICT (user_id)
    DO UPDATE SET
      is_admin_expedientes = FALSE,
      is_admin_ordenes_medicas = TRUE;

    RAISE NOTICE '✅ Andrea (%) - is_admin_ordenes_medicas=TRUE, is_admin_expedientes=FALSE', v_email;
  ELSE
    RAISE NOTICE '⚠️ Usuario % no encontrado.', v_email;
  END IF;
END $$;
