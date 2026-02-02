-- Migración: Crear tablas para el sistema de transferencias de archivos
-- Ejecutar este SQL en Supabase SQL Editor

-- Tabla: file_transfers
-- Almacena las transferencias de cédulas/oficios entre usuarios
CREATE TABLE IF NOT EXISTS file_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doc_type VARCHAR(10) NOT NULL CHECK (doc_type IN ('CEDULA', 'OFICIO')),
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tabla: file_transfer_versions
-- Almacena las versiones de archivos subidos para cada transferencia
CREATE TABLE IF NOT EXISTS file_transfer_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES file_transfers(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(transfer_id, version)
);

-- Índices para mejorar el rendimiento
CREATE INDEX IF NOT EXISTS idx_file_transfers_sender ON file_transfers(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_file_transfers_recipient ON file_transfers(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_file_transfers_created_at ON file_transfers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_file_transfer_versions_transfer_id ON file_transfer_versions(transfer_id);
CREATE INDEX IF NOT EXISTS idx_file_transfer_versions_created_at ON file_transfer_versions(created_at DESC);

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_file_transfers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para actualizar updated_at
DROP TRIGGER IF EXISTS trigger_update_file_transfers_updated_at ON file_transfers;
CREATE TRIGGER trigger_update_file_transfers_updated_at
  BEFORE UPDATE ON file_transfers
  FOR EACH ROW
  EXECUTE FUNCTION update_file_transfers_updated_at();

-- Políticas RLS para file_transfers
ALTER TABLE file_transfers ENABLE ROW LEVEL SECURITY;

-- Política: Los usuarios solo pueden ver transferencias donde son sender o recipient
DROP POLICY IF EXISTS "Users can view their transfers" ON file_transfers;
CREATE POLICY "Users can view their transfers"
ON file_transfers
FOR SELECT
USING (
  sender_user_id = auth.uid() OR recipient_user_id = auth.uid()
);

-- Política: Los usuarios pueden crear transferencias donde son el sender
DROP POLICY IF EXISTS "Users can create transfers as sender" ON file_transfers;
CREATE POLICY "Users can create transfers as sender"
ON file_transfers
FOR INSERT
WITH CHECK (sender_user_id = auth.uid());

-- Política: Los usuarios pueden actualizar transferencias donde son sender o recipient
DROP POLICY IF EXISTS "Users can update their transfers" ON file_transfers;
CREATE POLICY "Users can update their transfers"
ON file_transfers
FOR UPDATE
USING (
  sender_user_id = auth.uid() OR recipient_user_id = auth.uid()
);

-- Políticas RLS para file_transfer_versions
ALTER TABLE file_transfer_versions ENABLE ROW LEVEL SECURITY;

-- Política: Los usuarios solo pueden ver versiones de transferencias donde están involucrados
DROP POLICY IF EXISTS "Users can view versions of their transfers" ON file_transfer_versions;
CREATE POLICY "Users can view versions of their transfers"
ON file_transfer_versions
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM file_transfers ft
    WHERE ft.id = file_transfer_versions.transfer_id
    AND (ft.sender_user_id = auth.uid() OR ft.recipient_user_id = auth.uid())
  )
);

-- Política: Los usuarios pueden crear versiones de transferencias donde están involucrados
DROP POLICY IF EXISTS "Users can create versions of their transfers" ON file_transfer_versions;
CREATE POLICY "Users can create versions of their transfers"
ON file_transfer_versions
FOR INSERT
WITH CHECK (
  created_by = auth.uid() AND
  EXISTS (
    SELECT 1 FROM file_transfers ft
    WHERE ft.id = file_transfer_versions.transfer_id
    AND (ft.sender_user_id = auth.uid() OR ft.recipient_user_id = auth.uid())
  )
);
