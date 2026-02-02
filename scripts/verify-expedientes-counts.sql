-- Script para verificar los conteos de expedientes por abogado
-- Compara expedientes locales + favoritos PJN asignados según user_juzgados

-- 1. Verificar juzgados asignados por usuario
SELECT 
    uj.user_id,
    p.full_name,
    COUNT(DISTINCT uj.juzgado) as juzgados_asignados,
    STRING_AGG(DISTINCT uj.juzgado, ', ' ORDER BY uj.juzgado) as lista_juzgados
FROM user_juzgados uj
LEFT JOIN profiles p ON p.id = uj.user_id
GROUP BY uj.user_id, p.full_name
ORDER BY p.full_name;

-- 2. Contar expedientes locales por usuario (owner_user_id)
SELECT 
    e.owner_user_id,
    p.full_name,
    COUNT(*) as expedientes_locales
FROM expedientes e
LEFT JOIN profiles p ON p.id = e.owner_user_id
WHERE e.estado = 'ABIERTO'
GROUP BY e.owner_user_id, p.full_name
ORDER BY p.full_name;

-- 3. Contar favoritos PJN por juzgado
SELECT 
    juzgado,
    COUNT(*) as total_favoritos
FROM pjn_favoritos
WHERE juzgado IS NOT NULL AND juzgado != ''
GROUP BY juzgado
ORDER BY juzgado;

-- 4. Verificar favoritos PJN que deberían asignarse a cada usuario
-- (basado en coincidencia de juzgados)
WITH user_juzgados_normalizados AS (
    SELECT 
        uj.user_id,
        p.full_name,
        UPPER(TRIM(REGEXP_REPLACE(uj.juzgado, '\s+', ' ', 'g'))) as juzgado_normalizado,
        uj.juzgado as juzgado_original
    FROM user_juzgados uj
    LEFT JOIN profiles p ON p.id = uj.user_id
),
favoritos_normalizados AS (
    SELECT 
        id,
        juzgado,
        UPPER(TRIM(REGEXP_REPLACE(juzgado, '\s+', ' ', 'g'))) as juzgado_normalizado
    FROM pjn_favoritos
    WHERE juzgado IS NOT NULL AND juzgado != ''
),
matches AS (
    SELECT 
        ujn.user_id,
        ujn.full_name,
        fn.id as favorito_id,
        fn.juzgado as favorito_juzgado,
        ujn.juzgado_original as juzgado_asignado
    FROM user_juzgados_normalizados ujn
    INNER JOIN favoritos_normalizados fn ON 
        -- Comparación exacta
        ujn.juzgado_normalizado = fn.juzgado_normalizado
        OR
        -- Comparación por número de juzgado civil
        (
            ujn.juzgado_normalizado LIKE '%JUZGADO%CIVIL%' 
            AND fn.juzgado_normalizado LIKE '%JUZGADO%CIVIL%'
            AND SUBSTRING(ujn.juzgado_normalizado FROM '(\d+)') = SUBSTRING(fn.juzgado_normalizado FROM '(\d+)')
            AND SUBSTRING(ujn.juzgado_normalizado FROM '(\d+)') IS NOT NULL
        )
)
SELECT 
    user_id,
    full_name,
    COUNT(DISTINCT favorito_id) as favoritos_pjn_asignados
FROM matches
GROUP BY user_id, full_name
ORDER BY full_name;

-- 5. Resumen total por usuario (expedientes locales + favoritos PJN)
WITH expedientes_locales AS (
    SELECT 
        e.owner_user_id,
        p.full_name,
        COUNT(*) as expedientes_locales
    FROM expedientes e
    LEFT JOIN profiles p ON p.id = e.owner_user_id
    WHERE e.estado = 'ABIERTO'
    GROUP BY e.owner_user_id, p.full_name
),
user_juzgados_normalizados AS (
    SELECT 
        uj.user_id,
        p.full_name,
        UPPER(TRIM(REGEXP_REPLACE(uj.juzgado, '\s+', ' ', 'g'))) as juzgado_normalizado,
        uj.juzgado as juzgado_original
    FROM user_juzgados uj
    LEFT JOIN profiles p ON p.id = uj.user_id
),
favoritos_normalizados AS (
    SELECT 
        id,
        juzgado,
        UPPER(TRIM(REGEXP_REPLACE(juzgado, '\s+', ' ', 'g'))) as juzgado_normalizado
    FROM pjn_favoritos
    WHERE juzgado IS NOT NULL AND juzgado != ''
),
favoritos_por_usuario AS (
    SELECT 
        ujn.user_id,
        ujn.full_name,
        COUNT(DISTINCT fn.id) as favoritos_pjn
    FROM user_juzgados_normalizados ujn
    INNER JOIN favoritos_normalizados fn ON 
        ujn.juzgado_normalizado = fn.juzgado_normalizado
        OR
        (
            ujn.juzgado_normalizado LIKE '%JUZGADO%CIVIL%' 
            AND fn.juzgado_normalizado LIKE '%JUZGADO%CIVIL%'
            AND SUBSTRING(ujn.juzgado_normalizado FROM '(\d+)') = SUBSTRING(fn.juzgado_normalizado FROM '(\d+)')
            AND SUBSTRING(ujn.juzgado_normalizado FROM '(\d+)') IS NOT NULL
        )
    GROUP BY ujn.user_id, ujn.full_name
)
SELECT 
    COALESCE(el.owner_user_id, fpu.user_id) as user_id,
    COALESCE(el.full_name, fpu.full_name) as full_name,
    COALESCE(el.expedientes_locales, 0) as expedientes_locales,
    COALESCE(fpu.favoritos_pjn, 0) as favoritos_pjn,
    COALESCE(el.expedientes_locales, 0) + COALESCE(fpu.favoritos_pjn, 0) as total_esperado
FROM expedientes_locales el
FULL OUTER JOIN favoritos_por_usuario fpu ON el.owner_user_id = fpu.user_id
ORDER BY full_name;
