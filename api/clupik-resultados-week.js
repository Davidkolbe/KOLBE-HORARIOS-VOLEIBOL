// GET /api/clupik-resultados-week?from=DD/MM/YYYY&to=DD/MM/YYYY
//
// Devuelve los partidos del rango con sus marcadores ya extraídos
// (home_score, away_score, finished). Hermano de clupik-matches-week.js
// pero usando ?include=results para traer el recurso `result` que contiene
// los goles. Cada partido en Leverade tiene 0 o 2 results (uno por equipo).

const { apiGet, paginate, utcToMadrid } = require('./_clupik');

function sendJson(res, status, obj) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(obj));
}

function pick(attrs, enKey, esKey) {
  if (!attrs) return null;
  if (attrs[enKey] !== undefined && attrs[enKey] !== null) return attrs[enKey];
  if (attrs[esKey] !== undefined && attrs[esKey] !== null) return attrs[esKey];
  return null;
}

// Detecta disciplina por nombre del torneo
function detectDiscipline(name) {
  const n = (name || '').toUpperCase();
  if (n.includes('VOLEIBOL') || n.includes('VOLLEY')) return 'voleibol';
  if (n.includes('F-7') || n.includes('F7') || n.includes('FÚTBOL 7') || n.includes('FUTBOL 7')
      || n.includes('F-SIETE') || n.includes('FUTBOL-7')) return 'f7';
  if (n.includes('F-SALA') || n.includes('FS ') || n.startsWith('FS')
      || n.includes('SALA') || n.includes('FUTBOL SALA') || n.includes('FÚTBOL SALA')) return 'fs';
  return null;
}

const ACTIVE_STATUSES = new Set([
  'setting_up', 'running', 'public', 'active', 'in_progress',
  'configurando', 'en_progreso',
]);

function parseDDMMYYYY(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s || '');
  if (!m) return null;
  return { year: parseInt(m[3]), month: parseInt(m[2]), day: parseInt(m[1]) };
}

function dateInRange(fechaMadrid, from, to) {
  if (!fechaMadrid) return false;
  const d = parseDDMMYYYY(fechaMadrid);
  if (!d) return false;
  const fromD = parseDDMMYYYY(from);
  const toD = parseDDMMYYYY(to);
  const keyD = d.year * 10000 + d.month * 100 + d.day;
  const keyFrom = fromD ? fromD.year * 10000 + fromD.month * 100 + fromD.day : 0;
  const keyTo = toD ? toD.year * 10000 + toD.month * 100 + toD.day : 99999999;
  return keyD >= keyFrom && keyD <= keyTo;
}

// Variante de paginate que también acumula `included` (necesario para include=...)
async function paginateWithIncluded(path, baseParams, maxPages = 50) {
  const data = [];
  const included = [];
  for (let page = 1; page <= maxPages; page++) {
    const { status, body } = await apiGet(path, {
      ...baseParams,
      'page[size]': 100,
      'page[number]': page,
    });
    if (status !== 200) {
      throw new Error(`${path} HTTP ${status}: ${JSON.stringify(body).slice(0, 240)}`);
    }
    const items = (body && body.data) || [];
    data.push(...items);
    if (Array.isArray(body?.included)) included.push(...body.included);
    if (items.length < 100) break;
  }
  return { data, included };
}

// Devuelve { home, away } con los goles extraídos de los `result` incluidos.
function extractScore(match, includedResults) {
  const homeId = match.meta?.home_team || match.meta?.equipo_local;
  const awayId = match.meta?.away_team || match.meta?.equipo_visitante;
  // IDs de los results asociados a este match
  const resRels = match.relationships?.results?.data || [];
  const resIds = resRels.map((r) => r.id);
  if (!resIds.length) return { home: null, away: null };

  let homeScore = null, awayScore = null;
  for (const r of includedResults) {
    if (r.type !== 'result') continue;
    if (!resIds.includes(r.id)) continue;
    const teamId = r.relationships?.team?.data?.id || null;
    // value parece ser el entero de goles; score puede ser string. Probamos value primero.
    const v = r.attributes?.value;
    const s = r.attributes?.score;
    const goals = (typeof v === 'number') ? v
                : (v != null && !isNaN(Number(v))) ? Number(v)
                : (typeof s === 'number') ? s
                : (s != null && !isNaN(Number(s))) ? Number(s)
                : null;
    if (teamId && goals != null) {
      if (String(teamId) === String(homeId)) homeScore = goals;
      else if (String(teamId) === String(awayId)) awayScore = goals;
    }
  }
  return { home: homeScore, away: awayScore };
}

async function processTournament(t, from, to) {
  const tid = t.id;
  const tname = pick(t.attributes, 'name', 'nombre') || '';

  // Lanzar en paralelo: equipos, grupos, rondas, partidos+results
  const settled = await Promise.allSettled([
    paginate('/teams', { filter: `registrable_id:${tid}` }),
    paginate('/groups', { filter: `tournament.id:${tid}` }),
    paginate('/rounds', { filter: `group.tournament.id:${tid}` }),
    paginateWithIncluded('/matches', { filter: `round.group.tournament.id:${tid}`, include: 'results' }),
  ]);
  const teamsArr   = settled[0].status === 'fulfilled' ? settled[0].value : [];
  const groupsArr  = settled[1].status === 'fulfilled' ? settled[1].value : [];
  const roundsArr  = settled[2].status === 'fulfilled' ? settled[2].value : [];
  const matchesObj = settled[3].status === 'fulfilled' ? settled[3].value : { data: [], included: [] };

  const teamById = new Map();
  for (const team of teamsArr) {
    teamById.set(team.id, pick(team.attributes, 'name', 'nombre') || `#${team.id}`);
  }
  const groupById = new Map();
  for (const g of groupsArr) {
    groupById.set(g.id, pick(g.attributes, 'name', 'nombre') || g.id);
  }
  const roundById = new Map();
  for (const r of roundsArr) {
    const number = pick(r.attributes, 'number', 'numero');
    const name = pick(r.attributes, 'name', 'nombre');
    const roundName = name || (number != null ? `Jornada ${number}` : r.id);
    const groupId = r.relationships?.group?.data?.id || null;
    roundById.set(r.id, { name: roundName, groupId });
  }

  const out = [];
  for (const m of matchesObj.data) {
    if (pick(m.attributes, 'rest', 'descanso')) continue;
    const dt = pick(m.attributes, 'datetime', 'fecha_hora') || '';
    const { fecha, hora } = utcToMadrid(dt);
    if (!dateInRange(fecha, from, to)) continue;

    const homeId = m.meta?.home_team || m.meta?.equipo_local;
    const awayId = m.meta?.away_team || m.meta?.equipo_visitante;
    const eq1 = homeId ? teamById.get(homeId) || `#${homeId}` : '';
    const eq2 = awayId ? teamById.get(awayId) || `#${awayId}` : '';
    if (!eq1 || !eq2) continue;

    const finished = !!(pick(m.attributes, 'finished', 'terminado') || pick(m.attributes, 'finished', 'finalizado'));
    const { home, away } = finished ? extractScore(m, matchesObj.included) : { home: null, away: null };

    const roundId = m.relationships?.round?.data?.id;
    const round = roundId ? roundById.get(roundId) : null;
    const groupId = round?.groupId || null;

    out.push({
      match_id: m.id,
      eq1, eq2, fecha, hora,
      tournament_id: tid,
      home_team_id: homeId || null,
      away_team_id: awayId || null,
      jornada: round?.name || '',
      comp: tname,
      grupo: groupId ? groupById.get(groupId) || '' : '',
      finished,
      canceled: !!(pick(m.attributes, 'canceled', 'cancelado')),
      postponed: !!(pick(m.attributes, 'postponed', 'aplazado')),
      home_score: home,
      away_score: away,
      // Marcador legible "X-Y" si hay goles, null si todavía no
      score_text: (home != null && away != null) ? `${home}-${away}` : null,
    });
  }
  return { tid, tname, partidos: out, count: out.length };
}

module.exports = async (req, res) => {
  const from = req.query.from;
  const to = req.query.to;
  if (!from || !to) {
    return sendJson(res, 400, { error: 'Faltan query params from/to (formato DD/MM/YYYY)' });
  }
  const discRaw = (req.query.disciplines || '').trim().toLowerCase();
  const discFilter = discRaw ? new Set(discRaw.split(',').map((s) => s.trim()).filter(Boolean)) : null;

  const managerId = process.env.CLUPIK_MANAGER_ID || '229546';

  try {
    const tournaments = await paginate('/tournaments', { filter: `manager.id:${managerId}` });
    let active = tournaments.filter((t) => {
      const status = (pick(t.attributes, 'status', 'estado') || '').toLowerCase();
      return ACTIVE_STATUSES.has(status);
    });
    // Filtrar por disciplina si viene especificado
    if (discFilter) {
      active = active.filter((t) => {
        const d = detectDiscipline(pick(t.attributes, 'name', 'nombre') || '');
        if (!d) return true;  // disciplina desconocida: dejar pasar
        return discFilter.has(d);
      });
    }

    const results = await Promise.allSettled(active.map((t) => processTournament(t, from, to)));

    const allPartidos = [];
    const errors = [];
    for (const s of results) {
      if (s.status === 'fulfilled') {
        if (s.value.count > 0) allPartidos.push(...s.value.partidos);
      } else {
        errors.push(s.reason?.message || String(s.reason));
      }
    }

    allPartidos.sort((a, b) => {
      const ka = (a.fecha || '') + a.hora + a.eq1;
      const kb = (b.fecha || '') + b.hora + b.eq1;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });

    const con_marcador = allPartidos.filter((p) => p.score_text).length;

    return sendJson(res, 200, {
      from, to,
      tournaments_checked: active.length,
      count: allPartidos.length,
      finished_count: allPartidos.filter((p) => p.finished).length,
      con_marcador,
      errors: errors.length ? errors : undefined,
      partidos: allPartidos,
    });
  } catch (e) {
    return sendJson(res, 500, { error: e.message });
  }
};
