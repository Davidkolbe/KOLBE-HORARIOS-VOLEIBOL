// Auto-fetch de marcadores desde Leverade (api.leverade.com) — solo lectura.
// Recibe ?match_ids=ID1,ID2,ID3 y devuelve, por cada match:
//   { match_id, found, finished, postponed, canceled,
//     home_team_id, away_team_id, home_score, away_score }
//
// Estructura Leverade verificada 19/05/2026:
//   match.meta.home_team / match.meta.away_team  -> ids de equipos
//   match.relationships.results.data[]           -> ids de result
//   result.attributes.value                      -> marcador del equipo (total)
//   result.relationships.team.data.id            -> a que equipo corresponde
//   result.relationships.period.data === null    -> marcador TOTAL (no parcial)

const { apiGet } = require('./_clupik');

function sendJson(res, status, obj) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(obj));
}

module.exports = async (req, res) => {
  const param = req.query.match_ids || req.query.match_id;
  if (!param) return sendJson(res, 400, { error: 'Falta match_ids (o match_id)' });

  const matchIds = String(param)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!matchIds.length) return sendJson(res, 400, { error: 'match_ids vacio' });
  if (matchIds.length > 100) return sendJson(res, 400, { error: 'max 100 match_ids por llamada' });

  try {
    const filterIds = matchIds.join(',');
    const r = await apiGet('/matches', {
      filter: `id:${filterIds}`,
      include: 'results',
      'page[size]': matchIds.length,
    });

    const body = r.body || {};
    const matches = Array.isArray(body.data) ? body.data : [];
    const included = Array.isArray(body.included) ? body.included : [];

    // Indice: results por match_id, SOLO los totales (period == null)
    const resultsByMatch = new Map();
    for (const inc of included) {
      if (inc.type !== 'result') continue;
      const period = inc.relationships && inc.relationships.period && inc.relationships.period.data;
      if (period) continue;
      const mid =
        inc.relationships &&
        inc.relationships.match &&
        inc.relationships.match.data &&
        inc.relationships.match.data.id;
      if (!mid) continue;
      if (!resultsByMatch.has(String(mid))) resultsByMatch.set(String(mid), []);
      resultsByMatch.get(String(mid)).push(inc);
    }

    const out = matchIds.map((mid) => {
      const m = matches.find((x) => String(x.id) === String(mid));
      if (!m) return { match_id: mid, found: false };

      const a = m.attributes || {};
      const meta = m.meta || {};
      const finished = !!(a.finished || a.terminado || a.finalizado);
      const postponed = !!a.postponed;
      const canceled = !!a.canceled;
      const homeId = meta.home_team || meta.equipo_local || null;
      const awayId = meta.away_team || meta.equipo_visitante || null;

      let home_score = null;
      let away_score = null;
      const rs = resultsByMatch.get(String(mid)) || [];
      for (const rr of rs) {
        const teamId =
          rr.relationships &&
          rr.relationships.team &&
          rr.relationships.team.data &&
          rr.relationships.team.data.id;
        const val = rr.attributes && rr.attributes.value;
        if (teamId == null || val == null) continue;
        if (String(teamId) === String(homeId)) home_score = val;
        else if (String(teamId) === String(awayId)) away_score = val;
      }

      return {
        match_id: mid,
        found: true,
        finished,
        postponed,
        canceled,
        home_team_id: homeId,
        away_team_id: awayId,
        home_score,
        away_score,
      };
    });

    return sendJson(res, 200, { results: out });
  } catch (e) {
    return sendJson(res, 500, { error: e.message });
  }
};
