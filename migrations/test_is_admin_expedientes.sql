-- Query para probar la función is_admin_expedientes
-- Ejecutar este SQL en Supabase SQL Editor para verificar que la función funciona

-- Opción 1: Probar con el usuario actualmente autenticado (si estás en SQL Editor como usuario)
-- SELECT is_admin_expedientes();

-- Opción 2: Verificar el rol de un usuario específico por email
SELECT 
  u.email,
  u.id,
  ur.is_superadmin,
  ur.is_admin_expedientes,
  CASE 
    WHEN ur.is_admin_expedientes = TRUE THEN 'Admin Expedientes'
    WHEN ur.is_superadmin = TRUE THEN 'SuperAdmin'
    ELSE 'Admin Regular'
  END as rol_actual
FROM auth.users u
LEFT JOIN user_roles ur ON u.id = ur.user_id
WHERE u.email = 'expedientes@gmail.com';

-- Opción 3: Ver todos los usuarios y sus roles
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
ORDER BY u.email;
