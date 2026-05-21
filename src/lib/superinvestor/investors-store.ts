// Пользовательские инвесторы (добавленные из UI) в Turso. Встроенный список
// (registry.INVESTORS) + кастомные из БД. Схема создаётся лениво (как ticker_sets).

import { libsqlClient } from '@/db/client';
import { INVESTORS } from './registry';
import type { Investor, InvestorType } from './types';

export const INVESTOR_TYPES: InvestorType[] = ['value', 'activist', 'macro', 'concentrated', 'quant'];

let ensured = false;
async function ensureSchema(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS si_investors (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    fund TEXT NOT NULL DEFAULT '',
    cik TEXT NOT NULL,
    type TEXT NOT NULL,
    blurb TEXT,
    created_at INTEGER NOT NULL
  )`);
  ensured = true;
}

export function normalizeCik(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.padStart(10, '0').slice(-10);
}

function slugify(s: string): string {
  return String(s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '') // снять диакритику
    .toLowerCase().replace(/[^a-z0-9\s-]/g, '')
    .trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40);
}

const BUILTIN_SLUGS = new Set(INVESTORS.map(i => i.slug));

function rowToInvestor(row: any): Investor {
  return {
    slug: String(row.slug), name: String(row.name), fund: String(row.fund || ''),
    cik: String(row.cik), type: String(row.type) as InvestorType,
    blurb: row.blurb ? String(row.blurb) : undefined,
  };
}

// Кастомные инвесторы из БД (best-effort: при недоступной БД — пусто).
export async function getCustomInvestors(): Promise<Investor[]> {
  try {
    await ensureSchema();
    const r = await libsqlClient.execute('SELECT slug, name, fund, cik, type, blurb FROM si_investors ORDER BY created_at');
    return (r.rows || []).map(rowToInvestor);
  } catch {
    return [];
  }
}

// Полный список = встроенные + кастомные (встроенные имеют приоритет по slug).
export async function getAllInvestors(): Promise<Investor[]> {
  const custom = (await getCustomInvestors()).filter(c => !BUILTIN_SLUGS.has(c.slug));
  return [...INVESTORS, ...custom];
}

export async function getInvestorBySlugAsync(slug: string): Promise<Investor | undefined> {
  const builtin = INVESTORS.find(i => i.slug === slug);
  if (builtin) return builtin;
  const custom = await getCustomInvestors();
  return custom.find(i => i.slug === slug);
}

export async function isCustom(slug: string): Promise<boolean> {
  if (BUILTIN_SLUGS.has(slug)) return false;
  const custom = await getCustomInvestors();
  return custom.some(i => i.slug === slug);
}

export async function addInvestor(input: {
  name: string; fund?: string; cik: string; type: string; blurb?: string;
}): Promise<{ investor?: Investor; error?: string }> {
  const name = String(input.name || '').trim();
  if (!name) return { error: 'Имя обязательно' };
  const cik = normalizeCik(input.cik);
  if (!cik) return { error: 'CIK обязателен (только цифры)' };
  const type = String(input.type || '') as InvestorType;
  if (!INVESTOR_TYPES.includes(type)) return { error: `type должен быть: ${INVESTOR_TYPES.join('|')}` };

  await ensureSchema();

  // Уникальный slug (не пересекается со встроенными и кастомными).
  let slug = slugify(name) || `inv-${cik}`;
  const custom = await getCustomInvestors();
  const taken = new Set([...BUILTIN_SLUGS, ...custom.map(c => c.slug)]);
  if (taken.has(slug)) slug = `${slug}-${cik.slice(-4)}`;
  if (taken.has(slug)) return { error: 'Такой инвестор уже добавлен' };

  const investor: Investor = {
    slug, name, fund: String(input.fund || '').trim(), cik, type,
    blurb: input.blurb ? String(input.blurb).trim() : undefined,
  };
  await libsqlClient.execute({
    sql: `INSERT INTO si_investors (slug, name, fund, cik, type, blurb, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [investor.slug, investor.name, investor.fund, investor.cik, investor.type, investor.blurb ?? null, Math.floor(Date.now() / 1000)],
  });
  return { investor };
}

export async function removeInvestor(slug: string): Promise<{ error?: string }> {
  if (BUILTIN_SLUGS.has(slug)) return { error: 'Встроенного инвестора удалить нельзя' };
  await ensureSchema();
  await libsqlClient.execute({ sql: 'DELETE FROM si_investors WHERE slug = ?', args: [slug] });
  return {};
}
