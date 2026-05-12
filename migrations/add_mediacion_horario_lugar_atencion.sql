-- Horario del hecho (HH:MM 24h) y lugar de atención médica (idempotente)

ALTER TABLE mediaciones ADD COLUMN IF NOT EXISTS horario_hecho TEXT;
ALTER TABLE mediaciones ADD COLUMN IF NOT EXISTS lugar_atencion TEXT;
