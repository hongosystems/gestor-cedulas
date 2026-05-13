-- Backfill: metadata.transfer_id en notificaciones viejas de "nueva versión"
-- Contexto: /api/transfers/upload-version insertaba notificaciones con link
-- /app/recibidos pero sin metadata; la bandeja no podía mostrar "Descargar archivo".
--
-- Heurística (conservadora):
--   - title exacto: Cédula / Oficio / Causas Penales + " actualizada"
--   - body contiene "subió una nueva versión (N)" — N debe coincidir con file_transfer_versions.version
--   - user_id de la notificación es quien recibe (la otra parte del transfer respecto de created_by)
--   - file_transfer_versions.created_at cercano a notifications.created_at
--
-- Idempotente: no toca filas que ya tienen metadata.transfer_id.
-- Ejecutar en Supabase SQL Editor (o psql) tras deploy del fix en upload-version.

-- Antes del UPDATE, contar candidatos (mismos filtros que "parsed"):
-- SELECT count(*) FROM notifications n
-- WHERE n.link = '/app/recibidos'
--   AND n.title IN ('Cédula actualizada', 'Oficio actualizada', 'Causas Penales actualizada')
--   AND COALESCE(n.metadata, '{}'::jsonb) ->> 'transfer_id' IS NULL
--   AND n.body ~ 'subió una nueva versión \([0-9]+\)';
--
-- Después del UPDATE, ver si quedaron sin matchear (debería ser 0 o muy bajo):
-- SELECT id, title, body, created_at FROM notifications n
-- WHERE n.link = '/app/recibidos'
--   AND n.title IN ('Cédula actualizada', 'Oficio actualizada', 'Causas Penales actualizada')
--   AND COALESCE(n.metadata, '{}'::jsonb) ->> 'transfer_id' IS NULL
--   AND n.body ~ 'subió una nueva versión \([0-9]+\)';

WITH parsed AS (
  SELECT
    n.id,
    n.user_id,
    n.created_at,
    (substring(n.body FROM 'subió una nueva versión \(([0-9]+)\)'))::int AS ver
  FROM notifications n
  WHERE n.link = '/app/recibidos'
    AND n.title IN ('Cédula actualizada', 'Oficio actualizada', 'Causas Penales actualizada')
    AND COALESCE(n.metadata, '{}'::jsonb) ->> 'transfer_id' IS NULL
    AND n.body ~ 'subió una nueva versión \([0-9]+\)'
),
candidates AS (
  SELECT DISTINCT ON (p.id)
    p.id AS notif_id,
    ft.id AS transfer_id,
    ftv.created_by AS sender_id,
    ft.doc_type,
    ft.title
  FROM parsed p
  INNER JOIN file_transfer_versions ftv ON ftv.version = p.ver
  INNER JOIN file_transfers ft ON ft.id = ftv.transfer_id
  WHERE (
      (ft.sender_user_id = p.user_id AND ftv.created_by = ft.recipient_user_id)
      OR (ft.recipient_user_id = p.user_id AND ftv.created_by = ft.sender_user_id)
    )
    AND ftv.created_at >= p.created_at - interval '5 minutes'
    AND ftv.created_at <= p.created_at + interval '1 minute'
  ORDER BY p.id, abs(extract(epoch FROM (ftv.created_at - p.created_at)))
)
UPDATE notifications n
SET metadata = COALESCE(n.metadata, '{}'::jsonb) || jsonb_strip_nulls(
    jsonb_build_object(
      'transfer_id', c.transfer_id::text,
      'sender_id', c.sender_id::text,
      'doc_type', c.doc_type::text,
      'title', to_jsonb(c.title)
    )
  )
FROM candidates c
WHERE n.id = c.notif_id;
