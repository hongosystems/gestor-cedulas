/**
 * Script para actualizar movimientos de expedientes en pjn_favoritos
 * desde cases (pjn-scraper) cuando no tienen movimientos o están desactualizados
 * 
 * Uso:
 *   node scripts/update-movimientos-pjn-favoritos.mjs
 * 
 * Requiere variables de entorno (cargadas desde .env.local):
 *   - NEXT_PUBLIC_SUPABASE_URL (base principal)
 *   - SUPABASE_SERVICE_ROLE_KEY (base principal)
 *   - NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL (base pjn-scraper)
 *   - NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_ANON_KEY (base pjn-scraper)
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Cargar variables de entorno
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env.local') });

// Cliente para base de datos principal (gestor-cedulas)
const mainSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const mainSupabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Cliente para base de datos pjn-scraper
const pjnSupabaseUrl = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL || mainSupabaseUrl;
const pjnSupabaseAnonKey = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!mainSupabaseUrl || !mainSupabaseServiceKey) {
  console.error('❌ Error: Faltan variables de entorno de la base principal');
  console.error('   Requeridas: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (!pjnSupabaseUrl || !pjnSupabaseAnonKey) {
  console.error('❌ Error: Faltan variables de entorno de pjn-scraper');
  console.error('   Requeridas: NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL, NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_ANON_KEY');
  process.exit(1);
}

const mainSupabase = createClient(mainSupabaseUrl, mainSupabaseServiceKey);
const pjnSupabase = createClient(pjnSupabaseUrl, pjnSupabaseAnonKey);

async function updateMovimientos() {
  console.log('🔄 Iniciando actualización de movimientos en pjn_favoritos...\n');

  try {
    // 1. Obtener todos los favoritos que no tienen movimientos o tienen movimientos antiguos
    console.log('📋 Leyendo favoritos de pjn_favoritos...');
    const { data: favoritos, error: favoritosErr } = await mainSupabase
      .from("pjn_favoritos")
      .select("id, jurisdiccion, numero, anio, movimientos, updated_at")
      .order("updated_at", { ascending: false });

    if (favoritosErr) {
      console.error('❌ Error al leer favoritos:', favoritosErr);
      process.exit(1);
    }

    if (!favoritos || favoritos.length === 0) {
      console.log('⚠️  No hay favoritos en pjn_favoritos');
      process.exit(0);
    }

    console.log(`✅ Encontrados ${favoritos.length} favoritos\n`);

    // 2. Filtrar favoritos que necesitan actualización
    const favoritosSinMovimientos = favoritos.filter(f => !f.movimientos);
    const favoritosConMovimientos = favoritos.filter(f => f.movimientos);

    console.log(`📊 Estadísticas:`);
    console.log(`   - Favoritos sin movimientos: ${favoritosSinMovimientos.length}`);
    console.log(`   - Favoritos con movimientos: ${favoritosConMovimientos.length}\n`);

    // 3. Buscar movimientos en cases para favoritos sin movimientos
    console.log('🔍 Buscando movimientos en cases...');
    let actualizados = 0;
    let noEncontrados = 0;
    const batchSize = 50;

    // Procesar en lotes
    for (let i = 0; i < favoritosSinMovimientos.length; i += batchSize) {
      const batch = favoritosSinMovimientos.slice(i, i + batchSize);
      
      // Construir keys para buscar en cases
      const keys = batch
        .filter(f => f.jurisdiccion && f.numero && f.anio)
        .map(f => {
          const numeroNormalizado = String(f.numero).padStart(6, '0');
          return `${f.jurisdiccion} ${numeroNormalizado}/${f.anio}`;
        });

      // También crear keys sin ceros a la izquierda para compatibilidad
      const keysSinCeros = batch
        .filter(f => f.jurisdiccion && f.numero && f.anio)
        .map(f => `${f.jurisdiccion} ${f.numero}/${f.anio}`);

      const allKeys = [...keys, ...keysSinCeros];

      if (allKeys.length === 0) {
        continue;
      }

      // Buscar en cases
      const { data: casesData, error: casesErr } = await pjnSupabase
        .from("cases")
        .select("key, movimientos")
        .in("key", allKeys);

      if (casesErr) {
        console.error(`❌ Error al buscar en cases (lote ${Math.floor(i / batchSize) + 1}):`, casesErr);
        continue;
      }

      if (!casesData || casesData.length === 0) {
        noEncontrados += batch.length;
        continue;
      }

      // Crear mapa de movimientos por key
      const movimientosMap = new Map();
      casesData.forEach((c) => {
        if (c.movimientos) {
          movimientosMap.set(c.key, c.movimientos);
        }
      });

      // Actualizar favoritos con movimientos encontrados
      const updates = [];
      for (const favorito of batch) {
        if (!favorito.jurisdiccion || !favorito.numero || !favorito.anio) {
          continue;
        }

        const numeroNormalizado = String(favorito.numero).padStart(6, '0');
        const key = `${favorito.jurisdiccion} ${numeroNormalizado}/${favorito.anio}`;
        const keySinCeros = `${favorito.jurisdiccion} ${favorito.numero}/${favorito.anio}`;

        const movimientos = movimientosMap.get(key) || movimientosMap.get(keySinCeros);

        if (movimientos) {
          updates.push({
            id: favorito.id,
            movimientos: movimientos
          });
        } else {
          noEncontrados++;
        }
      }

      // Actualizar en lotes
      if (updates.length > 0) {
        for (const update of updates) {
          const { error: updateErr } = await mainSupabase
            .from("pjn_favoritos")
            .update({ movimientos: update.movimientos })
            .eq("id", update.id);

          if (updateErr) {
            console.error(`❌ Error al actualizar favorito ${update.id}:`, updateErr);
          } else {
            actualizados++;
          }
        }
      }

      console.log(`   ✅ Lote ${Math.floor(i / batchSize) + 1}: ${updates.length} movimientos encontrados y actualizados`);
    }

    console.log('\n' + '='.repeat(50));
    console.log('📊 Resumen de actualización:');
    console.log(`   ✅ Actualizados: ${actualizados} favoritos`);
    console.log(`   ❌ No encontrados: ${noEncontrados} favoritos`);
    console.log(`   📋 Total procesados: ${favoritosSinMovimientos.length}`);
    console.log('='.repeat(50) + '\n');

  } catch (error) {
    console.error('❌ Error inesperado:', error);
    process.exit(1);
  }
}

// Ejecutar
updateMovimientos()
  .then(() => {
    console.log('✅ Actualización completada.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error fatal:', error);
    process.exit(1);
  });
