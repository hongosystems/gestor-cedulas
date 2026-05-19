-- Migración: Permitir que SUPERADMIN pueda UPDATE e INSERT en cualquier cédula
-- Ejecutar este SQL en Supabase SQL Editor
--
-- Contexto:
-- - Ya existe policy SELECT para superadmin (ver fix_superadmin_view_all_data.sql).
-- - Las policies UPDATE actuales solo cubren: dueño (owner_user_id = auth.uid()),
--   admin_cedulas y admin_expedientes (ver add_notas_to_cedulas.sql).
-- - Sin estas policies, un superadmin que NO sea además admin_cedulas/admin_expedientes
--   no puede marcar En Trámite / Completa / editar notas sobre cédulas ajenas, ni cargar.
--
-- Las policies RLS se evalúan con OR, así que estas se suman a las existentes
-- sin pisarlas.

-- ============================================
-- UPDATE para SUPERADMIN
-- ============================================
DROP POLICY IF EXISTS "SuperAdmin can update all cedulas" ON cedulas;

CREATE POLICY "SuperAdmin can update all cedulas"
  ON cedulas FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.is_superadmin = TRUE
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.is_superadmin = TRUE
    )
  );

-- ============================================
-- INSERT para SUPERADMIN
-- ============================================
-- Permite que el superadmin cargue nuevas cédulas sin importar el owner_user_id
-- que figure en el registro (por ejemplo, al cargar en nombre de otro usuario).
DROP POLICY IF EXISTS "SuperAdmin can insert cedulas" ON cedulas;

CREATE POLICY "SuperAdmin can insert cedulas"
  ON cedulas FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.is_superadmin = TRUE
    )
  );

-- ============================================
-- VERIFICACIÓN
-- ============================================
-- SELECT policyname, cmd FROM pg_policies
-- WHERE tablename = 'cedulas' AND policyname LIKE '%SuperAdmin%';
