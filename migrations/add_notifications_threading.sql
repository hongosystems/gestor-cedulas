-- Migración: Agregar soporte para threads y metadata en notifications
-- Ejecutar este SQL en Supabase SQL Editor

-- Agregar campos para threading y metadata
ALTER TABLE notifications 
ADD COLUMN IF NOT EXISTS thread_id UUID REFERENCES notifications(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES notifications(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS expediente_id UUID,
ADD COLUMN IF NOT EXISTS is_pjn_favorito BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS nota_context TEXT, -- Parte de la nota donde fueron mencionados
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb; -- Carátula, juzgado, número, etc.

-- Índices para mejorar el rendimiento
CREATE INDEX IF NOT EXISTS idx_notifications_thread_id ON notifications(thread_id);
CREATE INDEX IF NOT EXISTS idx_notifications_parent_id ON notifications(parent_id);
CREATE INDEX IF NOT EXISTS idx_notifications_expediente_id ON notifications(expediente_id);

-- Función para obtener el thread_id raíz (si no tiene thread_id, usar su propio id)
CREATE OR REPLACE FUNCTION get_thread_root(p_notification_id UUID)
RETURNS UUID AS $$
DECLARE
  v_thread_id UUID;
  v_parent_id UUID;
BEGIN
  SELECT thread_id, parent_id INTO v_thread_id, v_parent_id
  FROM notifications
  WHERE id = p_notification_id;
  
  -- Si tiene thread_id, retornarlo
  IF v_thread_id IS NOT NULL THEN
    RETURN v_thread_id;
  END IF;
  
  -- Si no tiene thread_id pero tiene parent_id, buscar el root
  IF v_parent_id IS NOT NULL THEN
    RETURN get_thread_root(v_parent_id);
  END IF;
  
  -- Si no tiene ni thread_id ni parent_id, es el root
  RETURN p_notification_id;
END;
$$ LANGUAGE plpgsql;

-- Comentario: Los mensajes originales (menciones) no tendrán thread_id ni parent_id
-- Las respuestas tendrán parent_id apuntando al mensaje al que responden
-- El thread_id se calcula automáticamente usando la función get_thread_root
