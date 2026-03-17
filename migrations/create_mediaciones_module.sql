-- Migración: Módulo completo de Mediaciones
-- Ejecutar en Supabase SQL Editor (idempotente donde sea posible)

-- ============================================
-- 1. Nuevo rol en user_roles
-- ============================================
ALTER TABLE user_roles
ADD COLUMN IF NOT EXISTS is_admin_mediaciones BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================
-- 2. Tablas nuevas
-- ============================================

-- Trámites de mediación
CREATE TABLE IF NOT EXISTS mediaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_tramite TEXT UNIQUE,
  estado TEXT NOT NULL DEFAULT 'pendiente_rta' CHECK (estado IN (
    'borrador','pendiente_rta','devuelto','reenviado','aceptado','doc_generado'
  )),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  fecha_envio TIMESTAMPTZ,
  fecha_ultima_actualizacion TIMESTAMPTZ NOT NULL DEFAULT now(),
  tracking_externo_id TEXT,

  letrado_nombre TEXT,
  letrado_caracter TEXT,
  letrado_tomo TEXT,
  letrado_folio TEXT,
  letrado_domicilio TEXT,
  letrado_telefono TEXT,
  letrado_celular TEXT,
  letrado_email TEXT,

  req_nombre TEXT,
  req_dni TEXT,
  req_domicilio TEXT,
  req_email TEXT,
  req_celular TEXT,

  objeto_reclamo TEXT,
  fecha_hecho DATE,
  lugar_hecho TEXT,
  vehiculo TEXT,
  dominio_patente TEXT,
  nro_siniestro TEXT,
  nro_poliza TEXT,
  mecanica_hecho TEXT
);

CREATE INDEX IF NOT EXISTS idx_mediaciones_user_id ON mediaciones(user_id);
CREATE INDEX IF NOT EXISTS idx_mediaciones_estado ON mediaciones(estado);
CREATE INDEX IF NOT EXISTS idx_mediaciones_numero_tramite ON mediaciones(numero_tramite);
CREATE INDEX IF NOT EXISTS idx_mediaciones_created_at ON mediaciones(created_at DESC);

-- Requeridos (varios por mediación)
CREATE TABLE IF NOT EXISTS mediacion_requeridos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mediacion_id UUID NOT NULL REFERENCES mediaciones(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  condicion TEXT,
  domicilio TEXT,
  lesiones TEXT,
  es_aseguradora BOOLEAN NOT NULL DEFAULT FALSE,
  aseguradora_nombre TEXT,
  aseguradora_domicilio TEXT,
  orden INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_mediacion_requeridos_mediacion_id ON mediacion_requeridos(mediacion_id);

-- Observaciones del mediador
CREATE TABLE IF NOT EXISTS mediacion_observaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mediacion_id UUID NOT NULL REFERENCES mediaciones(id) ON DELETE CASCADE,
  texto TEXT NOT NULL,
  autor_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mediacion_observaciones_mediacion_id ON mediacion_observaciones(mediacion_id);

-- Historial de estados
CREATE TABLE IF NOT EXISTS mediacion_historial (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mediacion_id UUID NOT NULL REFERENCES mediaciones(id) ON DELETE CASCADE,
  estado_anterior TEXT,
  estado_nuevo TEXT NOT NULL,
  actor_id UUID NOT NULL REFERENCES auth.users(id),
  comentario TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mediacion_historial_mediacion_id ON mediacion_historial(mediacion_id);

-- Documentos generados
CREATE TABLE IF NOT EXISTS mediacion_documentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mediacion_id UUID NOT NULL REFERENCES mediaciones(id) ON DELETE CASCADE,
  tipo_plantilla TEXT NOT NULL DEFAULT 'carta_documento',
  storage_path TEXT,
  modo_firma TEXT NOT NULL DEFAULT 'sin_firma' CHECK (modo_firma IN ('sin_firma','firma_olografa','firma_digital','ambas')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mediacion_documentos_mediacion_id ON mediacion_documentos(mediacion_id);

-- Lotes de despacho
CREATE TABLE IF NOT EXISTS mediacion_lotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_lote INT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','enviado')),
  umbral INT NOT NULL DEFAULT 56,
  destinatarios TEXT[] NOT NULL DEFAULT ARRAY['oliverarodrigo86@gmail.com','gfhisi@gmail.com'],
  texto_mail TEXT NOT NULL DEFAULT 'Como estan? Solicito fecha de mediacion. Tratar con Magaly Flores que es quien asiste a las audiencias. Saludos Cordiales',
  envio_automatico BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_envio TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mediacion_lotes_estado ON mediacion_lotes(estado);

-- Relación lote-mediación
CREATE TABLE IF NOT EXISTS mediacion_lote_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id UUID NOT NULL REFERENCES mediacion_lotes(id) ON DELETE CASCADE,
  mediacion_id UUID NOT NULL REFERENCES mediaciones(id) ON DELETE CASCADE,
  documento_id UUID REFERENCES mediacion_documentos(id),
  UNIQUE(lote_id, mediacion_id)
);

CREATE INDEX IF NOT EXISTS idx_mediacion_lote_items_lote_id ON mediacion_lote_items(lote_id);
CREATE INDEX IF NOT EXISTS idx_mediacion_lote_items_mediacion_id ON mediacion_lote_items(mediacion_id);

-- Secuencia para número de lote
CREATE SEQUENCE IF NOT EXISTS mediacion_lotes_seq START 1;

-- ============================================
-- 3. Función y trigger numero_tramite (MED-YYYY-NNNN)
-- ============================================
CREATE OR REPLACE FUNCTION generate_mediacion_numero()
RETURNS TRIGGER AS $$
DECLARE
  next_num INT;
  year_str TEXT;
BEGIN
  IF NEW.numero_tramite IS NOT NULL AND TRIM(NEW.numero_tramite) <> '' THEN
    RETURN NEW;
  END IF;
  year_str := to_char(now(), 'YYYY');
  SELECT COALESCE(MAX(
    CAST(NULLIF(REGEXP_REPLACE(SPLIT_PART(numero_tramite, '-', 3), '[^0-9]', '', 'g'), '') AS INT)
  ), 0) + 1
  INTO next_num
  FROM mediaciones
  WHERE numero_tramite LIKE 'MED-' || year_str || '-%';
  NEW.numero_tramite := 'MED-' || year_str || '-' || LPAD(next_num::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mediacion_numero ON mediaciones;
CREATE TRIGGER trg_mediacion_numero
  BEFORE INSERT ON mediaciones
  FOR EACH ROW
  EXECUTE FUNCTION generate_mediacion_numero();

-- ============================================
-- 4. Trigger fecha_ultima_actualizacion
-- ============================================
CREATE OR REPLACE FUNCTION update_mediaciones_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.fecha_ultima_actualizacion = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mediaciones_updated ON mediaciones;
CREATE TRIGGER trg_mediaciones_updated
  BEFORE UPDATE ON mediaciones
  FOR EACH ROW
  EXECUTE FUNCTION update_mediaciones_updated_at();

-- ============================================
-- 5. RLS
-- ============================================
ALTER TABLE mediaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE mediacion_requeridos ENABLE ROW LEVEL SECURITY;
ALTER TABLE mediacion_observaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE mediacion_historial ENABLE ROW LEVEL SECURITY;
ALTER TABLE mediacion_documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE mediacion_lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mediacion_lote_items ENABLE ROW LEVEL SECURITY;

-- Mediaciones: admin ve todo; usuario solo los suyos
DROP POLICY IF EXISTS "admin_mediaciones_all_mediaciones" ON mediaciones;
CREATE POLICY "admin_mediaciones_all_mediaciones" ON mediaciones
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND is_admin_mediaciones = TRUE)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND is_admin_mediaciones = TRUE)
  );

DROP POLICY IF EXISTS "user_own_mediaciones" ON mediaciones;
CREATE POLICY "user_own_mediaciones" ON mediaciones
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Requeridos: admin todo; usuario solo los de sus mediaciones
DROP POLICY IF EXISTS "admin_mediaciones_all_requeridos" ON mediacion_requeridos;
CREATE POLICY "admin_mediaciones_all_requeridos" ON mediacion_requeridos
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND is_admin_mediaciones = TRUE)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND is_admin_mediaciones = TRUE)
  );

DROP POLICY IF EXISTS "user_mediacion_requeridos" ON mediacion_requeridos;
CREATE POLICY "user_mediacion_requeridos" ON mediacion_requeridos
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM mediaciones m WHERE m.id = mediacion_requeridos.mediacion_id AND m.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM mediaciones m WHERE m.id = mediacion_requeridos.mediacion_id AND m.user_id = auth.uid())
  );

-- Observaciones: mismo patrón
DROP POLICY IF EXISTS "admin_mediaciones_all_observaciones" ON mediacion_observaciones;
CREATE POLICY "admin_mediaciones_all_observaciones" ON mediacion_observaciones
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND is_admin_mediaciones = TRUE)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND is_admin_mediaciones = TRUE)
  );

DROP POLICY IF EXISTS "user_mediacion_observaciones" ON mediacion_observaciones;
CREATE POLICY "user_mediacion_observaciones" ON mediacion_observaciones
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM mediaciones m WHERE m.id = mediacion_observaciones.mediacion_id AND m.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM mediaciones m WHERE m.id = mediacion_observaciones.mediacion_id AND m.user_id = auth.uid())
  );

-- Historial: mismo patrón
DROP POLICY IF EXISTS "admin_mediaciones_all_historial" ON mediacion_historial;
CREATE POLICY "admin_mediaciones_all_historial" ON mediacion_historial
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND is_admin_mediaciones = TRUE)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND is_admin_mediaciones = TRUE)
  );

DROP POLICY IF EXISTS "user_mediacion_historial" ON mediacion_historial;
CREATE POLICY "user_mediacion_historial" ON mediacion_historial
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM mediaciones m WHERE m.id = mediacion_historial.mediacion_id AND m.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM mediaciones m WHERE m.id = mediacion_historial.mediacion_id AND m.user_id = auth.uid())
  );

-- Documentos: mismo patrón
DROP POLICY IF EXISTS "admin_mediaciones_all_documentos" ON mediacion_documentos;
CREATE POLICY "admin_mediaciones_all_documentos" ON mediacion_documentos
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND is_admin_mediaciones = TRUE)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND is_admin_mediaciones = TRUE)
  );

DROP POLICY IF EXISTS "user_mediacion_documentos" ON mediacion_documentos;
CREATE POLICY "user_mediacion_documentos" ON mediacion_documentos
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM mediaciones m WHERE m.id = mediacion_documentos.mediacion_id AND m.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM mediaciones m WHERE m.id = mediacion_documentos.mediacion_id AND m.user_id = auth.uid())
  );

-- Lotes: solo admin_mediaciones (y superadmin para consistencia)
DROP POLICY IF EXISTS "admin_mediaciones_all_lotes" ON mediacion_lotes;
CREATE POLICY "admin_mediaciones_all_lotes" ON mediacion_lotes
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND (is_admin_mediaciones = TRUE OR is_superadmin = TRUE))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND (is_admin_mediaciones = TRUE OR is_superadmin = TRUE))
  );

-- Lote items: solo admin
DROP POLICY IF EXISTS "admin_mediaciones_all_lote_items" ON mediacion_lote_items;
CREATE POLICY "admin_mediaciones_all_lote_items" ON mediacion_lote_items
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND (is_admin_mediaciones = TRUE OR is_superadmin = TRUE))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND (is_admin_mediaciones = TRUE OR is_superadmin = TRUE))
  );

-- ============================================
-- 6. Bucket Storage (opcional; puede crearse desde Dashboard)
-- ============================================
-- Si falla por permisos, crear manualmente: Storage > New bucket > id: mediaciones, private
INSERT INTO storage.buckets (id, name, public)
VALUES ('mediaciones', 'mediaciones', false)
ON CONFLICT (id) DO NOTHING;
