// api/keepalive.js
// Endpoint minimo y PUBLICO (excluido del Basic Auth en middleware.js).
// Hace una lectura ligera a Supabase para registrar actividad y evitar que
// el proyecto gratuito se pause por inactividad (Supabase pausa a los 7 dias).
// Lo invoca el cron de Vercel (ver vercel.json). No expone datos: solo el
// timestamp updated_at.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jwoeoloaaelzarqpxvtc.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_HgcvMp8iThAGvwx1C3_GSg_5SKYcHyU';

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  try {
    const url = SUPABASE_URL + '/rest/v1/app_state?id=eq.main&select=updated_at';
    const r = await fetch(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY },
    });
    const txt = await r.text().catch(() => '');
    return res.status(r.ok ? 200 : 502).send(JSON.stringify({
      ok: r.ok,
      supabase_status: r.status,
      checked_at: new Date().toISOString(),
      sample: txt.slice(0, 120),
    }));
  } catch (e) {
    return res.status(500).send(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
  }
};
