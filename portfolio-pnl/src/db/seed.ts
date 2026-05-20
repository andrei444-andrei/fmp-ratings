import 'dotenv/config';
import { libsqlClient } from './client';
import { DDL_STATEMENTS } from './ddl';

// Демонстрационные данные: 6 кварталов разнородного портфеля.
// Запуск: npm run db:migrate && tsx src/db/seed.ts
const QUARTERS = ['2024Q4', '2025Q1', '2025Q2', '2025Q3', '2025Q4', '2026Q1'];

// [class, name, symbol|null, тренд значений по кварталам в USD]
const POSITIONS: [string, string, string | null, number[]][] = [
  ['public', 'US equities book', 'MIXED', [5_400_000, 5_200_000, 6_100_000, 7_900_000, 8_600_000, 9_000_000]],
  ['real_estate', 'Dubai apartments', null, [8_900_000, 8_900_000, 8_850_000, 8_800_000, 8_750_000, 8_700_000]],
  ['crypto', 'BTC + alts', 'BTC', [3_300_000, 3_100_000, 2_900_000, 2_950_000, 2_900_000, 2_300_000]],
  ['private', 'VC funds + 1 deal', null, [560_000, 700_000, 900_000, 1_100_000, 1_300_000, 1_400_000]],
  ['cash', 'ADIB + ENBD', null, [340_000, 300_000, 250_000, 200_000, 160_000, 139_000]],
];

const COST_BASIS: Record<string, number> = {
  'US equities book': 6_800_000,
  'BTC + alts': 3_650_000,
};

const LIQ: Record<string, string> = { public: 't7', crypto: 't90', real_estate: 'locked', private: 'locked', cash: 't0' };

async function main() {
  for (const sql of DDL_STATEMENTS) await libsqlClient.execute(sql);
  await libsqlClient.execute('DELETE FROM holdings');
  await libsqlClient.execute('DELETE FROM cashflows');
  await libsqlClient.execute('DELETE FROM segment_meta');

  const now = new Date().toISOString();
  for (let qi = 0; qi < QUARTERS.length; qi++) {
    const q = QUARTERS[qi];
    for (const [ac, name, symbol, values] of POSITIONS) {
      await libsqlClient.execute({
        sql: `INSERT INTO holdings (quarter, asset_class, name, symbol, value, cost_basis, liquidity_tier, source, created_at)
              VALUES (?,?,?,?,?,?,?,?,?)`,
        args: [q, ac, name, symbol, values[qi], COST_BASIS[name] ?? null, LIQ[ac], 'manual', now],
      });
    }
    // Денежные потоки последнего квартала.
    if (q === '2026Q1') {
      await libsqlClient.execute({ sql: `INSERT INTO cashflows (quarter,type,amount,note,created_at) VALUES (?,?,?,?,?)`, args: [q, 'contribution', 600_000, 'пополнение брокера', now] });
      await libsqlClient.execute({ sql: `INSERT INTO cashflows (quarter,type,amount,note,created_at) VALUES (?,?,?,?,?)`, args: [q, 'withdrawal', 180_000, 'личные расходы', now] });
      await libsqlClient.execute({ sql: `INSERT INTO cashflows (quarter,type,amount,note,created_at) VALUES (?,?,?,?,?)`, args: [q, 'income', 340_000, 'рента + дивиденды', now] });
    }
  }

  // Устаревшая оценка недвижимости (для алерта) + целевые аллокации.
  const stale = new Date(Date.now() - 87 * 86400000).toISOString();
  await libsqlClient.execute({ sql: `INSERT INTO segment_meta (asset_class,target_pct,last_valued_at,benchmark) VALUES (?,?,?,?)`, args: ['real_estate', 35, stale, null] });
  await libsqlClient.execute({ sql: `INSERT INTO segment_meta (asset_class,target_pct,last_valued_at,benchmark) VALUES (?,?,?,?)`, args: ['public', 40, null, 'SPY'] });

  console.log(`Seeded ${QUARTERS.length} quarters.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
