-- Migración: Backfill fecha_estudio_realizado para gestiones con ESTUDIO_REALIZADO
-- Actualiza aquellos que tengan ESTUDIO_REALIZADO sin fecha_estudio_realizado,
-- usando updated_at como el día en que se pasó a ESTUDIO_REALIZADO.
-- Esto permite calcular correctamente el conteo de días (reloj congelado).

UPDATE gestiones_estudio
SET fecha_estudio_realizado = updated_at
WHERE estado = 'ESTUDIO_REALIZADO'
  AND fecha_estudio_realizado IS NULL;
