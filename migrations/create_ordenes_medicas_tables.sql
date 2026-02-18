-- Migración: Crear tablas para órdenes médicas y seguimiento
-- Ejecutar este SQL en Supabase SQL Editor
-- Migración aditiva e idempotente (usa IF NOT EXISTS)

-- 1. Tabla: ordenes_medicas
-- Almacena las órdenes médicas subidas vinculadas a expedientes/case_ref
CREATE TABLE IF NOT EXISTS ordenes_medicas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_ref TEXT NOT NULL, -- Referencia del caso/expediente (ej: "CIV 123/2024")
  expediente_id UUID REFERENCES expedientes(id) ON DELETE SET NULL, -- Opcional: FK a expedientes si existe
  storage_path TEXT NOT NULL, -- Path en Supabase Storage (ej: "ordenes-medicas/{user_id}/{orden_id}.pdf")
  filename TEXT, -- Nombre original del archivo
  mime TEXT, -- MIME type (ej: "application/pdf")
  size INTEGER, -- Tamaño en bytes
  emitida_por_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  estado TEXT NOT NULL DEFAULT 'NUEVA' CHECK (estado IN ('NUEVA', 'EN_PROCESO', 'COMPLETADA', 'CANCELADA')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para ordenes_medicas
CREATE INDEX IF NOT EXISTS idx_ordenes_medicas_case_ref ON ordenes_medicas(case_ref);
CREATE INDEX IF NOT EXISTS idx_ordenes_medicas_expediente_id ON ordenes_medicas(expediente_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_medicas_emitida_por ON ordenes_medicas(emitida_por_user_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_medicas_estado ON ordenes_medicas(estado);
CREATE INDEX IF NOT EXISTS idx_ordenes_medicas_created_at ON ordenes_medicas(created_at DESC);

-- 2. Tabla: gestiones_estudio
-- Almacena el seguimiento de cada orden médica (workflow de contactos y turnos)
CREATE TABLE IF NOT EXISTS gestiones_estudio (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id UUID NOT NULL REFERENCES ordenes_medicas(id) ON DELETE CASCADE,
  estado TEXT NOT NULL DEFAULT 'PENDIENTE_CONTACTO_CLIENTE' CHECK (
    estado IN (
      'PENDIENTE_CONTACTO_CLIENTE',
      'CONTACTO_CLIENTE_FALLIDO',
      'CONTACTO_CLIENTE_OK',
      'TURNO_CONFIRMADO',
      'SEGUIMIENTO_PRE_TURNO',
      'ESTUDIO_REALIZADO',
      'CANCELADA'
    )
  ),
  centro_medico TEXT, -- Nombre del centro médico
  turno_fecha_hora TIMESTAMPTZ, -- Fecha y hora del turno confirmado
  fecha_estudio_realizado TIMESTAMPTZ, -- Fecha en que se realizó el estudio
  responsable_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- Usuario asignado (ej: Andrea)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para gestiones_estudio
CREATE INDEX IF NOT EXISTS idx_gestiones_estudio_orden_id ON gestiones_estudio(orden_id);
CREATE INDEX IF NOT EXISTS idx_gestiones_estudio_estado ON gestiones_estudio(estado);
CREATE INDEX IF NOT EXISTS idx_gestiones_estudio_responsable ON gestiones_estudio(responsable_user_id);
CREATE INDEX IF NOT EXISTS idx_gestiones_estudio_turno_fecha ON gestiones_estudio(turno_fecha_hora) WHERE turno_fecha_hora IS NOT NULL;

-- 3. Tabla: comunicaciones
-- Registra todas las comunicaciones (trazabilidad completa)
CREATE TABLE IF NOT EXISTS comunicaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entidad_tipo TEXT NOT NULL CHECK (entidad_tipo IN ('ORDEN', 'GESTION')),
  entidad_id UUID NOT NULL, -- FK a ordenes_medicas.id o gestiones_estudio.id según entidad_tipo
  canal TEXT NOT NULL, -- Ej: "TELEFONO", "EMAIL", "WHATSAPP", "PRESENCIAL", "OTRO"
  resultado TEXT NOT NULL CHECK (resultado IN ('SATISFACTORIO', 'INSATISFACTORIO', 'SIN_RESPUESTA', 'RECHAZO')),
  motivo_falla TEXT, -- Detalle del motivo si resultado es INSATISFACTORIO o RECHAZO
  detalle TEXT, -- Detalle completo de la comunicación
  realizado_por_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para comunicaciones
CREATE INDEX IF NOT EXISTS idx_comunicaciones_entidad ON comunicaciones(entidad_tipo, entidad_id);
CREATE INDEX IF NOT EXISTS idx_comunicaciones_realizado_por ON comunicaciones(realizado_por_user_id);
CREATE INDEX IF NOT EXISTS idx_comunicaciones_resultado ON comunicaciones(resultado);
CREATE INDEX IF NOT EXISTS idx_comunicaciones_created_at ON comunicaciones(created_at DESC);

-- 4. Habilitar RLS (Row Level Security)
ALTER TABLE ordenes_medicas ENABLE ROW LEVEL SECURITY;
ALTER TABLE gestiones_estudio ENABLE ROW LEVEL SECURITY;
ALTER TABLE comunicaciones ENABLE ROW LEVEL SECURITY;

-- 5. Políticas RLS para ordenes_medicas
-- Usuarios pueden ver sus propias órdenes o las de expedientes que les pertenecen
DROP POLICY IF EXISTS "Users can view ordenes_medicas" ON ordenes_medicas;
CREATE POLICY "Users can view ordenes_medicas"
  ON ordenes_medicas FOR SELECT
  USING (
    emitida_por_user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM expedientes e
      WHERE e.id = ordenes_medicas.expediente_id
      AND e.owner_user_id = auth.uid()
    )
  );

-- Usuarios pueden crear órdenes
DROP POLICY IF EXISTS "Users can create ordenes_medicas" ON ordenes_medicas;
CREATE POLICY "Users can create ordenes_medicas"
  ON ordenes_medicas FOR INSERT
  WITH CHECK (emitida_por_user_id = auth.uid());

-- Usuarios pueden actualizar sus propias órdenes
DROP POLICY IF EXISTS "Users can update ordenes_medicas" ON ordenes_medicas;
CREATE POLICY "Users can update ordenes_medicas"
  ON ordenes_medicas FOR UPDATE
  USING (emitida_por_user_id = auth.uid())
  WITH CHECK (emitida_por_user_id = auth.uid());

-- SuperAdmin puede ver todas las órdenes
DROP POLICY IF EXISTS "SuperAdmin can view all ordenes_medicas" ON ordenes_medicas;
CREATE POLICY "SuperAdmin can view all ordenes_medicas"
  ON ordenes_medicas FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.is_superadmin = TRUE
    )
  );

-- 6. Políticas RLS para gestiones_estudio
-- Usuarios pueden ver gestiones de órdenes que pueden ver
DROP POLICY IF EXISTS "Users can view gestiones_estudio" ON gestiones_estudio;
CREATE POLICY "Users can view gestiones_estudio"
  ON gestiones_estudio FOR SELECT
  USING (
    responsable_user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM ordenes_medicas om
      WHERE om.id = gestiones_estudio.orden_id
      AND (
        om.emitida_por_user_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM expedientes e
          WHERE e.id = om.expediente_id
          AND e.owner_user_id = auth.uid()
        )
      )
    )
  );

-- Usuarios pueden crear gestiones (solo el sistema/API)
DROP POLICY IF EXISTS "Users can create gestiones_estudio" ON gestiones_estudio;
CREATE POLICY "Users can create gestiones_estudio"
  ON gestiones_estudio FOR INSERT
  WITH CHECK (true); -- Se valida en la API

-- Usuarios pueden actualizar gestiones donde son responsables o de órdenes propias
DROP POLICY IF EXISTS "Users can update gestiones_estudio" ON gestiones_estudio;
CREATE POLICY "Users can update gestiones_estudio"
  ON gestiones_estudio FOR UPDATE
  USING (
    responsable_user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM ordenes_medicas om
      WHERE om.id = gestiones_estudio.orden_id
      AND om.emitida_por_user_id = auth.uid()
    )
  )
  WITH CHECK (
    responsable_user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM ordenes_medicas om
      WHERE om.id = gestiones_estudio.orden_id
      AND om.emitida_por_user_id = auth.uid()
    )
  );

-- SuperAdmin puede ver todas las gestiones
DROP POLICY IF EXISTS "SuperAdmin can view all gestiones_estudio" ON gestiones_estudio;
CREATE POLICY "SuperAdmin can view all gestiones_estudio"
  ON gestiones_estudio FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.is_superadmin = TRUE
    )
  );

-- 7. Políticas RLS para comunicaciones
-- Usuarios pueden ver comunicaciones de entidades que pueden ver
DROP POLICY IF EXISTS "Users can view comunicaciones" ON comunicaciones;
CREATE POLICY "Users can view comunicaciones"
  ON comunicaciones FOR SELECT
  USING (
    realizado_por_user_id = auth.uid() OR
    (entidad_tipo = 'ORDEN' AND EXISTS (
      SELECT 1 FROM ordenes_medicas om
      WHERE om.id = comunicaciones.entidad_id
      AND (
        om.emitida_por_user_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM expedientes e
          WHERE e.id = om.expediente_id
          AND e.owner_user_id = auth.uid()
        )
      )
    )) OR
    (entidad_tipo = 'GESTION' AND EXISTS (
      SELECT 1 FROM gestiones_estudio ge
      JOIN ordenes_medicas om ON om.id = ge.orden_id
      WHERE ge.id = comunicaciones.entidad_id
      AND (
        ge.responsable_user_id = auth.uid() OR
        om.emitida_por_user_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM expedientes e
          WHERE e.id = om.expediente_id
          AND e.owner_user_id = auth.uid()
        )
      )
    ))
  );

-- Usuarios pueden crear comunicaciones
DROP POLICY IF EXISTS "Users can create comunicaciones" ON comunicaciones;
CREATE POLICY "Users can create comunicaciones"
  ON comunicaciones FOR INSERT
  WITH CHECK (realizado_por_user_id = auth.uid());

-- SuperAdmin puede ver todas las comunicaciones
DROP POLICY IF EXISTS "SuperAdmin can view all comunicaciones" ON comunicaciones;
CREATE POLICY "SuperAdmin can view all comunicaciones"
  ON comunicaciones FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.is_superadmin = TRUE
    )
  );

-- 8. Trigger para actualizar updated_at en ordenes_medicas
CREATE OR REPLACE FUNCTION update_ordenes_medicas_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_ordenes_medicas_updated_at ON ordenes_medicas;
CREATE TRIGGER trg_update_ordenes_medicas_updated_at
  BEFORE UPDATE ON ordenes_medicas
  FOR EACH ROW
  EXECUTE FUNCTION update_ordenes_medicas_updated_at();

-- 9. Trigger para actualizar updated_at en gestiones_estudio
CREATE OR REPLACE FUNCTION update_gestiones_estudio_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_gestiones_estudio_updated_at ON gestiones_estudio;
CREATE TRIGGER trg_update_gestiones_estudio_updated_at
  BEFORE UPDATE ON gestiones_estudio
  FOR EACH ROW
  EXECUTE FUNCTION update_gestiones_estudio_updated_at();

-- Comentario: Esta migración es completamente aditiva e idempotente
-- Puede ejecutarse múltiples veces sin problemas
-- Las tablas se crean solo si no existen (IF NOT EXISTS)
-- Las políticas se recrean si existen (DROP POLICY IF EXISTS)
