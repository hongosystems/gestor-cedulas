-- Ejecutar manualmente en Supabase (después de pjn_cargado_at si aplica).
-- Referencia: app/app/page.tsx y rutas API confirmar-pjn / cargar-pjn.

ALTER TABLE cedulas
ADD COLUMN IF NOT EXISTS pjn_cargado_por uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_cedulas_pjn_cargado_por
ON cedulas(pjn_cargado_por) WHERE pjn_cargado_por IS NOT NULL;

COMMENT ON COLUMN cedulas.pjn_cargado_por IS
'Usuario que confirmó carga en PJN (confirmar-pjn / cargar-pjn)';
