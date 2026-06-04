-- Bandeja: mensaje persistente y preparación para threading (Fase 2)
-- Ejecutar en Supabase SQL Editor antes de desplegar el cambio de API.

ALTER TABLE file_transfers
  ADD COLUMN IF NOT EXISTS message TEXT;

ALTER TABLE file_transfers
  ADD COLUMN IF NOT EXISTS expediente_caratula TEXT;

ALTER TABLE file_transfers
  ADD COLUMN IF NOT EXISTS expediente_juzgado TEXT;

-- expediente_ref puede existir ya en producción; idempotente
ALTER TABLE file_transfers
  ADD COLUMN IF NOT EXISTS expediente_ref TEXT;

-- Agrupación futura de conversaciones (sin lógica de threading aún)
ALTER TABLE file_transfers
  ADD COLUMN IF NOT EXISTS thread_id UUID REFERENCES file_transfers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_file_transfers_thread_id ON file_transfers(thread_id);

COMMENT ON COLUMN file_transfers.message IS 'Cuerpo del mensaje interno (puede existir sin adjunto)';
COMMENT ON COLUMN file_transfers.thread_id IS 'Raíz de hilo; reservado para Fase 2 threading';
