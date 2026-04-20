-- Backfill de notas legacy con timestamp "00:00"
-- Regla:
-- - Solo actualiza notas no vacias que NO terminan en "DD/MM/AAAA HH:MM"
-- - Usa fecha de creacion cuando existe (created_at)
-- - Si no existe created_at, usa una fecha alternativa por tabla
-- - Formato final: "<nota> DD/MM/AAAA 00:00"
--
-- Idempotente: puede ejecutarse multiples veces sin duplicar timestamp.

DO $$
DECLARE
  timestamp_suffix_pattern CONSTANT TEXT := '\s\d{2}/\d{2}/\d{4}\s\d{2}:\d{2}$';
  tz_name CONSTANT TEXT := 'America/Argentina/Buenos_Aires';
BEGIN
  -- ==========================
  -- 1) cedulas
  -- ==========================
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'cedulas'
      AND column_name = 'notas'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'cedulas'
        AND column_name = 'created_at'
    ) THEN
      EXECUTE format($sql$
        UPDATE public.cedulas
        SET notas = trim(notas) || ' ' || to_char((created_at AT TIME ZONE %L), 'DD/MM/YYYY') || ' 00:00'
        WHERE notas IS NOT NULL
          AND btrim(notas) <> ''
          AND notas !~ %L
      $sql$, tz_name, timestamp_suffix_pattern);
    ELSIF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'cedulas'
        AND column_name = 'fecha_carga'
    ) THEN
      EXECUTE format($sql$
        UPDATE public.cedulas
        SET notas = trim(notas) || ' ' ||
          CASE
            WHEN fecha_carga::text ~ '^\d{4}-\d{2}-\d{2}' THEN to_char((fecha_carga::timestamptz AT TIME ZONE %L), 'DD/MM/YYYY')
            WHEN fecha_carga::text ~ '^\d{2}/\d{2}/\d{4}$' THEN fecha_carga::text
            ELSE to_char((now() AT TIME ZONE %L), 'DD/MM/YYYY')
          END || ' 00:00'
        WHERE notas IS NOT NULL
          AND btrim(notas) <> ''
          AND notas !~ %L
      $sql$, tz_name, tz_name, timestamp_suffix_pattern);
    ELSE
      EXECUTE format($sql$
        UPDATE public.cedulas
        SET notas = trim(notas) || ' ' || to_char((now() AT TIME ZONE %L), 'DD/MM/YYYY') || ' 00:00'
        WHERE notas IS NOT NULL
          AND btrim(notas) <> ''
          AND notas !~ %L
      $sql$, tz_name, timestamp_suffix_pattern);
    END IF;
  END IF;

  -- ==========================
  -- 2) expedientes
  -- ==========================
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'expedientes'
      AND column_name = 'notas'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'expedientes'
        AND column_name = 'created_at'
    ) THEN
      EXECUTE format($sql$
        UPDATE public.expedientes
        SET notas = trim(notas) || ' ' || to_char((created_at AT TIME ZONE %L), 'DD/MM/YYYY') || ' 00:00'
        WHERE notas IS NOT NULL
          AND btrim(notas) <> ''
          AND notas !~ %L
      $sql$, tz_name, timestamp_suffix_pattern);
    ELSIF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'expedientes'
        AND column_name = 'fecha_ultima_modificacion'
    ) THEN
      EXECUTE format($sql$
        UPDATE public.expedientes
        SET notas = trim(notas) || ' ' ||
          CASE
            WHEN fecha_ultima_modificacion::text ~ '^\d{4}-\d{2}-\d{2}' THEN to_char((fecha_ultima_modificacion::timestamptz AT TIME ZONE %L), 'DD/MM/YYYY')
            WHEN fecha_ultima_modificacion::text ~ '^\d{2}/\d{2}/\d{4}$' THEN fecha_ultima_modificacion::text
            ELSE to_char((now() AT TIME ZONE %L), 'DD/MM/YYYY')
          END || ' 00:00'
        WHERE notas IS NOT NULL
          AND btrim(notas) <> ''
          AND notas !~ %L
      $sql$, tz_name, tz_name, timestamp_suffix_pattern);
    ELSE
      EXECUTE format($sql$
        UPDATE public.expedientes
        SET notas = trim(notas) || ' ' || to_char((now() AT TIME ZONE %L), 'DD/MM/YYYY') || ' 00:00'
        WHERE notas IS NOT NULL
          AND btrim(notas) <> ''
          AND notas !~ %L
      $sql$, tz_name, timestamp_suffix_pattern);
    END IF;
  END IF;

  -- ==========================
  -- 3) pjn_favoritos
  -- ==========================
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pjn_favoritos'
      AND column_name = 'notas'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'pjn_favoritos'
        AND column_name = 'created_at'
    ) THEN
      EXECUTE format($sql$
        UPDATE public.pjn_favoritos
        SET notas = trim(notas) || ' ' || to_char((created_at AT TIME ZONE %L), 'DD/MM/YYYY') || ' 00:00'
        WHERE notas IS NOT NULL
          AND btrim(notas) <> ''
          AND notas !~ %L
      $sql$, tz_name, timestamp_suffix_pattern);
    ELSIF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'pjn_favoritos'
        AND column_name = 'updated_at'
    ) THEN
      EXECUTE format($sql$
        UPDATE public.pjn_favoritos
        SET notas = trim(notas) || ' ' || to_char((updated_at AT TIME ZONE %L), 'DD/MM/YYYY') || ' 00:00'
        WHERE notas IS NOT NULL
          AND btrim(notas) <> ''
          AND notas !~ %L
      $sql$, tz_name, timestamp_suffix_pattern);
    ELSIF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'pjn_favoritos'
        AND column_name = 'fecha_ultima_carga'
    ) THEN
      EXECUTE format($sql$
        UPDATE public.pjn_favoritos
        SET notas = trim(notas) || ' ' ||
          CASE
            WHEN fecha_ultima_carga ~ '^\d{2}/\d{2}/\d{4}$' THEN fecha_ultima_carga
            ELSE to_char((now() AT TIME ZONE %L), 'DD/MM/YYYY')
          END || ' 00:00'
        WHERE notas IS NOT NULL
          AND btrim(notas) <> ''
          AND notas !~ %L
      $sql$, tz_name, timestamp_suffix_pattern);
    ELSE
      EXECUTE format($sql$
        UPDATE public.pjn_favoritos
        SET notas = trim(notas) || ' ' || to_char((now() AT TIME ZONE %L), 'DD/MM/YYYY') || ' 00:00'
        WHERE notas IS NOT NULL
          AND btrim(notas) <> ''
          AND notas !~ %L
      $sql$, tz_name, timestamp_suffix_pattern);
    END IF;
  END IF;
END $$;

