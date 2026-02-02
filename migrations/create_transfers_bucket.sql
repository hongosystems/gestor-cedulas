-- Migración: Crear bucket "transfers" para almacenar cédulas/oficios enviados entre usuarios
-- Ejecutar este SQL en Supabase SQL Editor

-- IMPORTANTE: El bucket debe crearse manualmente desde el dashboard de Supabase:
-- 1. Ve a Supabase Dashboard > Storage
-- 2. Haz clic en "New bucket"
-- 3. Nombre: "transfers"
-- 4. Marca como "Private" (no público)
-- 5. File size limit: 10MB (o según tus necesidades)
-- 6. Allowed MIME types: application/vnd.openxmlformats-officedocument.wordprocessingml.document

-- Políticas RLS para el bucket "transfers"
-- Estas políticas permiten que los usuarios solo accedan a archivos de transferencias donde son sender o recipient

-- Función helper para extraer el transfer_id del path
-- El path tiene formato: transfers/{transfer_id}/v{version}.docx
CREATE OR REPLACE FUNCTION get_transfer_id_from_path(path text)
RETURNS uuid AS $$
DECLARE
  path_parts text[];
  transfer_id_text text;
BEGIN
  -- Dividir el path por "/"
  path_parts := string_to_array(path, '/');
  
  -- El transfer_id debería estar en la segunda posición (índice 2)
  -- path_parts[1] = "transfers", path_parts[2] = "{transfer_id}"
  IF array_length(path_parts, 1) >= 2 THEN
    transfer_id_text := path_parts[2];
    -- Intentar convertir a UUID
    RETURN transfer_id_text::uuid;
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Política 1: Permitir lectura de archivos si el usuario es sender o recipient de la transferencia
DROP POLICY IF EXISTS "Users can read transfers they are involved in" ON storage.objects;
CREATE POLICY "Users can read transfers they are involved in"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'transfers' AND
  (
    EXISTS (
      SELECT 1 FROM file_transfers ft
      WHERE ft.id = get_transfer_id_from_path(name)
      AND (ft.sender_user_id = auth.uid() OR ft.recipient_user_id = auth.uid())
    )
  )
);

-- Política 2: Permitir subida de archivos si el usuario es sender o recipient de la transferencia
DROP POLICY IF EXISTS "Users can upload transfers they are involved in" ON storage.objects;
CREATE POLICY "Users can upload transfers they are involved in"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'transfers' AND
  (
    EXISTS (
      SELECT 1 FROM file_transfers ft
      WHERE ft.id = get_transfer_id_from_path(name)
      AND (ft.sender_user_id = auth.uid() OR ft.recipient_user_id = auth.uid())
    )
  )
);

-- Política 3: Permitir actualización de archivos si el usuario es sender o recipient
DROP POLICY IF EXISTS "Users can update transfers they are involved in" ON storage.objects;
CREATE POLICY "Users can update transfers they are involved in"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'transfers' AND
  (
    EXISTS (
      SELECT 1 FROM file_transfers ft
      WHERE ft.id = get_transfer_id_from_path(name)
      AND (ft.sender_user_id = auth.uid() OR ft.recipient_user_id = auth.uid())
    )
  )
);

-- Política 4: Permitir eliminación de archivos si el usuario es sender o recipient
DROP POLICY IF EXISTS "Users can delete transfers they are involved in" ON storage.objects;
CREATE POLICY "Users can delete transfers they are involved in"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'transfers' AND
  (
    EXISTS (
      SELECT 1 FROM file_transfers ft
      WHERE ft.id = get_transfer_id_from_path(name)
      AND (ft.sender_user_id = auth.uid() OR ft.recipient_user_id = auth.uid())
    )
  )
);
