// GET /api/clupik-matches-week?from=DD/MM/YYYY&to=DD/MM/YYYY&disciplines=f7,fs,voleibol
// Devuelve todos los partidos de los torneos activos del manager que
// caen en el rango de fechas.  Si se pasa `disciplines`, solo considera
// torneos cuya disciplina detectada coincida.  Paralelizado.

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

const ACTIVE_STATUSES = new Set([
  'setting_up', 'running', 'public', 'active', 'in_progress',
  'configurando', 'en_progreso',
]);

// Detecta disciplina por nombre. Devuelve 'f7' | 'fs' | 'voleibol' | null.
function detectDiscipline(name) {
  const n = (name || '').toUpperCase();
  if (n.includes('VOLEIBOL') || n.includes('VOLLEY')) return 'voleibol';
  // Orden importa: F7 antes que FS porque nombres tipo "F-7 FS" raros
  if (n.includes('F-7') || n.includes('F7') || n.includes('FÚTBOL 7') || n.includes('FUTBOL 7')
      || n.includes('F-SIETE') || n.includes('FUTBOL-7')) return 'f7';
  if (n.includes('F-SALA') || n.includes('FS ') || n.startsWith('FS')
      || n.includes('SALA') || n.includes('FUTBOL SALA') || n.includes('FÚTBOL SALA')) return 'fs';
  return null;
}

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

async function processTournament(t, from, to) {
  const tid = t.id;
  const tname = pick(t.attributes, 'name', 'nombre') || '';

  // Lanzar en paralelo las 4 consultas de este torneo
  let teamsArr = [], groupsArr = [], roundsArr = [], matchesArr = [];
  const settled = await Promise.allSettled([
    paginate('/teams', { filter: `registrable_id:${tid}` }),
    paginate('/groups', { filter: `tournament.id:${tid}` }),
    paginate('/rounds', { filter: `group.tournament.id:${tid}` }),
    paginate('/matches', { filter: `round.group.tournament.id:${tid}` }),
  ]);
  if (settled[0].status === 'fulfilled') teamsArr = settled[0].value;
  if (settled[1].status === 'fulfilled') groupsArr = settled[1].value;
  if (settled[2].status === 'fulfilled') roundsArr = settled[2].value;
  if (settled[3].status === 'fulfilled') matchesArr = settled[3].value;

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

  // Filtrar partidos del rango
  const candidatos = [];
  const facIds = new Set();
  for (const m of matchesArr) {
    if (pick(m.attributes, 'rest', 'descanso')) continue;
    const dt = pick(m.attributes, 'datetime', 'fecha_hora') || '';
    const { fecha, hora } = utcToMadrid(dt);
    if (!dateInRange(fecha, from, to)) continue;
    candidatos.push({ m, dt, fecha, hora });
    const fid = m.relationships?.facility?.data?.id;
    if (fid) facIds.add(fid);
  }
  if (!candidatos.length) return { tid, tname, partidos: [], count: 0 };

  // Resolver facilities en paralelo
  const facResults = await Promise.allSettled(
    Array.from(facIds).map((fid) => apiGet(`/facilities/${fid}`).then((r) => ({ fid, r })))
  );
  const facById = new Map();
  for (const s of facResults) {
    if (s.status === 'fulfilled' && s.value.r.status === 200) {
      facById.set(s.value.fid, pick(s.value.r.body?.data?.attributes, 'name', 'nombre') || '');
    }
  }

  const out = [];
  for (const { m, dt, fecha, hora } of candidatos) {
    const homeId = m.meta?.home_team || m.meta?.equipo_local;
    const awayId = m.meta?.away_team || m.meta?.equipo_visitante;
    const roundId = m.relationships?.round?.data?.id;
    const round = roundId ? roundById.get(roundId) : null;
    const groupId = round?.groupId || null;
    const facilityId = m.relationships?.facility?.data?.id || null;
    const eq1 = homeId ? teamById.get(homeId) || `#${homeId}` : '';
    const eq2 = awayId ? teamById.get(awayId) || `#${awayId}` : '';
    if (!eq1 || !eq2) continue;

    out.push({
      match_id: m.id,
      eq1, eq2, fecha, hora,
      datetime_utc_original: dt || null,
      lugar: facilityId ? facById.get(facilityId) || '' : '',
      facility_id: facilityId || null,
      tournament_id: tid,
      home_team_id: homeId || null,
      away_team_id: awayId || null,
      jornada: round?.name || '',
      comp: tname,
      grupo: groupId ? groupById.get(groupId) || '' : '',
      finished: !!(pick(m.attributes, 'finished', 'terminado') || pick(m.attributes, 'finished', 'finalizado')),
      canceled: !!(pick(m.attributes, 'canceled', 'cancelado')),
      postponed: !!(pick(m.attributes, 'postponed', 'aplazado')),
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
  // Lista opcional de disciplinas deseadas: "f7,fs,voleibol"
  const discRaw = (req.query.disciplines || '').trim().toLowerCase();
  const discFilter = discRaw ? new Set(discRaw.split(',').map((s) => s.trim()).filter(Boolean)) : null;

  const managerId = process.env.CLUPIK_MANAGER_ID || '229546';

  try {
    const tournaments = await paginate('/tournaments', { filter: `manager.id:${managerId}` });
    let active = tournaments.filter((t) => {
      const status = (pick(t.attributes, 'status', 'estado') || '').toLowerCase();
      return ACTIVE_STATUSES.has(status);
    });

    // Filtrar por disciplina si viene especificado.
    // En la app voleibol queremos ESTRICTO: si el nombre no contiene "voleibol"/"volley",
    // descartar. Ej.: "COPA CADETE/JUVENIL" en Clupik manager de CDK siempre es fútbol,
    // no debe colarse en una app voleibol.
    // En apps fútbol (f7/fs) se mantiene la lógica permisiva (dejar pasar nombres
    // poco descriptivos) porque es preferible ver de más que perder partidos.
    if (discFilter) {
      const strictVoleibol = discFilter.has('voleibol') && !discFilter.has('f7') && !discFilter.has('fs');
      active = active.filter((t) => {
        const d = detectDiscipline(pick(t.attributes, 'name', 'nombre') || '');
        if (!d) {
          // disciplina desconocida → estricto si es solo voleibol; permisivo en fútbol
          return !strictVoleibol;
        }
        return discFilter.has(d);
      });
    }

    // Procesar todos los torneos en paralelo
    const results = await Promise.allSettled(
      active.map((t) => processTournament(t, from, to))
    );

    const allPartidos = [];
    const tournamentsWithMatches = [];
    const errors = [];
    for (const s of results) {
      if (s.status === 'fulfilled') {
        if (s.value.count > 0) {
          tournamentsWithMatches.push({ id: s.value.tid, name: s.value.tname, matches: s.value.count });
          allPartidos.push(...s.value.partidos);
        }
      } else {
        errors.push(s.reason?.message || String(s.reason));
      }
    }

    allPartidos.sort((a, b) => {
      const ka = (a.datetime_utc_original || '') + a.eq1;
      const kb = (b.datetime_utc_original || '') + b.eq1;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });

    return sendJson(res, 200, {
      from, to,
      disciplines: discFilter ? Array.from(discFilter) : 'all',
      tournaments_checked: active.length,
      tournaments_with_matches: tournamentsWithMatches,
      count: allPartidos.length,
      errors: errors.length ? errors : undefined,
      partidos: allPartidos,
    });
  } catch (e) {
    return sendJson(res, 500, { error: e.message });
  }
};
