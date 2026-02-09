-- Migración: Crear tabla pjn_sync_metadata para guardar la última fecha de sincronización
-- Ejecutar este SQL en Supabase SQL Editor

-- 1. Crear tabla pjn_sync_metadata
-- Usamos un ID fijo para asegurar que solo haya un registro
CREATE TABLE IF NOT EXISTS pjn_sync_metadata (
    id UUID PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
    last_sync_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Crear función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_pjn_sync_metadata_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Crear trigger para actualizar updated_at
DROP TRIGGER IF EXISTS trigger_update_pjn_sync_metadata_updated_at ON pjn_sync_metadata;
CREATE TRIGGER trigger_update_pjn_sync_metadata_updated_at
    BEFORE UPDATE ON pjn_sync_metadata
    FOR EACH ROW
    EXECUTE FUNCTION update_pjn_sync_metadata_updated_at();

-- 4. Insertar registro inicial si no existe
INSERT INTO pjn_sync_metadata (id, last_sync_at)
VALUES ('00000000-0000-0000-0000-000000000001'::uuid, NOW())
ON CONFLICT (id) DO NOTHING;

-- 5. Habilitar RLS (Row Level Security)
ALTER TABLE pjn_sync_metadata ENABLE ROW LEVEL SECURITY;

-- 6. Política: Todos los usuarios autenticados pueden leer metadata
DROP POLICY IF EXISTS "Authenticated users can view pjn_sync_metadata" ON pjn_sync_metadata;
CREATE POLICY "Authenticated users can view pjn_sync_metadata"
    ON pjn_sync_metadata FOR SELECT
    USING (auth.role() = 'authenticated');

-- 7. Política: Solo service role puede actualizar (desde el endpoint)
DROP POLICY IF EXISTS "Service role can update pjn_sync_metadata" ON pjn_sync_metadata;
CREATE POLICY "Service role can update pjn_sync_metadata"
    ON pjn_sync_metadata FOR UPDATE
    USING (auth.role() = 'service_role');

-- 8. Comentarios
COMMENT ON TABLE pjn_sync_metadata IS 'Metadata de sincronización de pjn_favoritos. Guarda la última fecha/hora de sincronización.';
COMMENT ON COLUMN pjn_sync_metadata.last_sync_at IS 'Fecha y hora de la última sincronización exitosa de pjn_favoritos';
