// Endpoint de DIAGNÓSTICO v2 — descubre qué campos contiene la API de Clupik/Leverade
// para los marcadores de un partido cuando NO están en match.attributes directamente.
//
// USO:
//   GET /api/clupik-match-raw?tournament_id=YYY            → primer partido finalizado, raw
//   GET /api/clupik-match-raw?tournament_id=YYY&include=1  → mismo partido + sondea includes
//   GET /api/clupik-match-raw?probe=1&tournament_id=YYY    → prueba endpoints alternativos
//
// SEGURO: solo lee.

const { apiGet, paginate } = require('./_clupik');

function sendJson(res, status, obj) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(obj, null, 2));
}

module.exports = async (req, res) => {
  const matchId = req.query.match_id;
  const tournamentId = req.query.tournament_id;
  const wantInclude = req.query.include === '1' || req.query.include === 'true';
  const wantProbe = req.query.probe === '1' || req.query.probe === 'true';

  try {
    // === MODO PROBE: prueba endpoints alternativos para descubrir dónde viven los marcadores ===
    if (wantProbe) {
      if (!tournamentId) return sendJson(res, 400, { error: 'probe requiere ?tournament_id=YYY' });

      // Conseguir un match finalizado
      const matchesArr = await paginate('/matches', { filter: `round.group.tournament.id:${tournamentId}` });
      const finished = matchesArr.find((m) => {
        const a = m.attributes || {};
        return a.finished === true || a.terminado === true || a.finalizado === true;
      });
      if (!finished) return sendJson(res, 404, { error: 'No hay partidos finalizados en este torneo.' });
      const mid = finished.id;

      // Lista de paths/queries candidatos donde podrían estar los marcadores
      const probes = [
        // Match con includes JSON:API
        { label: 'matches?include=result',           path: '/matches', params: { filter: `id:${mid}`, include: 'result' } },
        { label: 'matches?include=results',          path: '/matches', params: { filter: `id:${mid}`, include: 'results' } },
        { label: 'matches?include=score',            path: '/matches', params: { filter: `id:${mid}`, include: 'score' } },
        { label: 'matches?include=events',           path: '/matches', params: { filter: `id:${mid}`, include: 'events' } },
        { label: 'matches?include=statistics',       path: '/matches', params: { filter: `id:${mid}`, include: 'statistics' } },
        { label: 'matches?include=match_score',      path: '/matches', params: { filter: `id:${mid}`, include: 'match_score' } },
        { label: 'matches?include=team_match',       path: '/matches', params: { filter: `id:${mid}`, include: 'team_match' } },
        { label: 'matches?include=team_matches',     path: '/matches', params: { filter: `id:${mid}`, include: 'team_matches' } },
        { label: 'matches?include=teamMatches',      path: '/matches', params: { filter: `id:${mid}`, include: 'teamMatches' } },
        { label: 'matches?include=match_team',       path: '/matches', params: { filter: `id:${mid}`, include: 'match_team' } },
        { label: 'matches?include=match_teams',      path: '/matches', params: { filter: `id:${mid}`, include: 'match_teams' } },
        // Recursos hermanos
        { label: 'results?filter=match.id',          path: '/results', params: { filter: `match.id:${mid}` } },
        { label: 'scores?filter=match.id',           path: '/scores', params: { filter: `match.id:${mid}` } },
        { label: 'match_scores?filter=match.id',     path: '/match_scores', params: { filter: `match.id:${mid}` } },
        { label: 'match_results?filter=match.id',    path: '/match_results', params: { filter: `match.id:${mid}` } },
        { label: 'team_matches?filter=match.id',     path: '/team_matches', params: { filter: `match.id:${mid}` } },
        { label: 'match_teams?filter=match.id',      path: '/match_teams', params: { filter: `match.id:${mid}` } },
        { label: 'events?filter=match.id',           path: '/events', params: { filter: `match.id:${mid}` } },
        { label: 'statistics?filter=match.id',       path: '/statistics', params: { filter: `match.id:${mid}` } },
      ];

      const findings = [];
      for (const p of probes) {
        try {
          const r = await apiGet(p.path, p.params);
          const body = r.body;
          const hasData = body && (
            (Array.isArray(body.data) && body.data.length > 0) ||
            (body.data && !Array.isArray(body.data))
          );
          const includedLen = body && Array.isArray(body.included) ? body.included.length : 0;

          // Sample shape
          let sampleAttrKeys = null;
          let sampleType = null;
          if (Array.isArray(body?.data) && body.data.length > 0) {
            sampleType = body.data[0].type;
            sampleAttrKeys = Object.keys(body.data[0].attributes || {});
          } else if (body?.data && !Array.isArray(body.data)) {
            sampleType = body.data.type;
            sampleAttrKeys = Object.keys(body.data.attributes || {});
          }
          let includedTypes = null;
          if (Array.isArray(body?.included) && body.included.length) {
            includedTypes = [...new Set(body.included.map((x) => x.type))];
          }

          findings.push({
            label: p.label,
            status: r.status,
            ok: r.status === 200,
            hasData,
            includedLen,
            sampleType,
            sampleAttrKeys,
            includedTypes,
          });
        } catch (e) {
          findings.push({ label: p.label, error: e.message });
        }
      }

      return sendJson(res, 200, {
        debug_note: 'Resultados de cada sondeo. Busca el que tenga ok:true y attribute keys que parezcan goles (home_score, goals_local, etc.) o includedTypes con palabras como result/score/team_match.',
        match_id: mid,
        probes_run: probes.length,
        findings,
      });
    }

    // === MODO INCLUDE: pide el partido con todos los includes posibles a la vez ===
    if (wantInclude) {
      if (!tournamentId) return sendJson(res, 400, { error: 'include requiere ?tournament_id=YYY' });
      const matchesArr = await paginate('/matches', { filter: `round.group.tournament.id:${tournamentId}` });
      const finished = matchesArr.find((m) => {
        const a = m.attributes || {};
        return a.finished === true || a.terminado === true || a.finalizado === true;
      });
      if (!finished) return sendJson(res, 404, { error: 'No hay partidos finalizados.' });
      const mid = finished.id;

      // Listamos primero las relaciones que la API expone
      const relKeys = finished.relationships ? Object.keys(finished.relationships) : [];

      // Pedimos cada relación por separado para ver cuáles son válidas
      const includesToTry = [...new Set([...relKeys, 'result', 'results', 'score', 'events', 'statistics', 'team_matches', 'match_teams'])];
      const results = {};
      for (const inc of includesToTry) {
        try {
          const r = await apiGet('/matches', { filter: `id:${mid}`, include: inc });
          results[inc] = {
            status: r.status,
            ok: r.status === 200,
            includedLen: Array.isArray(r.body?.included) ? r.body.included.length : 0,
            includedTypes: Array.isArray(r.body?.included) && r.body.included.length
              ? [...new Set(r.body.included.map((x) => x.type))]
              : [],
            firstIncludedAttrKeys: Array.isArray(r.body?.included) && r.body.included.length
              ? Object.keys(r.body.included[0].attributes || {})
              : [],
          };
        } catch (e) {
          results[inc] = { error: e.message };
        }
      }

      return sendJson(res, 200, {
        debug_note: 'Para cada include probado, status + tipos de recursos relacionados que devolvió. Busca tipos tipo result/score/team_match con campos goals/score.',
        match_id: mid,
        relationships_in_match: relKeys,
        per_include: results,
      });
    }

    // === MODO BÁSICO ===
    if (matchId) {
      const r = await apiGet(`/matches/${matchId}`);
      return sendJson(res, r.status, {
        debug_note: 'Raw response from /matches/{id}.',
        match_id: matchId,
        response: r.body,
      });
    }

    if (tournamentId) {
      const matchesArr = await paginate('/matches', { filter: `round.group.tournament.id:${tournamentId}` });
      const sorted = [...matchesArr].sort((a, b) => {
        const da = a.attributes?.datetime || a.attributes?.fecha_hora || '';
        const db = b.attributes?.datetime || b.attributes?.fecha_hora || '';
        return db.localeCompare(da);
      });
      const finished = sorted.find((m) => {
        const a = m.attributes || {};
        return a.finished === true || a.terminado === true || a.finalizado === true;
      });
      const sample = finished || sorted[0] || null;
      if (!sample) return sendJson(res, 404, { error: 'No hay partidos en este torneo.' });
      return sendJson(res, 200, {
        debug_note: 'Primer partido finalizado del torneo. Pasa &include=1 para sondear relaciones, o &probe=1 para probar endpoints alternativos.',
        tournament_id: tournamentId,
        total_matches: matchesArr.length,
        finished_count: matchesArr.filter((m) => {
          const a = m.attributes || {};
          return a.finished === true || a.terminado === true || a.finalizado === true;
        }).length,
        attribute_keys: Object.keys(sample.attributes || {}),
        relationship_keys: sample.relationships ? Object.keys(sample.relationships) : [],
        meta_keys: sample.meta ? Object.keys(sample.meta) : [],
        sample_match: sample,
      });
    }

    return sendJson(res, 400, {
      error: 'Falta query param. Usa ?tournament_id=YYY (con &include=1 o &probe=1) o ?match_id=XXX',
    });
  } catch (e) {
    return sendJson(res, 500, { error: e.message || String(e) });
  }
};
