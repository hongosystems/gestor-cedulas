-- Migración: Renuncia en Prueba/Pericia (estados RENUNCIADO y semáforo congelado)
-- Ejecutar en Supabase SQL Editor. Idempotente donde aplica.

-- 1. gestiones_estudio: estado RENUNCIADO + semáforo congelado
ALTER TABLE gestiones_estudio DROP CONSTRAINT IF EXISTS gestiones_estudio_estado_check;
ALTER TABLE gestiones_estudio ADD CONSTRAINT gestiones_estudio_estado_check CHECK (
  estado IN (
    'PENDIENTE_CONTACTO_CLIENTE',
    'CONTACTO_CLIENTE_FALLIDO',
    'CONTACTO_CLIENTE_OK',
    'TURNO_CONFIRMADO',
    'SEGUIMIENTO_PRE_TURNO',
    'ESTUDIO_REALIZADO',
    'CANCELADA',
    'RENUNCIADO'
  )
);

ALTER TABLE gestiones_estudio
  ADD COLUMN IF NOT EXISTS semaforo_congelado BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE gestiones_estudio
  ADD COLUMN IF NOT EXISTS fecha_semaforo_congelado TIMESTAMPTZ;

-- 2. ordenes_medicas: estado RENUNCIADO
ALTER TABLE ordenes_medicas DROP CONSTRAINT IF EXISTS ordenes_medicas_estado_check;
ALTER TABLE ordenes_medicas ADD CONSTRAINT ordenes_medicas_estado_check CHECK (
  estado IN ('NUEVA', 'EN_PROCESO', 'COMPLETADA', 'CANCELADA', 'RENUNCIADO')
);

-- 3. expedientes: semáforo congelado (Detección)
ALTER TABLE expedientes
  ADD COLUMN IF NOT EXISTS semaforo_congelado BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE expedientes
  ADD COLUMN IF NOT EXISTS fecha_semaforo_congelado TIMESTAMPTZ;

-- 4. SuperAdmin puede actualizar gestiones y órdenes (renuncia vía API con service role; útil si se usa cliente directo)
DROP POLICY IF EXISTS "SuperAdmin can update all gestiones_estudio" ON gestiones_estudio;
CREATE POLICY "SuperAdmin can update all gestiones_estudio"
  ON gestiones_estudio FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.is_superadmin = TRUE
    )
  );

DROP POLICY IF EXISTS "SuperAdmin can update all ordenes_medicas" ON ordenes_medicas;
CREATE POLICY "SuperAdmin can update all ordenes_medicas"
  ON ordenes_medicas FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.is_superadmin = TRUE
    )
  );

DROP POLICY IF EXISTS "SuperAdmin can update all expedientes" ON expedientes;
CREATE POLICY "SuperAdmin can update all expedientes"
  ON expedientes FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.is_superadmin = TRUE
    )
  );
