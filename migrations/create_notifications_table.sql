-- Migración: Crear tabla de notificaciones y función RPC
-- Ejecutar este SQL en Supabase SQL Editor

-- Tabla: notifications
-- Almacena notificaciones para usuarios
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para mejorar el rendimiento
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read) WHERE is_read = false;

-- Políticas RLS para notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Política: Los usuarios solo pueden ver sus propias notificaciones
DROP POLICY IF EXISTS "Users can view their own notifications" ON notifications;
CREATE POLICY "Users can view their own notifications"
ON notifications
FOR SELECT
USING (user_id = auth.uid());

-- Política: Solo el sistema (service role) puede crear notificaciones
-- Los usuarios no pueden crear notificaciones directamente
-- (se crean desde las APIs con service role)
-- Si necesitas que los usuarios puedan crear notificaciones, descomenta la siguiente política:
-- DROP POLICY IF EXISTS "Users can create notifications" ON notifications;
-- CREATE POLICY "Users can create notifications"
-- ON notifications
-- FOR INSERT
-- WITH CHECK (user_id = auth.uid());

-- Función RPC: Marcar notificación como leída
CREATE OR REPLACE FUNCTION mark_notification_read(p_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE notifications
  SET is_read = true
  WHERE id = p_id AND user_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comentario: La función usa SECURITY DEFINER para permitir que los usuarios marquen sus propias notificaciones como leídas
