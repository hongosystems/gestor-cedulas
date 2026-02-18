-- Migración: Agregar tabla para múltiples archivos por orden médica
-- Ejecutar este SQL en Supabase SQL Editor
-- Migración aditiva e idempotente (usa IF NOT EXISTS)

-- Tabla: ordenes_medicas_archivos
-- Permite múltiples archivos por orden médica (hasta 5)
CREATE TABLE IF NOT EXISTS ordenes_medicas_archivos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id UUID NOT NULL REFERENCES ordenes_medicas(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  orden_archivo INTEGER NOT NULL DEFAULT 1, -- Orden del archivo (1-5)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(orden_id, orden_archivo) -- Asegurar que no haya más de 5 archivos por orden
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_ordenes_medicas_archivos_orden_id ON ordenes_medicas_archivos(orden_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_medicas_archivos_orden_archivo ON ordenes_medicas_archivos(orden_id, orden_archivo);

-- RLS Policies
ALTER TABLE ordenes_medicas_archivos ENABLE ROW LEVEL SECURITY;

-- Policy: Los usuarios pueden ver archivos de órdenes a las que tienen acceso
CREATE POLICY "Users can view archivos of accessible ordenes"
  ON ordenes_medicas_archivos
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM ordenes_medicas om
      WHERE om.id = ordenes_medicas_archivos.orden_id
      AND (
        om.emitida_por_user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM expedientes e
          WHERE e.id = om.expediente_id
          AND e.owner_user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM user_roles ur
          WHERE ur.user_id = auth.uid()
          AND (ur.is_superadmin = true OR ur.is_admin_expedientes = true)
        )
      )
    )
  );

-- Policy: Los usuarios pueden insertar archivos en órdenes que crearon o tienen acceso
CREATE POLICY "Users can insert archivos to accessible ordenes"
  ON ordenes_medicas_archivos
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ordenes_medicas om
      WHERE om.id = ordenes_medicas_archivos.orden_id
      AND (
        om.emitida_por_user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM expedientes e
          WHERE e.id = om.expediente_id
          AND e.owner_user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM user_roles ur
          WHERE ur.user_id = auth.uid()
          AND (ur.is_superadmin = true OR ur.is_admin_expedientes = true)
        )
      )
    )
  );

-- Policy: Los usuarios pueden eliminar archivos de órdenes a las que tienen acceso
CREATE POLICY "Users can delete archivos of accessible ordenes"
  ON ordenes_medicas_archivos
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM ordenes_medicas om
      WHERE om.id = ordenes_medicas_archivos.orden_id
      AND (
        om.emitida_por_user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM expedientes e
          WHERE e.id = om.expediente_id
          AND e.owner_user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM user_roles ur
          WHERE ur.user_id = auth.uid()
          AND (ur.is_superadmin = true OR ur.is_admin_expedientes = true)
        )
      )
    )
  );

-- Trigger para limitar a 5 archivos por orden
CREATE OR REPLACE FUNCTION check_max_archivos_per_orden()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT COUNT(*) FROM ordenes_medicas_archivos WHERE orden_id = NEW.orden_id) >= 5 THEN
    RAISE EXCEPTION 'No se pueden agregar más de 5 archivos por orden';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_check_max_archivos
  BEFORE INSERT ON ordenes_medicas_archivos
  FOR EACH ROW
  EXECUTE FUNCTION check_max_archivos_per_orden();
