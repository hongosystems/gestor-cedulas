-- Migración: Agregar soft delete a conversation_participants
-- Ejecutar este SQL en Supabase SQL Editor

-- Agregar columna deleted_at para soft delete por usuario
ALTER TABLE conversation_participants 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Crear índice para mejorar performance de queries que filtran deleted_at
CREATE INDEX IF NOT EXISTS idx_conversation_participants_deleted_at 
ON conversation_participants(conversation_id, user_id, deleted_at) 
WHERE deleted_at IS NULL;

-- Función RPC: Restaurar conversación cuando llega un mensaje nuevo
-- (si estaba borrada, la vuelve a mostrar)
CREATE OR REPLACE FUNCTION restore_conversation_on_new_message()
RETURNS TRIGGER AS $$
BEGIN
  -- Si llega un mensaje nuevo, restaurar la conversación para todos los participantes
  -- que la habían borrado (deleted_at IS NOT NULL)
  UPDATE conversation_participants
  SET deleted_at = NULL
  WHERE conversation_id = NEW.conversation_id
    AND deleted_at IS NOT NULL;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger para restaurar conversación cuando llega un mensaje nuevo
DROP TRIGGER IF EXISTS trg_restore_conversation_on_new_message ON messages;
CREATE TRIGGER trg_restore_conversation_on_new_message
AFTER INSERT ON messages
FOR EACH ROW EXECUTE FUNCTION restore_conversation_on_new_message();

-- Actualizar políticas RLS para considerar deleted_at
-- Las políticas existentes ya filtran por user_id, solo necesitamos asegurar
-- que las queries manuales también filtren deleted_at IS NULL
