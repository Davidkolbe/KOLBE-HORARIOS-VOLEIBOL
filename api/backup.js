// api/backup.js
// Devuelve el estado actual de la app de voleibol leyendo Supabase.
// Se usa desde tareas programadas (sandbox bloquea Supabase directo, Vercel no).

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jwoeoloaaelzarqpxvtc.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_HgcvMp8iThAGvwx1C3_GSg_5SKYcHyU';
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || 'app_state';
const SUPABASE_ROW_ID = process.env.SUPABASE_ROW_ID || 'main';

function sendJson(res, status, obj) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(obj));
}

module.exports = async (req, res) => {
  try {
    const url = SUPABASE_URL
      + '/rest/v1/' + SUPABASE_TABLE
      + '?id=eq.' + SUPABASE_ROW_ID
      + '&select=data,updated_at,updated_by';

    const r = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
      },
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return sendJson(res, 502, {
        ok: false,
        error: 'Supabase GET ' + r.status,
        detail: txt.slice(0, 500),
      });
    }

    const arr = await r.json();
    if (!Array.isArray(arr) || arr.length === 0) {
      return sendJson(res, 404, {
        ok: false,
        error: 'Supabase devolvio array vacio - no hay fila id=main',
      });
    }

    const row = arr[0];
    if (!row || typeof row.data !== 'object' || row.data === null) {
      return sendJson(res, 500, {
        ok: false,
        error: 'Fila sin objeto data valido',
      });
    }

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = now.getUTCFullYear()
      + '-' + pad(now.getUTCMonth() + 1)
      + '-' + pad(now.getUTCDate())
      + ' ' + pad(now.getUTCHours())
      + ':' + pad(now.getUTCMinutes())
      + ':' + pad(now.getUTCSeconds())
      + ' UTC';

    return sendJson(res, 200, {
      version: 1,
      source: 'supabase-app-state-voleibol',
      backup_date: stamp,
      supabase_updated_at: row.updated_at || null,
      supabase_updated_by: row.updated_by || null,
      data: row.data,
    });
  } catch (err) {
    return sendJson(res, 500, {
      ok: false,
      error: String(err && err.message || err),
    });
  }
};
