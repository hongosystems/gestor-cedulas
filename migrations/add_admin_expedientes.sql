-- Migración: Agregar rol Admin Expedientes y tabla expedientes
-- Ejecutar este SQL en Supabase SQL Editor

-- 1. Agregar campo is_admin_expedientes a user_roles
ALTER TABLE user_roles
ADD COLUMN IF NOT EXISTS is_admin_expedientes BOOLEAN DEFAULT FALSE;

-- 2. Crear función RPC para verificar si es admin_expedientes
CREATE OR REPLACE FUNCTION is_admin_expedientes()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_result BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN FALSE;
  END IF;
  
  SELECT COALESCE(ur.is_admin_expedientes, FALSE) INTO v_result
  FROM user_roles ur
  WHERE ur.user_id = v_user_id;
  
  RETURN COALESCE(v_result, FALSE);
END;
$$;

-- 3. Crear tabla expedientes
CREATE TABLE IF NOT EXISTS expedientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  caratula VARCHAR(500) NOT NULL,
  juzgado VARCHAR(200),
  numero_expediente VARCHAR(200),
  fecha_ultima_modificacion TIMESTAMP WITH TIME ZONE NOT NULL,
  estado VARCHAR(50) DEFAULT 'ABIERTO',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Crear índices para mejor rendimiento
CREATE INDEX IF NOT EXISTS idx_expedientes_owner_user_id ON expedientes(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_expedientes_fecha_ultima_modificacion ON expedientes(fecha_ultima_modificacion);
CREATE INDEX IF NOT EXISTS idx_expedientes_estado ON expedientes(estado);

-- 5. Habilitar RLS (Row Level Security)
ALTER TABLE expedientes ENABLE ROW LEVEL SECURITY;

-- 6. Política: los usuarios solo pueden ver sus propios expedientes
CREATE POLICY "Users can view their own expedientes"
  ON expedientes FOR SELECT
  USING (auth.uid() = owner_user_id);

-- 7. Política: los usuarios solo pueden insertar sus propios expedientes
CREATE POLICY "Users can insert their own expedientes"
  ON expedientes FOR INSERT
  WITH CHECK (auth.uid() = owner_user_id);

-- 8. Política: los usuarios solo pueden actualizar sus propios expedientes
CREATE POLICY "Users can update their own expedientes"
  ON expedientes FOR UPDATE
  USING (auth.uid() = owner_user_id)
  WITH CHECK (auth.uid() = owner_user_id);

-- 9. Política: los usuarios solo pueden eliminar sus propios expedientes
CREATE POLICY "Users can delete their own expedientes"
  ON expedientes FOR DELETE
  USING (auth.uid() = owner_user_id);

-- 10. Política: SuperAdmin puede ver todos los expedientes
CREATE POLICY "SuperAdmin can view all expedientes"
  ON expedientes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_roles.user_id = auth.uid() 
      AND user_roles.is_superadmin = TRUE
    )
  );

-- Comentario: Los usuarios con is_admin_expedientes = TRUE pueden gestionar expedientes
-- El semáforo se calculará en base a fecha_ultima_modificacion usando los mismos umbrales:
-- VERDE: 0-29 días
-- AMARILLO: 30-59 días
-- ROJO: 60+ días
