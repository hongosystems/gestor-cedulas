-- Migración: Permitir lectura de profiles para obtener nombres de usuarios
-- Ejecutar este SQL en Supabase SQL Editor

-- 1. Verificar si existe la tabla profiles y RLS está habilitado
-- (Esto generalmente ya está configurado, pero lo verificamos)

-- 2. Crear política para permitir que usuarios autenticados lean profiles de otros usuarios
--    (solo campos básicos: id, full_name, email)
--    Esto es necesario para mostrar quién creó cada expediente/cédula

-- Eliminar política existente si existe (para evitar conflictos)
DROP POLICY IF EXISTS "Users can read all profiles for display purposes" ON profiles;

-- Crear política que permite leer profiles a usuarios autenticados
CREATE POLICY "Users can read all profiles for display purposes"
  ON profiles FOR SELECT
  USING (
    -- Cualquier usuario autenticado puede leer profiles
    auth.uid() IS NOT NULL
  );

-- Alternativa más restrictiva: Solo permitir a usuarios con roles específicos
-- Si prefieres ser más restrictivo, usa esta versión en su lugar:
-- DROP POLICY IF EXISTS "Users with roles can read profiles" ON profiles;
-- CREATE POLICY "Users with roles can read profiles"
--   ON profiles FOR SELECT
--   USING (
--     auth.uid() IS NOT NULL
--     AND (
--       EXISTS (
--         SELECT 1 FROM user_roles 
--         WHERE user_roles.user_id = auth.uid() 
--         AND (
--           user_roles.is_superadmin = TRUE 
--           OR user_roles.is_admin_expedientes = TRUE 
--           OR user_roles.is_abogado = TRUE
--         )
--       )
--       OR auth.uid() = profiles.id  -- Siempre pueden ver su propio perfil
--     )
--   );

-- Comentario:
-- Esta política permite que cualquier usuario autenticado lea los profiles
-- de otros usuarios, lo cual es necesario para mostrar el nombre de quién
-- creó cada expediente, cédula u oficio.
-- Los datos expuestos son solo: id, full_name, email (no información sensible)
