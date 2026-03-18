-- Agrega campos para el Formulario de Mediación (idempotente)

ALTER TABLE mediaciones ADD COLUMN IF NOT EXISTS linea_interno TEXT;
ALTER TABLE mediaciones ADD COLUMN IF NOT EXISTS articulo TEXT;
ALTER TABLE mediaciones ADD COLUMN IF NOT EXISTS intervino TEXT;
ALTER TABLE mediaciones ADD COLUMN IF NOT EXISTS lesiones_ambos TEXT;

-- Campo separado para empresa/razón social en requeridos
ALTER TABLE mediacion_requeridos ADD COLUMN IF NOT EXISTS empresa_nombre_razon_social TEXT;

