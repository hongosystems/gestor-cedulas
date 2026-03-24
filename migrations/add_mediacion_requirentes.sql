-- Tabla hija: varios requirentes por mediación (patrón mediacion_requeridos).
-- Las columnas req_* en mediaciones se mantienen para retrocompatibilidad.

CREATE TABLE IF NOT EXISTS mediacion_requirentes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mediacion_id UUID NOT NULL REFERENCES mediaciones(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  dni TEXT,
  domicilio TEXT,
  email TEXT,
  celular TEXT,
  orden INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_mediacion_requirentes_mediacion_id ON mediacion_requirentes(mediacion_id);

ALTER TABLE mediacion_requirentes ENABLE ROW LEVEL SECURITY;

-- Mismo patrón que mediacion_requeridos: admin todo; usuario solo filas de sus mediaciones
DROP POLICY IF EXISTS "admin_mediaciones_all_requirentes" ON mediacion_requirentes;
CREATE POLICY "admin_mediaciones_all_requirentes" ON mediacion_requirentes
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND is_admin_mediaciones = TRUE)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND is_admin_mediaciones = TRUE)
  );

DROP POLICY IF EXISTS "user_mediacion_requirentes" ON mediacion_requirentes;
CREATE POLICY "user_mediacion_requirentes" ON mediacion_requirentes
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM mediaciones m WHERE m.id = mediacion_requirentes.mediacion_id AND m.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM mediaciones m WHERE m.id = mediacion_requirentes.mediacion_id AND m.user_id = auth.uid())
  );
