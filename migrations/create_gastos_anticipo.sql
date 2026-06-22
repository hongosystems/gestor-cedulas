-- Migración: anticipo de gastos de pericia (módulo GASTOS)
-- Aditiva e idempotente

CREATE TABLE IF NOT EXISTS gastos_anticipo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiccion TEXT,
  numero TEXT NOT NULL,
  anio TEXT NOT NULL,
  caratula TEXT,
  juzgado TEXT,
  expediente_id UUID REFERENCES expedientes(id) ON DELETE SET NULL,
  actuacion_fecha DATE,
  actuacion_fs TEXT,
  actuacion_tipo TEXT,
  detalle TEXT NOT NULL,
  monto NUMERIC,
  moneda TEXT DEFAULT 'ARS',
  plazo_dias INT,
  articulo TEXT,
  pdf_storage_path TEXT,
  pdf_url TEXT,
  estado TEXT NOT NULL DEFAULT 'NUEVO' CHECK (estado IN ('NUEVO', 'NOTIFICADO', 'REVISADO')),
  notificado_at TIMESTAMPTZ,
  match_score INT,
  match_regla TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gastos_anticipo_estado ON gastos_anticipo(estado);
CREATE INDEX IF NOT EXISTS idx_gastos_anticipo_numero_anio ON gastos_anticipo(numero, anio);
CREATE INDEX IF NOT EXISTS idx_gastos_anticipo_created_at ON gastos_anticipo(created_at DESC);

ALTER TABLE gastos_anticipo ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'gastos_anticipo' AND policyname = 'gastos_select'
  ) THEN
    CREATE POLICY gastos_select ON gastos_anticipo
      FOR SELECT TO authenticated
      USING (true);
  END IF;
END $$;

-- Bucket Storage (privado, solo PDF)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'gastos-pericia',
  'gastos-pericia',
  false,
  10485760,
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated users can read gastos-pericia" ON storage.objects;
CREATE POLICY "Authenticated users can read gastos-pericia"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'gastos-pericia');

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'gastos_anticipo' AND policyname = 'gastos_update_authenticated'
  ) THEN
    CREATE POLICY gastos_update_authenticated ON gastos_anticipo
      FOR UPDATE TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
