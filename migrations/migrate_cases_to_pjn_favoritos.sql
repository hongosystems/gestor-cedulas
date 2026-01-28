-- Migración: Migrar datos de la tabla cases a pjn_favoritos
-- 
-- IMPORTANTE: Este script SQL solo funciona si la tabla cases está en la MISMA base de datos
-- que pjn_favoritos (base de datos principal).
-- 
-- Si cases está en una base de datos diferente (pjn-scraper), usa el script Node.js:
--   node scripts/migrate_cases_to_pjn_favoritos.mjs
--
-- Ejecutar este SQL en Supabase SQL Editor SOLO si cases está en la misma base de datos

-- 1. Verificar que la tabla cases existe en esta base de datos
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cases') THEN
        RAISE WARNING 'La tabla cases no existe en esta base de datos.';
        RAISE WARNING 'Si cases está en otra base de datos (pjn-scraper), usa el script Node.js:';
        RAISE WARNING '  node scripts/migrate_cases_to_pjn_favoritos.mjs';
        RETURN; -- Salir sin error, solo avisar
    END IF;
    
    RAISE NOTICE '✅ Tabla cases encontrada en esta base de datos';
END $$;

-- 2. Función auxiliar para extraer jurisdiccion, numero y anio desde key/expediente
CREATE OR REPLACE FUNCTION parse_expediente(exp_text TEXT)
RETURNS TABLE(jurisdiccion TEXT, numero TEXT, anio INTEGER) AS $$
DECLARE
    v_jurisdiccion TEXT;
    v_numero TEXT;
    v_anio INTEGER;
    v_parts TEXT[];
BEGIN
    -- Limpiar el texto
    exp_text := TRIM(COALESCE(exp_text, ''));
    
    IF exp_text = '' THEN
        RETURN;
    END IF;
    
    -- Extraer jurisdiccion (primera palabra, ej: "CIV", "COM", "CNT")
    v_jurisdiccion := (regexp_match(exp_text, '^([A-Z]+)'))[1];
    
    -- Extraer numero y anio (formato: "106590/2024" o "106590/2024/1")
    -- Buscar patrón: espacio seguido de números, barra, números
    v_parts := regexp_match(exp_text, '\s+(\d+)/(\d+)');
    
    IF v_parts IS NOT NULL AND array_length(v_parts, 1) >= 3 THEN
        v_numero := v_parts[1];
        v_anio := CAST(v_parts[2] AS INTEGER);
    ELSE
        -- Intentar otro formato
        v_parts := regexp_match(exp_text, '/(\d{4})');
        IF v_parts IS NOT NULL THEN
            v_anio := CAST(v_parts[1] AS INTEGER);
            -- Extraer numero antes de la barra
            v_parts := regexp_match(exp_text, '\s+(\d+)/');
            IF v_parts IS NOT NULL THEN
                v_numero := v_parts[1];
            END IF;
        END IF;
    END IF;
    
    -- Retornar solo si tenemos todos los datos
    IF v_jurisdiccion IS NOT NULL AND v_numero IS NOT NULL AND v_anio IS NOT NULL THEN
        RETURN QUERY SELECT v_jurisdiccion, v_numero, v_anio;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- 3. Función auxiliar para extraer observaciones de movimientos JSONB
CREATE OR REPLACE FUNCTION extract_observaciones(movimientos_jsonb JSONB)
RETURNS TEXT AS $$
DECLARE
    v_mov JSONB;
    v_col TEXT;
    v_tipo_actuacion TEXT := NULL;
    v_detalle TEXT := NULL;
    v_result TEXT;
BEGIN
    -- Si movimientos es NULL o no es un array, retornar NULL
    IF movimientos_jsonb IS NULL OR jsonb_typeof(movimientos_jsonb) != 'array' THEN
        RETURN NULL;
    END IF;
    
    -- Iterar sobre cada movimiento en el array
    FOR v_mov IN SELECT * FROM jsonb_array_elements(movimientos_jsonb)
    LOOP
        -- Si el movimiento tiene "cols" (array de strings)
        IF v_mov ? 'cols' AND jsonb_typeof(v_mov->'cols') = 'array' THEN
            -- Iterar sobre cada columna en cols
            FOR v_col IN SELECT jsonb_array_elements_text(v_mov->'cols')
            LOOP
                -- Buscar "Tipo actuacion:" con contenido
                IF v_tipo_actuacion IS NULL THEN
                    IF v_col ~* '^Tipo\s+actuacion:\s+.+' THEN
                        v_tipo_actuacion := regexp_replace(v_col, '^Tipo\s+actuacion:\s*(.+)$', 'Tipo actuacion: \1', 'i');
                    END IF;
                END IF;
                
                -- Buscar "Detalle:" con contenido
                IF v_detalle IS NULL THEN
                    IF v_col ~* '^Detalle:\s+.+' THEN
                        v_detalle := regexp_replace(v_col, '^Detalle:\s*(.+)$', 'Detalle: \1', 'i');
                    END IF;
                END IF;
                
                -- Si encontramos ambos, salir del loop
                IF v_tipo_actuacion IS NOT NULL AND v_detalle IS NOT NULL THEN
                    EXIT;
                END IF;
            END LOOP;
            
            -- Si encontramos ambos, formatear y retornar
            IF v_tipo_actuacion IS NOT NULL AND v_detalle IS NOT NULL THEN
                v_result := v_tipo_actuacion || E'\n' || v_detalle;
                RETURN v_result;
            END IF;
        END IF;
    END LOOP;
    
    -- Si no encontramos ambos, retornar NULL
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 3b. Normalizar juzgado para guardar SIN "- SECRETARIA N° X"
-- Ej: "JUZGADO CIVIL 89 - SECRETARIA N° 2" -> "JUZGADO CIVIL 89"
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
    m := regexp_match(v, '^JUZGADO\s+CIVIL\s+(\d+)\b');
    IF m IS NOT NULL THEN
        RETURN 'JUZGADO CIVIL ' || m[1];
    END IF;
    v := regexp_replace(v, '\s*-\s*SECRETAR[ÍI]A\s*N[°º]?\s*\d+\s*.*$', '', 'i');
    v := trim(v);
    IF v = '' THEN
        RETURN NULL;
    END IF;
    RETURN v;
END;
$$ LANGUAGE plpgsql;

-- 4. Insertar/Actualizar datos de cases a pjn_favoritos (usando UPSERT)
INSERT INTO pjn_favoritos (jurisdiccion, numero, anio, caratula, juzgado, fecha_ultima_carga, observaciones, source_url, updated_at)
SELECT 
    pe.jurisdiccion,
    pe.numero,
    pe.anio,
    c.caratula,
    normalize_juzgado(c.dependencia) AS juzgado,
    
    -- Convertir ult_act a formato DD/MM/AAAA si existe
    CASE 
        WHEN c.ult_act IS NOT NULL THEN
            -- Si ult_act es texto en formato DD/MM/YYYY, mantenerlo
            CASE 
                WHEN c.ult_act::text ~ '^\d{2}/\d{2}/\d{4}$' THEN
                    c.ult_act::text
                -- Si es fecha/timestamp, convertir a DD/MM/YYYY
                ELSE
                    TO_CHAR(c.ult_act::date, 'DD/MM/YYYY')
            END
        ELSE NULL
    END AS fecha_ultima_carga,
    
    -- Extraer observaciones de movimientos JSONB
    extract_observaciones(c.movimientos) AS observaciones,
    
    -- source_url
    NULL AS source_url,
    
    -- updated_at usar NOW() o el ult_act si existe
    COALESCE(
        CASE 
            WHEN c.ult_act IS NOT NULL AND c.ult_act::text !~ '^\d{2}/\d{2}/\d{4}$' THEN
                c.ult_act::timestamptz
            ELSE NULL
        END,
        NOW()
    ) AS updated_at

FROM cases c
CROSS JOIN LATERAL parse_expediente(COALESCE(c.key, c.expediente)) pe

-- Solo procesar casos donde se pudo extraer la información correctamente
WHERE pe.jurisdiccion IS NOT NULL
  AND pe.numero IS NOT NULL
  AND pe.anio IS NOT NULL

-- Usar ON CONFLICT para actualizar registros existentes
ON CONFLICT (jurisdiccion, numero, anio) 
DO UPDATE SET
    caratula = EXCLUDED.caratula,
    juzgado = EXCLUDED.juzgado,
    fecha_ultima_carga = EXCLUDED.fecha_ultima_carga,
    observaciones = COALESCE(EXCLUDED.observaciones, pjn_favoritos.observaciones), -- Solo actualizar si hay observaciones nuevas
    updated_at = EXCLUDED.updated_at;

-- 5. Verificar resultados
DO $$
DECLARE
    v_count INTEGER;
    v_con_observaciones INTEGER;
    v_con_fecha INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count FROM pjn_favoritos;
    SELECT COUNT(*) INTO v_con_observaciones FROM pjn_favoritos WHERE observaciones IS NOT NULL;
    SELECT COUNT(*) INTO v_con_fecha FROM pjn_favoritos WHERE fecha_ultima_carga IS NOT NULL;
    
    RAISE NOTICE '✅ Migración completada.';
    RAISE NOTICE '   Total de registros en pjn_favoritos: %', v_count;
    RAISE NOTICE '   Registros con observaciones: %', v_con_observaciones;
    RAISE NOTICE '   Registros con fecha: %', v_con_fecha;
END $$;
