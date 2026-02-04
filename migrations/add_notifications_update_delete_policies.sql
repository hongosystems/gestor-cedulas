-- Migración: Agregar políticas RLS para UPDATE y DELETE en notifications
-- Ejecutar este SQL en Supabase SQL Editor

-- Política: Los usuarios pueden actualizar sus propias notificaciones (para marcar como leída/no leída)
DROP POLICY IF EXISTS "Users can update their own notifications" ON notifications;
CREATE POLICY "Users can update their own notifications"
ON notifications
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Política: Los usuarios pueden eliminar sus propias notificaciones
DROP POLICY IF EXISTS "Users can delete their own notifications" ON notifications;
CREATE POLICY "Users can delete their own notifications"
ON notifications
FOR DELETE
USING (user_id = auth.uid());
