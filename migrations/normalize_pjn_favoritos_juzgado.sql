-- Normalización: limpiar columna pjn_favoritos.juzgado
--
-- Objetivo: guardar solo "JUZGADO CIVIL <N>" cuando venga con sufijos del estilo
-- "- SECRETARIA N° X" (u otros textos luego del número).
--
-- Ejecutar en Supabase SQL Editor (base principal).

-- 1) Crear/actualizar función de normalización (idempotente)
CREATE OR REPLACE FUNCTION normalize_juzgado(raw TEXT)
RETURNS TEXT AS $$
DECLARE
    v TEXT;
    m TEXT[];
BEGIN
    IF raw IS NULL THEN
        RETURN NULL;
    END IF;

    v := upper(regexp_replace(trim(raw), '\s+', ' ', 'g'));

    -- Caso principal: "JUZGADO CIVIL <NUM>"
    m := regexp_match(v, '^JUZGADO\s+CIVIL\s+(\d+)\b');
    IF m IS NOT NULL THEN
        RETURN 'JUZGADO CIVIL ' || m[1];
    END IF;

    -- Fallback: recortar sufijo " - SECRETARIA N° X ..." si está al final
    v := regexp_replace(v, '\s*-\s*SECRETAR[ÍI]A\s*N[°º]?\s*\d+\s*.*$', '', 'i');
    v := trim(v);
    IF v = '' THEN
        RETURN NULL;
    END IF;
    RETURN v;
END;
$$ LANGUAGE plpgsql;

-- 2) Actualizar registros existentes (solo los que cambiarían)
UPDATE pjn_favoritos
SET juzgado = normalize_juzgado(juzgado)
WHERE juzgado IS NOT NULL
  AND normalize_juzgado(juzgado) IS DISTINCT FROM juzgado;

-- 3) (Opcional) Ver una muestra de los que quedaron normalizados
-- SELECT id, juzgado FROM pjn_favoritos ORDER BY updated_at DESC LIMIT 50;

