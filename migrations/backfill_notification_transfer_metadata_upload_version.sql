-- Backfill: metadata.transfer_id en notificaciones viejas de "nueva versión"
-- Contexto: /api/transfers/upload-version insertaba notificaciones con link
-- /app/recibidos pero sin metadata; la bandeja no podía mostrar "Descargar archivo".
--
-- Heurística (v2, más amplia que v1):
--   - link /app/recibidos
--   - title: títulos exactos conocidos O cualquier título que termine en "actualizada"
--   - body: versión extraída con regex case-insensitive y espacios flexibles
--   - user_id = destinatario del aviso (otra parte del transfer respecto de created_by)
--   - created_at de la versión dentro de una ventana amplia respecto a la notificación
--
-- Idempotente: no toca filas que ya tienen metadata.transfer_id.
-- Si ya ejecutaste v1 y quedaron filas sin matchear, volvé a ejecutar este script completo.

-- Contar candidatos sin transfer_id (ajustá filtros si hace falta):
-- SELECT count(*) FROM notifications n
-- WHERE n.link = '/app/recibidos'
--   AND COALESCE(n.metadata, '{}'::jsonb) ->> 'transfer_id' IS NULL
--   AND regexp_match(n.body, 'subió\s+una\s+nueva\s+versión\s*\(\s*([0-9]+)\s*\)', 'i') IS NOT NULL
--   AND (
--     n.title IN ('Cédula actualizada', 'Oficio actualizada', 'Causas Penales actualizada')
--     OR (n.title ILIKE '%actualizada%' AND length(trim(n.title)) < 120)
--   );

WITH parsed AS (
  SELECT
    n.id,
    n.user_id,
    n.created_at,
    (regexp_match(n.body, 'subió\s+una\s+nueva\s+versión\s*\(\s*([0-9]+)\s*\)', 'i'))[1]::int AS ver
  FROM notifications n
  WHERE n.link = '/app/recibidos'
    AND COALESCE(n.metadata, '{}'::jsonb) ->> 'transfer_id' IS NULL
    AND regexp_match(n.body, 'subió\s+una\s+nueva\s+versión\s*\(\s*([0-9]+)\s*\)', 'i') IS NOT NULL
    AND (
      n.title IN ('Cédula actualizada', 'Oficio actualizada', 'Causas Penales actualizada')
      OR (n.title ILIKE '%actualizada%' AND length(trim(n.title)) < 120)
    )
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
  WHERE p.ver IS NOT NULL
    AND (
      (ft.sender_user_id = p.user_id AND ftv.created_by = ft.recipient_user_id)
      OR (ft.recipient_user_id = p.user_id AND ftv.created_by = ft.sender_user_id)
    )
    AND ftv.created_at >= p.created_at - interval '48 hours'
    AND ftv.created_at <= p.created_at + interval '10 minutes'
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
