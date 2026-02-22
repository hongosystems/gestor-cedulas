/**
 * Script para verificar expedientes específicos mencionados por el usuario
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const pjnSupabaseUrl = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL;
const pjnSupabaseAnonKey = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_ANON_KEY;

if (!pjnSupabaseUrl || !pjnSupabaseAnonKey) {
  console.error('❌ Error: Faltan variables de entorno');
  process.exit(1);
}

const pjnSupabase = createClient(pjnSupabaseUrl, pjnSupabaseAnonKey);

// Expedientes específicos mencionados
const expedientes = [
  { numero: '56650', anio: '2023' },
  { numero: '46656', anio: '2023' },
  { numero: '104244', anio: '2023' },
  { numero: '17167', anio: '2023' }
];

async function checkExpedientes() {
  console.log('🔍 Verificando expedientes específicos...\n');

  for (const exp of expedientes) {
    console.log(`\n📋 Expediente: ${exp.numero}/${exp.anio}`);
    
    // Intentar con diferentes formatos de key
    const formatos = [
      { nombre: 'Con espacios y /', key: `CIV ${String(exp.numero).padStart(6, '0')}/${exp.anio}` },
      { nombre: 'Con |', key: `CIV|${String(exp.numero).padStart(6, '0')}|${exp.anio}` },
      { nombre: 'Sin padding', key: `CIV ${exp.numero}/${exp.anio}` },
      { nombre: 'Con | sin padding', key: `CIV|${exp.numero}|${exp.anio}` }
    ];

    for (const formato of formatos) {
      const { data, error } = await pjnSupabase
        .from("cases")
        .select("key, movimientos")
        .eq("key", formato.key)
        .limit(1);

      if (data && data.length > 0) {
        console.log(`   ✅ ENCONTRADO con formato "${formato.nombre}": ${formato.key}`);
        console.log(`      Tiene movimientos: ${data[0].movimientos ? 'Sí' : 'No'}`);
        if (data[0].movimientos) {
          const movsStr = JSON.stringify(data[0].movimientos);
          const tienePericia = /perici/i.test(movsStr);
          console.log(`      Tiene Prueba/Pericia: ${tienePericia ? 'Sí' : 'No'}`);
        }
        break;
      }
    }
  }
}

checkExpedientes();
