import { NextRequest, NextResponse } from 'next/server';
import { libsqlClient } from '@/db/client';

// Read-only SQL console. POST { sql: 'SELECT ...' }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sql = String(body.sql || '').trim();
    if (!sql) return NextResponse.json({ error: 'sql required' }, { status: 400 });
    // Жёсткая защита: только SELECT (и WITH/EXPLAIN), без точки с запятой посередине.
    const lower = sql.toLowerCase();
    if (!/^(select|with|explain|pragma)\s/i.test(sql)) {
      return NextResponse.json({ error: 'only SELECT/WITH/EXPLAIN/PRAGMA queries allowed' }, { status: 400 });
    }
    if (sql.indexOf(';') !== -1 && sql.indexOf(';') !== sql.length - 1) {
      return NextResponse.json({ error: 'multiple statements forbidden' }, { status: 400 });
    }
    const res = await libsqlClient.execute(sql);
    return NextResponse.json({
      columns: res.columns,
      rows: res.rows.map(r => Object.fromEntries(res.columns.map((c, i) => [c, (r as any)[i]]))),
      rowsAffected: res.rowsAffected,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
