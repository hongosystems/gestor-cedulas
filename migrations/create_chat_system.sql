-- Migración: Crear sistema de chat interno
-- Ejecutar este SQL en Supabase SQL Editor

-- Tabla: conversations
-- Almacena conversaciones entre usuarios (1-1 o grupo)
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(20) NOT NULL DEFAULT 'direct' CHECK (type IN ('direct', 'group')),
  name TEXT, -- Nombre para conversaciones grupales
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tabla: conversation_participants
-- Relación muchos-a-muchos entre usuarios y conversaciones
CREATE TABLE IF NOT EXISTS conversation_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ, -- Última vez que el usuario leyó los mensajes
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(conversation_id, user_id)
);

-- Tabla: messages
-- Almacena los mensajes del chat
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para mejorar el rendimiento
CREATE INDEX IF NOT EXISTS idx_conversation_participants_user_id ON conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_conversation_id ON conversation_participants(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);

-- Función para actualizar updated_at en conversations cuando se crea un mensaje
CREATE OR REPLACE FUNCTION update_conversation_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE conversations
  SET updated_at = NOW()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para actualizar updated_at automáticamente
DROP TRIGGER IF EXISTS trigger_update_conversation_updated_at ON messages;
CREATE TRIGGER trigger_update_conversation_updated_at
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_updated_at();

-- Políticas RLS para conversations
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- Los usuarios solo pueden ver conversaciones en las que participan
DROP POLICY IF EXISTS "Users can view their conversations" ON conversations;
CREATE POLICY "Users can view their conversations"
ON conversations
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM conversation_participants
    WHERE conversation_participants.conversation_id = conversations.id
    AND conversation_participants.user_id = auth.uid()
  )
);

-- Los usuarios pueden crear conversaciones
DROP POLICY IF EXISTS "Users can create conversations" ON conversations;
CREATE POLICY "Users can create conversations"
ON conversations
FOR INSERT
WITH CHECK (true);

-- Políticas RLS para conversation_participants
ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;

-- Los usuarios solo pueden ver participantes de sus conversaciones
DROP POLICY IF EXISTS "Users can view participants of their conversations" ON conversation_participants;
CREATE POLICY "Users can view participants of their conversations"
ON conversation_participants
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM conversation_participants cp
    WHERE cp.conversation_id = conversation_participants.conversation_id
    AND cp.user_id = auth.uid()
  )
);

-- Los usuarios pueden agregarse a conversaciones (o el sistema los agrega)
DROP POLICY IF EXISTS "Users can join conversations" ON conversation_participants;
CREATE POLICY "Users can join conversations"
ON conversation_participants
FOR INSERT
WITH CHECK (user_id = auth.uid() OR EXISTS (
  SELECT 1 FROM conversation_participants
  WHERE conversation_id = conversation_participants.conversation_id
  AND user_id = auth.uid()
));

-- Los usuarios pueden actualizar su propio last_read_at
DROP POLICY IF EXISTS "Users can update their own last_read_at" ON conversation_participants;
CREATE POLICY "Users can update their own last_read_at"
ON conversation_participants
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Políticas RLS para messages
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Los usuarios solo pueden ver mensajes de conversaciones en las que participan
DROP POLICY IF EXISTS "Users can view messages from their conversations" ON messages;
CREATE POLICY "Users can view messages from their conversations"
ON messages
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM conversation_participants
    WHERE conversation_participants.conversation_id = messages.conversation_id
    AND conversation_participants.user_id = auth.uid()
  )
);

-- Los usuarios pueden crear mensajes en conversaciones donde participan
DROP POLICY IF EXISTS "Users can send messages to their conversations" ON messages;
CREATE POLICY "Users can send messages to their conversations"
ON messages
FOR INSERT
WITH CHECK (
  sender_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM conversation_participants
    WHERE conversation_participants.conversation_id = messages.conversation_id
    AND conversation_participants.user_id = auth.uid()
  )
);

-- Los usuarios pueden editar sus propios mensajes
DROP POLICY IF EXISTS "Users can edit their own messages" ON messages;
CREATE POLICY "Users can edit their own messages"
ON messages
FOR UPDATE
USING (sender_id = auth.uid())
WITH CHECK (sender_id = auth.uid());

-- Función RPC: Obtener o crear conversación directa entre dos usuarios
CREATE OR REPLACE FUNCTION get_or_create_direct_conversation(other_user_id UUID)
RETURNS UUID AS $$
DECLARE
  conv_id UUID;
  current_user_id UUID := auth.uid();
BEGIN
  -- Buscar conversación existente entre estos dos usuarios
  SELECT c.id INTO conv_id
  FROM conversations c
  WHERE c.type = 'direct'
  AND EXISTS (
    SELECT 1 FROM conversation_participants cp1
    WHERE cp1.conversation_id = c.id AND cp1.user_id = current_user_id
  )
  AND EXISTS (
    SELECT 1 FROM conversation_participants cp2
    WHERE cp2.conversation_id = c.id AND cp2.user_id = other_user_id
  )
  LIMIT 1;

  -- Si no existe, crear una nueva
  IF conv_id IS NULL THEN
    INSERT INTO conversations (type) VALUES ('direct') RETURNING id INTO conv_id;
    
    -- Agregar ambos participantes
    INSERT INTO conversation_participants (conversation_id, user_id)
    VALUES (conv_id, current_user_id);
    
    INSERT INTO conversation_participants (conversation_id, user_id)
    VALUES (conv_id, other_user_id);
  END IF;

  RETURN conv_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Función RPC: Marcar mensajes como leídos
CREATE OR REPLACE FUNCTION mark_conversation_read(p_conversation_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE conversation_participants
  SET last_read_at = NOW()
  WHERE conversation_id = p_conversation_id
  AND user_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Habilitar Realtime para las tablas
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE conversation_participants;
