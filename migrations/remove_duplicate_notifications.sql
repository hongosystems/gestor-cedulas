-- Migración: Eliminar notificaciones duplicadas (menciones repetidas)
-- Ejecutar en Supabase SQL Editor
--
-- Elimina duplicados manteniendo la más reciente de cada grupo idéntico
-- (mismo user_id, title, body, en la misma ventana de 1 minuto)
--
-- PREVIEW (ejecutar primero para ver cuántos se eliminarían):
-- SELECT COUNT(*) FROM (SELECT id FROM (
--   SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id, title, body, date_trunc('minute', created_at) ORDER BY created_at DESC) AS rn
--   FROM notifications) sub WHERE rn > 1) x;

WITH duplicadas AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, title, body, date_trunc('minute', created_at)
      ORDER BY created_at DESC
    ) AS rn
  FROM notifications
)
DELETE FROM notifications
WHERE id IN (SELECT id FROM duplicadas WHERE rn > 1);
