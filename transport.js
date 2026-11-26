// Transport autonome GitHub Pages : observations publiques réelles, aucun compte fictif.
const periods = { all: null, daily: 1, weekly: 7, monthly: 30, yearly: 365 };
let snapshotPromise, catalogPromise;
const text = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr').replaceAll('œ', 'oe');
const day = value => new Date(value).toISOString().slice(0, 10);
async function resource(name) {
  const response = await fetch(new URL(name, import.meta.url), { cache: 'no-store' });
  if (!response.ok) throw new Error('Publication incomplète. Réessayez après le déploiement.');
  return response.json();
}
async function snapshot() {
  snapshotPromise ||= resource('./wikimedia.json');
  try { return await snapshotPromise; } catch (error) { snapshotPromise = null; throw error; }
}
async function catalog() {
  catalogPromise ||= resource('./catalog.json');
  try { return await catalogPromise; } catch (error) { catalogPromise = null; throw error; }
}
function comparison(collection, period) {
  const count = periods[period];
  if (!count) return null;
  const end = Date.parse(collection.reference_day + 'T00:00:00Z');
  const start = end - (count - 1) * 86400000, previousStart = start - count * 86400000;
  const points = new Map(collection.records.map(record => [record.published_at, record.value]));
  function total(first) {
    const values = Array.from({ length: count }, (_, index) => points.get(day(first + index * 86400000)));
    const valid = values.filter(value => Number.isInteger(value) && value >= 0);
    return [valid.length === count ? valid.reduce((sum, value) => sum + value, 0) : null, valid.length];
  }
  const [current, currentDays] = total(start), [previous, previousDays] = total(previousStart);
  return { current, previous, change_pct: current != null && previous > 0 ? Math.round((current - previous) / previous * 1000) / 10 : null,
    days: count, current_start: day(start), current_end: day(end), previous_start: day(previousStart), previous_end: day(start - 86400000),
    current_days: currentDays, previous_days: previousDays, unit: 'consultations de l’article', reference_day: collection.reference_day };
}
export function calculateRadar(data, period = 'weekly', query = '', category = '') {
  if (!Object.hasOwn(periods, period)) throw new Error('Période invalide.');
  const collections = data.source === 'wikimedia' && data.simulated === false ? data.collections.filter(item => item.simulated === false && item.source === 'wikimedia' && item.provenance === 'public_api' && item.records.length) : [];
  const items = collections.map(collection => {
    const measured = comparison(collection, period);
    return { id: collection.id, title: collection.query, category: collection.category, decision: collection.decision || '', source: 'wikimedia',
      provenance: 'public_api', keywords: collection.keywords || [], summary: collection.selection_method,
      record_count: collection.records.length, source_count: 1, evidence: [{ id: 'wikimedia', name: 'Wikimedia' }],
      saved_at: collection.saved_at, collected_at: collection.collected_at, imported_at: null, partial: collection.partial,
      comparison: measured, change_pct: measured?.change_pct ?? null, public: true, simulated: false,
      reference_day: collection.reference_day, source_url: collection.source_url };
  });
  const trends = items.filter(item => (!category || item.category === category) && text([item.title, item.category, item.decision, ...item.keywords].join(' ')).includes(text(query)));
  trends.sort((a, b) => (b.change_pct ?? -Infinity) - (a.change_pct ?? -Infinity));
  return { metadata: { mode: 'real_only', simulated: false, as_of: new Date().toISOString(), authenticated: false,
    period_basis: 'observation_window', reference_day: trends[0]?.reference_day || null,
    label: 'Variations observées sur des sujets choisis manuellement ; aucune émergence établie.' },
    period, trends, total_in_snapshot: items.length, filtered_count: trends.length,
    record_count: trends.reduce((sum, item) => sum + item.record_count, 0),
    sources: trends.length ? [{ id: 'wikimedia', name: 'Wikimedia' }] : [], categories: [...new Set(items.map(item => item.category))].sort() };
}
export async function request(path, options = {}) {
  try {
    const route = new URL(path, 'https://static.invalid');
    if (route.pathname === '/api/config') return Response.json({ mode: 'real_only', storage: { provider: 'unavailable', hosting: 'github_pages', remote_verified: false } });
    if (route.pathname === '/api/account') return Response.json({ error: 'Les comptes et la sauvegarde Supabase ne sont pas encore activés sur cette publication.' }, { status: 401 });
    if (route.pathname === '/api/snapshot/refresh') {
      snapshotPromise = null; await snapshot();
      return Response.json({ published_snapshot_reloaded: true });
    }
    if (options.method === 'POST') return Response.json({ error: 'Cette opération nécessite un backend et une base Supabase actifs. Aucune donnée n’a été enregistrée.' }, { status: 503 });
    const data = await snapshot();
    if (route.pathname === '/api/trends') return Response.json(calculateRadar(data, route.searchParams.get('period') || 'weekly', route.searchParams.get('query') || '', route.searchParams.get('category') || ''));
    if (route.pathname === '/api/sources/collection') {
      const collection = data.collections.find(item => item.id === route.searchParams.get('id') && item.simulated === false);
      return collection ? Response.json(collection) : Response.json({ error: 'Collecte publique introuvable.' }, { status: 404 });
    }
    if (route.pathname === '/api/sources') {
      const items = await catalog(), first = data.collections[0];
      return Response.json({ items, collections: [], static_hosting: true, public_snapshot: { available: Boolean(first), topics: data.collections.length, reference_day: first?.reference_day || null, collected_at: first?.collected_at || null, documentation: first?.documentation } });
    }
    return Response.json({ error: 'Ressource introuvable.' }, { status: 404 });
  } catch {
    return Response.json({ error: 'L’instantané publié est indisponible. Réessayez pour charger des observations vérifiables.' }, { status: 503 });
  }
}
