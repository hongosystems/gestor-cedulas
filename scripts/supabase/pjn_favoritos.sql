-- Tabla para almacenar expedientes favoritos sincronizados desde PJN
-- Ejecutar manualmente en Supabase SQL Editor

CREATE TABLE IF NOT EXISTS pjn_favoritos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    jurisdiccion TEXT NOT NULL,
    numero TEXT NOT NULL,
    anio INTEGER NOT NULL,
    caratula TEXT,
    juzgado TEXT,
    fecha_ultima_carga TEXT, -- Formato DD/MM/AAAA tal como viene del sitio
    observaciones TEXT,
    source_url TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraint único para evitar duplicados
    CONSTRAINT pjn_favoritos_unique UNIQUE (jurisdiccion, numero, anio)
);

-- Índice para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_pjn_favoritos_jurisdiccion_numero_anio 
    ON pjn_favoritos(jurisdiccion, numero, anio);

-- Índice para ordenamiento por fecha de actualización
CREATE INDEX IF NOT EXISTS idx_pjn_favoritos_updated_at 
    ON pjn_favoritos(updated_at DESC);

-- Comentarios en columnas (opcional pero útil)
COMMENT ON TABLE pjn_favoritos IS 'Expedientes favoritos sincronizados desde PJN mediante userscript Tampermonkey';
COMMENT ON COLUMN pjn_favoritos.jurisdiccion IS 'Jurisdicción del expediente (ej: CIV, COM, CNT)';
COMMENT ON COLUMN pjn_favoritos.numero IS 'Número del expediente (string, puede tener ceros a la izquierda)';
COMMENT ON COLUMN pjn_favoritos.anio IS 'Año del expediente';
COMMENT ON COLUMN pjn_favoritos.fecha_ultima_carga IS 'Fecha de última carga en formato DD/MM/AAAA tal como viene del sitio';
COMMENT ON COLUMN pjn_favoritos.source_url IS 'URL de origen en scw.pjn.gov.ar para auditoría';
