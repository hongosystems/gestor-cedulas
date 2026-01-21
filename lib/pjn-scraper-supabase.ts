import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _pjnScraperSupabase: SupabaseClient | undefined;

/**
 * Cliente de Supabase para el proyecto pjn-scraper
 * Requiere variables de entorno:
 * - NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL
 * - NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_ANON_KEY
 */
function initPjnScraperSupabase(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseAnonKey) {
    // En build time, retornar un cliente dummy que fallará en runtime si se usa
    return createClient("https://placeholder.supabase.co", "placeholder-key");
  }
  
  return createClient(supabaseUrl, supabaseAnonKey);
}

export const pjnScraperSupabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    if (!_pjnScraperSupabase) {
      _pjnScraperSupabase = initPjnScraperSupabase();
    }
    const value = (_pjnScraperSupabase as any)[prop];
    if (typeof value === 'function') {
      return value.bind(_pjnScraperSupabase);
    }
    return value;
  },
});
