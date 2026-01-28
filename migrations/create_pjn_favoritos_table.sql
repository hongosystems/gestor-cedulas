-- Migración: Crear tabla pjn_favoritos si no existe
-- Ejecutar este SQL en Supabase SQL Editor
-- 
-- Esta tabla almacena los expedientes favoritos sincronizados desde PJN
-- y se usa para mostrar en "Mis Juzgados" como espejo de los favoritos

-- 1. Crear tabla pjn_favoritos
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

-- 2. Crear índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_pjn_favoritos_jurisdiccion_numero_anio 
    ON pjn_favoritos(jurisdiccion, numero, anio);

CREATE INDEX IF NOT EXISTS idx_pjn_favoritos_juzgado 
    ON pjn_favoritos(juzgado);

-- 3. Índice para ordenamiento por fecha de actualización
CREATE INDEX IF NOT EXISTS idx_pjn_favoritos_updated_at 
    ON pjn_favoritos(updated_at DESC);

-- 4. Habilitar RLS (Row Level Security)
ALTER TABLE pjn_favoritos ENABLE ROW LEVEL SECURITY;

-- 5. Política: Todos los usuarios autenticados pueden leer favoritos
CREATE POLICY "Authenticated users can view pjn_favoritos"
    ON pjn_favoritos FOR SELECT
    USING (auth.role() = 'authenticated');

-- 6. Comentarios en columnas
COMMENT ON TABLE pjn_favoritos IS 'Expedientes favoritos sincronizados desde PJN mediante userscript Tampermonkey';
COMMENT ON COLUMN pjn_favoritos.jurisdiccion IS 'Jurisdicción del expediente (ej: CIV, COM, CNT)';
COMMENT ON COLUMN pjn_favoritos.numero IS 'Número del expediente (string, puede tener ceros a la izquierda)';
COMMENT ON COLUMN pjn_favoritos.anio IS 'Año del expediente';
COMMENT ON COLUMN pjn_favoritos.caratula IS 'Carátula del expediente';
COMMENT ON COLUMN pjn_favoritos.juzgado IS 'Juzgado del expediente';
COMMENT ON COLUMN pjn_favoritos.fecha_ultima_carga IS 'Fecha de última carga en formato DD/MM/AAAA tal como viene del sitio';
COMMENT ON COLUMN pjn_favoritos.observaciones IS 'Observaciones del expediente';
COMMENT ON COLUMN pjn_favoritos.source_url IS 'URL de origen en scw.pjn.gov.ar para auditoría';

-- 7. Verificar que la tabla se creó correctamente
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pjn_favoritos') THEN
        RAISE NOTICE '✅ Tabla pjn_favoritos creada exitosamente';
    ELSE
        RAISE WARNING '⚠️  La tabla pjn_favoritos no se pudo crear';
    END IF;
END $$;
