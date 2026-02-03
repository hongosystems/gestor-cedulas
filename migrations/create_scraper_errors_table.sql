-- Migración: Crear tabla para registrar errores del scraper
-- Esta tabla permite que el scraper registre dónde falló y los procese primero en la siguiente ejecución

CREATE TABLE IF NOT EXISTS scraper_errors (
    id BIGSERIAL PRIMARY KEY,
    page INTEGER NOT NULL,
    row INTEGER NOT NULL,
    expediente_key TEXT,
    error_type TEXT NOT NULL, -- 'timeout', 'navigation', 'read_error', 'reload_error', 'paginator_error'
    error_message TEXT,
    error_details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    resolved BOOLEAN DEFAULT FALSE,
    retry_count INTEGER DEFAULT 0,
    last_retry_at TIMESTAMPTZ,
    UNIQUE(page, row, error_type) -- Evitar duplicados del mismo error
);

-- Índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_scraper_errors_resolved ON scraper_errors(resolved, created_at);
CREATE INDEX IF NOT EXISTS idx_scraper_errors_page_row ON scraper_errors(page, row);
CREATE INDEX IF NOT EXISTS idx_scraper_errors_expediente ON scraper_errors(expediente_key) WHERE expediente_key IS NOT NULL;

-- Comentarios
COMMENT ON TABLE scraper_errors IS 'Registra errores del scraper para procesarlos primero en la siguiente ejecución';
COMMENT ON COLUMN scraper_errors.error_type IS 'Tipo de error: timeout, navigation, read_error, reload_error, paginator_error';
COMMENT ON COLUMN scraper_errors.resolved IS 'Indica si el error ya fue resuelto/procesado exitosamente';
