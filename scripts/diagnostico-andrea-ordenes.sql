-- Diagnóstico: Por qué Andrea (andreaestudio24@gmail.com) no ve las órdenes que crea
-- Ejecutar en Supabase SQL Editor para entender el problema

-- 1. Obtener el user_id de Andrea (auth.users)
SELECT 
  '1. Usuario Andrea en auth' as paso,
  u.id as andrea_user_id,
  u.email
FROM auth.users u
WHERE u.email ILIKE '%andreaestudio24%' OR u.email ILIKE '%andrea%estudio%24%';

-- 2. Órdenes creadas (emitida_por) - las que el Superadmin puede ver
-- Verificar qué user_id tienen las órdenes que Andrea subió
SELECT 
  '2. Órdenes en ordenes_medicas (emitida_por_user_id)' as paso,
  om.id,
  om.case_ref,
  om.emitida_por_user_id,
  om.created_at,
  p.email as emisor_email,
  p.full_name as emisor_nombre
FROM ordenes_medicas om
LEFT JOIN profiles p ON p.id = om.emitida_por_user_id
ORDER BY om.created_at DESC
LIMIT 20;

-- 3. Comparación: ¿Coincide el user_id de Andrea con el emitida_por de sus órdenes?
WITH andrea_user AS (
  SELECT id FROM auth.users 
  WHERE email ILIKE '%andreaestudio24%' OR email ILIKE '%andrea%estudio%24%'
  LIMIT 1
)
SELECT 
  '3. Diagnóstico' as paso,
  au.id as andrea_auth_id,
  om.emitida_por_user_id,
  (au.id = om.emitida_por_user_id) as coincide,
  om.case_ref
FROM andrea_user au
CROSS JOIN ordenes_medicas om
WHERE om.emitida_por_user_id = au.id
ORDER BY om.created_at DESC;

-- 4. Si el query anterior está vacío: las órdenes de Andrea tienen OTRO emitida_por_user_id
-- Este query muestra todas las órdenes con su emisor
SELECT 
  '4. Todas las órdenes con emisor' as paso,
  om.case_ref,
  om.emitida_por_user_id,
  p.email as emisor_email
FROM ordenes_medicas om
LEFT JOIN profiles p ON p.id = om.emitida_por_user_id
ORDER BY om.created_at DESC
LIMIT 15;

-- 5. Verificar user_roles de Andrea (¿tiene is_admin que le haría ver todo?)
SELECT 
  '5. Roles de Andrea' as paso,
  p.id,
  p.email,
  p.full_name,
  ur.is_superadmin,
  ur.is_admin_expedientes
FROM profiles p
LEFT JOIN user_roles ur ON ur.user_id = p.id
WHERE p.email ILIKE '%andreaestudio24%' OR p.email ILIKE '%andrea%estudio%24%';
