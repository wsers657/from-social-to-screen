// Accueil, recherche, comparaison sourcée et veille. Aucun résultat fictif.
import { api, session, initializeAccount, openAuth, saveTrend, notify } from './account.js';
import { initializeSources } from './sources.js';
const $ = (id) => document.getElementById(id);
const state = { data: null, selected: null, request: null, filtered: [], loading: false, owner: null, proofVersion: 0, cache: new Map() };
const number = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const fmt = value => value == null ? 'Non disponible' : number.format(value);
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const searchText = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr').replaceAll('œ', 'oe');
const dateLabel = value => !value ? 'Non renseignée' : value.length <= 10 ? value : new Date(value).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
const periodLabel = () => $('period').selectedOptions[0].textContent.trim();
const sourceName = source => ({ wikimedia: 'Wikimedia', oriane: 'Oriane', google_trends: 'Google Trends' })[source] || source;
const provenance = item => ({ public_api: 'API publique Wikimedia', provider_api: 'Réponse API Oriane', user_official_export: 'Export Google Trends déclaré officiel' })[item.provenance] || 'Origine à vérifier';
const variation = value => value == null ? 'Non calculable' : `${value > 0 ? '+' : ''}${fmt(value)} %`;
const decisions = {
  develop: { label: 'Développer un contenu', question: 'Ce changement d’intérêt mérite-t-il un test de format ?', evidence: 'Recouper les pratiques, préciser le public et vérifier la persistance du signal.' },
  acquire: { label: 'Étudier une acquisition', question: 'Quels contenus existants répondent à cette pratique ?', evidence: 'Identifier des œuvres, vérifier leurs droits disponibles et évaluer leur adéquation au catalogue. Ces informations ne sont pas déduites des consultations.' },
  talent: { label: 'Étudier un talent à approcher', question: 'Quels créateurs illustrent cette pratique de façon durable ?', evidence: 'Réunir leurs publications, examiner leur parcours et leur public. Aucun talent n’est identifié par l’instantané Wikimedia.' },
};
const decision = () => decisions[$('decision-focus').value];

function trendCard(trend, savedView = false) {
  const saved = session.saved[trend.id], comparison = trend.comparison;
  return `<article class="trend-card ${trend.change_pct < 0 ? 'amber' : 'mint'}">
    <div class="card-top"><span class="category-pill">${esc(trend.category)}</span><button class="icon-button bookmark-button ${saved ? 'is-saved' : ''}" data-save="${esc(trend.id)}" aria-label="${saved ? 'Retirer de' : 'Ajouter à'} ma veille : ${esc(trend.title)}" aria-pressed="${Boolean(saved)}">${icon('bookmark')}</button></div>
    <button class="card-title" data-detail="${esc(trend.id)}"><h3>${esc(trend.title)}</h3></button><p class="card-summary">${trend.public ? 'Sujet sélectionné manuellement' : 'Collecte privée'} · ${esc(provenance(trend))}</p>
    <div class="card-metrics"><div><span>${comparison ? 'Consultations · fenêtre actuelle' : 'Lignes conservées'}</span><strong>${fmt(comparison ? comparison.current : trend.record_count)}</strong></div><div><span>Variation observée</span><strong class="variation ${trend.change_pct < 0 ? 'is-negative' : ''}">${variation(trend.change_pct)}</strong></div></div>
    <p class="card-period">${comparison ? `${esc(comparison.current_start)} au ${esc(comparison.current_end)} · ${comparison.current_days}/${comparison.days} jours renseignés` : 'Historique comparable non fourni. Aucun taux calculé.'}</p>
    ${savedView && saved?.note ? `<p class="saved-note"><strong>Votre analyse</strong>${esc(saved.note)}</p>` : ''}
    <div class="card-bottom"><small>${trend.evidence.map(item => esc(item.name)).join(' · ')} · ${trend.public ? 'émergence non établie' : 'à recouper'}</small><button class="text-button" data-detail="${esc(trend.id)}">Examiner les preuves</button></div></article>`;
}

function renderRadar() {
  if (!state.data || state.loading) return;
  const query = searchText($('query').value.trim()), category = $('category').value, source = $('source-filter').value;
  state.filtered = state.data.trends.filter(trend => (!category || trend.category === category) && (!source || trend.source === source)
    && searchText([trend.title, trend.summary, trend.category, trend.decision, ...trend.keywords].join(' ')).includes(query));
  const sort = $('sort').value;
  state.filtered.sort((a, b) => sort === 'saved_at' ? new Date(b.saved_at)-new Date(a.saved_at) : (b[sort] ?? -Infinity)-(a[sort] ?? -Infinity));
  $('results-caption').textContent = `${state.filtered.length} résultat(s) sur ${state.data.total_in_snapshot} · horizon : ${periodLabel().toLowerCase()} · tri descriptif, sans score d’émergence.`;
  $('results').innerHTML = state.filtered.length ? state.filtered.map(trend => trendCard(trend)).join('') : `<div class="empty-state">${icon('search')}<h3>Aucun résultat pour cette recherche.</h3><p>${state.data.total_in_snapshot ? 'Essayez un autre mot-clé ou une catégorie plus large.' : 'Aucune observation exploitable n’est chargée. Ajoutez une source réelle ou actualisez l’instantané.'}</p><button class="button button-outline" data-reset>Effacer les filtres</button><a class="text-button" href="#sources">Préparer une source</a></div>`;
  $('results').setAttribute('aria-busy', 'false'); $('export-radar').disabled = !state.filtered.length;
  renderSaved();
}

function renderSaved() {
  $('saved-period').textContent = session.user ? `Vos sujets et notes privés · mesures à l’horizon ${periodLabel().toLowerCase()}.` : '';
  const trends = state.data?.trends.filter(trend => session.saved[trend.id]) || [];
  $('export-saved').disabled = !trends.length || state.loading;
  if (session.storage === 'unavailable') { $('saved-content').innerHTML = '<div class="empty-state"><h2>Votre veille en ligne reste à activer.</h2><p>Le radar et ses sources sont consultables. Les favoris et notes nécessitent la connexion du site à Supabase ; aucune sauvegarde n’est simulée.</p><a class="button button-outline" href="#rechercher">Explorer les données publiques</a></div>'; return; }
  if (!session.user) $('saved-content').innerHTML = '<div class="empty-state"><h2>Votre veille personnelle.</h2><p>Connectez-vous pour conserver vos sujets et analyses.</p><button class="button button-primary" data-auth>Se connecter</button></div>';
  else if (!state.data || state.loading) $('saved-content').innerHTML = `<div class="empty-state"><p>${state.loading ? 'Chargement de votre veille…' : 'Les observations sont indisponibles. Réessayez depuis le radar.'}</p></div>`;
  else $('saved-content').innerHTML = trends.length ? trends.map(trend => trendCard(trend, true)).join('') : '<div class="empty-state"><h2>Aucun sujet enregistré.</h2><p>Ouvrez une fiche du radar, examinez ses preuves, puis enregistrez votre analyse.</p><a class="button button-primary" href="#rechercher">Explorer le radar</a></div>';
}

function renderOverview() {
  const data = state.data;
  $('total-stat').textContent = data.total_in_snapshot;
  $('records-stat').textContent = data.trends.filter(item => item.change_pct != null).length;
  $('sources-stat').textContent = data.sources.length;
  const publicItems = data.trends.filter(item => item.public);
  const fetched = publicItems.map(item => item.collected_at).filter(Boolean).sort().at(-1);
  $('snapshot-date').textContent = fetched ? dateLabel(fetched) : 'Aucune collecte publique';
  $('snapshot-freshness').textContent = data.metadata.reference_day ? `Mesures jusqu’au ${data.metadata.reference_day}.` : 'Date de référence non disponible.';
  const example = data.trends.find(item => item.comparison)?.comparison;
  $('window-caption').textContent = example ? `${example.current_start}–${example.current_end} comparé au ${example.previous_start}–${example.previous_end} · ${example.days} jour(s) par fenêtre.` : 'Aucun historique comparable disponible pour cet horizon.';
  document.querySelectorAll('[data-period]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.period === data.period)));
  $('featured-open').disabled = !data.trends.length;
}

async function getCollection(id) {
  if (state.cache.has(id)) return state.cache.get(id);
  const owner = session.user?.id || null;
  const collection = await api(`/api/sources/collection?id=${encodeURIComponent(id)}`);
  if (owner === (session.user?.id || null)) state.cache.set(id, collection);
  return collection;
}

function comparisonMarkup(trend) {
  const c = trend.comparison;
  if (!c) return '<p class="scope-note">Historique comparable non fourni : aucune évolution chiffrée déduite de cette collecte.</p>';
  return `<div class="proof-stats"><div><span>Fenêtre précédente</span><strong>${fmt(c.previous)}</strong><span>${esc(c.previous_start)} au ${esc(c.previous_end)}</span></div><div><span>Fenêtre actuelle</span><strong>${fmt(c.current)}</strong><span>${esc(c.current_start)} au ${esc(c.current_end)}</span></div><div><span>Variation</span><strong class="variation ${c.change_pct < 0 ? 'is-negative' : ''}">${variation(c.change_pct)}</strong><span>${c.previous_days}/${c.days} et ${c.current_days}/${c.days} jours renseignés</span></div></div><p class="muted small">Unité : ${esc(c.unit)}. Les fenêtres restent comparables seulement pour ce même article et ce même périmètre.</p>`;
}

function seriesMarkup(collection) {
  if (collection.source !== 'wikimedia') return '';
  const end = Date.parse(collection.reference_day + 'T00:00:00Z'), start = end - 29*86400000;
  const points = collection.records.filter(record => Date.parse(record.published_at+'T00:00:00Z') >= start && record.value != null);
  if (!points.length) return '<p>La série quotidienne n’est pas disponible.</p>';
  const values = points.map(item => item.value), low = Math.min(...values), high = Math.max(...values);
  let previousTime = null;
  const line = points.map(item => {
    const time = Date.parse(item.published_at+'T00:00:00Z');
    const prefix = previousTime === null || time-previousTime !== 86400000 ? 'M' : 'L'; previousTime = time;
    return `${prefix}${12+(time-start)/(29*86400000)*576},${high === low ? 75 : 135-(item.value-low)/(high-low)*120}`;
  }).join(' ');
  return `<svg class="series-chart" viewBox="0 0 600 150" role="img" aria-label="Consultations quotidiennes : de ${low} à ${high}. Les dates et valeurs exactes sont disponibles dans le tableau."><path class="series-grid" d="M12 15H588 M12 135H588"/><path d="${line}"/></svg><p class="chart-description">30 derniers jours de la série · ${esc(new Date(start).toISOString().slice(0,10))} au ${esc(collection.reference_day)} · minimum ${fmt(low)}, maximum ${fmt(high)} consultations/jour. Les dates manquantes ne sont pas interpolées.</p>`;
}

function recordsMarkup(collection, count = 7) {
  if (collection.source === 'wikimedia' || collection.source === 'google_trends') {
    const rows = [...collection.records].sort((a,b) => b.published_at.localeCompare(a.published_at)).slice(0,count);
    return `<div class="evidence-table-wrap"><table class="evidence-table"><caption>${rows.length} derniers points fournis · ${collection.source === 'wikimedia' ? 'consultations quotidiennes' : 'indice normalisé dans cet export'}</caption><thead><tr><th scope="col">Date de mesure</th><th scope="col">Valeur d’origine</th></tr></thead><tbody>${rows.map(item => `<tr><td>${esc(item.published_at)}</td><td>${esc(item.value_text || 'Non renseignée')}</td></tr>`).join('')}</tbody></table></div>`;
  }
  return `<div class="source-records">${collection.records.slice(0,count).map(record => `<article class="source-record"><strong>${esc(record.platform)}</strong><p class="muted small">Publication : ${esc(dateLabel(record.published_at))}</p><a href="${esc(record.url)}" target="_blank" rel="noopener noreferrer">${esc(record.author || 'Ouvrir la publication')}</a><p>${esc(record.excerpt || 'Extrait indisponible.')}</p><small>Vues : ${fmt(record.views)} · interactions : ${fmt(record.interactions)}</small></article>`).join('')}</div>`;
}

async function renderProof(id = state.selected) {
  const data = state.data, trend = data?.trends.find(item => item.id === id) || data?.trends[0];
  const version = ++state.proofVersion, owner = session.user?.id || null;
  if (!trend) { $('proof-content').innerHTML = '<div class="empty-state"><h3>Aucun sujet documenté disponible.</h3><p>Ajoutez des observations réelles depuis Sources & API.</p><a class="button button-outline" href="#sources">Préparer une source</a></div>'; return; }
  state.selected = trend.id;
  $('proof-content').innerHTML = '<div class="empty-state"><p>Chargement des preuves et des dates…</p></div>';
  try {
    const collection = await getCollection(trend.id);
    if (version !== state.proofVersion || data !== state.data || owner !== (session.user?.id || null)) return;
    $('proof-content').innerHTML = `<div class="proof-grid"><article class="proof-main"><span class="category-pill">${esc(trend.category)}</span><h3>${esc(trend.title)}</h3><p class="proof-meta">${esc(provenance(trend))} · ${esc(collection.scope || 'Périmètre défini par la collecte ; vérifier les filtres d’origine.')}</p>${comparisonMarkup(trend)}${seriesMarkup(collection)}<details><summary>Consulter les valeurs et les dates exactes</summary>${recordsMarkup(collection)}</details><button class="text-button" data-export-collection="${esc(trend.id)}">Télécharger les observations complètes</button></article><aside class="proof-context"><span class="status-pill">À INTERPRÉTER ET À RECOUPER</span><h3>${esc(decision().question)}</h3><p>${esc(decision().evidence)}</p><p>${trend.public ? 'Ces articles décrivent des pratiques déjà établies. Leur fréquentation ne prouve pas l’apparition d’un nouvel usage.' : 'Cette collecte doit être recoupée ; les extraits et métriques ne constituent pas une vérification éditoriale.'}</p>${collection.article_url ? `<a class="text-button" href="${esc(collection.article_url)}" target="_blank" rel="noopener noreferrer">Lire l’article sur la pratique</a>` : ''}${collection.source_url ? `<br><a class="text-button" href="${esc(collection.source_url)}" target="_blank" rel="noopener noreferrer">Vérifier les données d’origine</a>` : ''}<p class="muted small">Collecte : ${esc(dateLabel(collection.collected_at))}${collection.imported_at ? ` · Import : ${esc(dateLabel(collection.imported_at))}` : ''}.</p><button class="button button-primary" data-detail="${esc(trend.id)}">Ouvrir la fiche et annoter</button></aside></div>`;
  } catch (error) { if (version === state.proofVersion && owner === (session.user?.id || null)) $('proof-content').innerHTML = `<div class="error-box"><h3>Preuves indisponibles</h3><p>${esc(error.message)}</p><button class="text-button" data-proof-retry>Réessayer</button></div>`; }
}

async function loadRadar() {
  state.request?.abort(); const request = new AbortController(), owner = session.user?.id || null;
  state.request = request; state.owner = owner; state.loading = true; state.data = null; state.filtered = []; state.cache.clear(); state.proofVersion++;
  for (const id of ['export-radar','export-saved','featured-open']) $(id).disabled = true;
  $('radar-error').hidden = true; $('results').innerHTML = '<div class="empty-state"><p>Chargement de l’instantané et des observations…</p></div>'; $('results').setAttribute('aria-busy','true');
  $('proof-content').innerHTML = '<div class="empty-state"><p>Chargement des mesures vérifiables…</p></div>';
  for (const id of ['total-stat','records-stat','sources-stat']) $(id).textContent = '—';
  $('window-caption').textContent = 'Lecture des fenêtres de comparaison…'; renderSaved();
  try {
    const data = await api(`/api/trends?period=${encodeURIComponent($('period').value)}`, {signal:request.signal});
    if (state.request !== request || owner !== (session.user?.id || null)) return;
    const category = $('category').value, source = $('source-filter').value;
    $('category').innerHTML = '<option value="">Toutes les catégories</option>'+data.categories.map(item=>`<option>${esc(item)}</option>`).join('');
    $('category').value = data.categories.includes(category) ? category : '';
    const origins = [...new Set(data.trends.map(item=>item.source))];
    $('source-filter').innerHTML = '<option value="">Toutes les origines</option>'+origins.map(item=>`<option value="${esc(item)}">${esc(sourceName(item))}</option>`).join('');
    $('source-filter').value = origins.includes(source) ? source : '';
    state.data=data; state.loading=false; renderOverview(); renderRadar(); renderProof();
  } catch(error) {
    if(error.name==='AbortError' || state.request !== request) return;
    state.loading=false; $('radar-error').hidden=false; $('radar-error').textContent=error.message;
    $('snapshot-date').textContent='Indisponible'; $('window-caption').textContent='Aucune période chargée.';
    $('results-caption').textContent='Aucun résultat chargé.';
    $('results').innerHTML='<div class="empty-state"><h3>Le radar est indisponible.</h3><p>Vos données conservées restent sur le serveur. Réessayez pour les consulter.</p><button class="button button-outline" data-retry>Réessayer</button></div>';
    $('results').setAttribute('aria-busy','false'); $('proof-content').innerHTML='<div class="empty-state"><p>Les preuves seront disponibles après rechargement du radar.</p></div>'; renderSaved();
  }
}

async function showDetail(id) {
  if(state.loading) return;
  const trend=state.data?.trends.find(item=>item.id===id); if(!trend) return;
  const owner=session.user?.id || null; state.selected=id; renderProof(id);
  $('detail-content').innerHTML='<h2 id="detail-title">Chargement de la fiche…</h2>';
  if(!$('detail-dialog').open) $('detail-dialog').showModal();
  try {
    const collection=await getCollection(id);
    if(owner !== (session.user?.id || null) || state.selected !== id || !$('detail-dialog').open) return;
    const saved=session.saved[id];
    $('detail-content').innerHTML=`<span class="category-pill">${esc(trend.category)}</span><h2 id="detail-title">${esc(trend.title)}</h2><p class="detail-summary">${esc(trend.summary)}</p><div class="decision-box"><p class="eyebrow">${esc(decision().label.toLocaleUpperCase('fr'))} · PISTE À ÉTUDIER</p><p>${esc(decision().question)}</p><p class="muted small">${esc(decision().evidence)}</p></div><h3>Évolution mesurée · ${esc(periodLabel())}</h3>${comparisonMarkup(trend)}<h3>Provenance et observations</h3><p>${esc(provenance(trend))} · ${fmt(trend.record_count)} lignes conservées. Collecte : ${esc(dateLabel(trend.collected_at))}.</p>${collection.scope ? `<p class="muted small">${esc(collection.scope)}</p>` : ''}${collection.article_url ? `<p><a href="${esc(collection.article_url)}" target="_blank" rel="noopener noreferrer">Article décrivant la pratique</a> · <a href="${esc(collection.source_url)}" target="_blank" rel="noopener noreferrer">Réponse de l’API d’origine</a></p>` : ''}${recordsMarkup(collection)}<button class="text-button" data-export-collection="${esc(id)}">Exporter les observations et leur provenance</button><div class="limit-box"><strong>Ce que cette fiche ne démontre pas</strong><p>${trend.partial ? 'Réponse ou série partielle. ' : ''}Une variation ne prouve ni un usage émergent, ni un succès futur, ni une causalité. Les publications sociales, les droits et les talents restent à documenter. L’origine d’un CSV importé est déclarative.</p></div><div class="detail-personal"><h3>Votre analyse éditoriale</h3>${session.user ? `<form id="note-form"><label for="trend-note">Question, éléments à recouper et prochaine vérification</label><textarea id="trend-note" maxlength="2000" rows="5" placeholder="Formulez votre hypothèse et les preuves encore nécessaires.">${esc(saved?.note || '')}</textarea><small>Note privée · 2 000 caractères maximum. L’enregistrement ajoute ce sujet à votre veille.</small><button type="submit" class="button button-primary">Enregistrer mon analyse</button><p id="note-status" role="status"></p></form><button class="text-button detail-save" data-save="${esc(id)}">${saved ? 'Retirer de ma veille' : 'Ajouter à ma veille'}</button>` : '<p>Les analyses privées nécessitent un compte en ligne actif. Les preuves restent consultables et exportables.</p><button class="button button-primary" data-auth>Accéder à mon espace</button>'}</div>`;
    $('note-form')?.addEventListener('submit',async event=>{
      event.preventDefault(); const button=event.submitter || event.currentTarget.querySelector('button[type=submit]'); button.disabled=true;
      try { if(await saveTrend(id,{note:$('trend-note').value}) && state.selected===id && $('note-status')) { $('note-status').textContent='Votre analyse a été enregistrée.'; document.querySelector('.detail-save').textContent='Retirer de ma veille'; } }
      catch(error) { if(state.selected===id && $('note-status')) $('note-status').textContent=error.message; }
      finally { if(button.isConnected) button.disabled=false; }
    });
  } catch(error) { if(owner===(session.user?.id || null) && state.selected===id) $('detail-content').innerHTML=`<h2 id="detail-title">Fiche indisponible</h2><p>${esc(error.message)}</p>`; }
}

function renderHomeSources(data) {
  const snapshot=data.public_snapshot, google=data.items.find(item=>item.id==='google_trends');
  const candidates=[
    {name:'Wikimedia',status:snapshot?.available?'Instantané réel chargé':'Instantané non disponible',message:'Consultations d’articles sur des pratiques culturelles ; série quotidienne publique.',limit:`${snapshot?.topics || 0} sujets chargés · mesures jusqu’au ${snapshot?.reference_day || 'jour non fourni'}. Wikipédia en anglais n’identifie ni un marché ni une audience audiovisuelle.`,url:snapshot?.documentation || 'https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/'},
    {name:'Google Trends',status:data.static_hosting?'Import serveur à connecter':data.collections.some(item=>item.source==='google_trends')?'CSV conservé dans ce compte':'Import CSV disponible',message:'Recouper l’intérêt de recherche à partir d’un export officiel déclaré par son importateur.',limit:'API alpha non connectée. Un indice normalisé ne donne pas un volume absolu ; l’authenticité du CSV reste déclarative.',url:google?.documentation},
    {name:'YouTube',status:'Accès direct à préparer',message:'Réunir des publications et des pratiques de visionnage, avec leurs auteurs et leurs dates.',limit:'Adaptateur direct non implémenté. Connecteur Oriane préparé ; une clé et un appel réel sont nécessaires avant toute affirmation sur ses résultats.',url:data.items.find(item=>item.id==='youtube')?.documentation},
    {name:'Reddit',status:'Accès à valider',message:'Recouper les pratiques exprimées dans des discussions publiques.',limit:'Aucune collecte Reddit dans l’instantané public. Adapter l’accès officiel et vérifier les conditions avant utilisation.',url:data.items.find(item=>item.id==='reddit')?.documentation},
  ];
  $('home-sources').innerHTML=candidates.map(item=>`<article class="home-source-card"><span class="status-pill">${esc(item.status)}</span><h3>${esc(item.name)}</h3><p>${esc(item.message)}</p><p class="source-limitation">${esc(item.limit)}</p><a class="text-button" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Consulter la référence de la source</a></article>`).join('');
}

function closeMenu() {
  const wasOpen = document.body.classList.contains('menu-open');
  document.body.classList.remove('menu-open');
  $('menu-button').setAttribute('aria-expanded', 'false');
  $('nav-backdrop').hidden = true;
  $('sidebar').inert = window.matchMedia('(max-width: 950px)').matches;
  document.querySelector('.app-shell').inert = false;
  if (wasOpen) $('menu-button').focus();
}

function switchView() {
  const hash = location.hash.slice(1);
  const anchors = ['intention', 'horizons', 'rechercher', 'preuves', 'provenance', 'methode'];
  const view = ['radar', 'saved', 'sources', 'account'].includes(hash) ? hash : 'radar';
  $('data-mode').textContent = view === 'sources' ? 'Sources & collecte' : 'Données réelles';
  document.querySelectorAll('.view').forEach((section) => { section.hidden = section.id !== `view-${view}`; });
  document.querySelectorAll('[data-view]').forEach((link) => {
    if (link.dataset.view === view) {
      link.setAttribute('aria-current', 'page');
      $('current-view').textContent = { radar: 'Accueil & radar', saved: 'Ma veille', sources: 'Sources & API', account: 'Mon compte' }[view];
    } else link.removeAttribute('aria-current');
  });
  closeMenu();
  renderSaved();
  document.querySelectorAll('.home-nav a').forEach(link => { if (link.hash === location.hash) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current'); });
  if (anchors.includes(hash)) requestAnimationFrame(() => $(hash).scrollIntoView({ block: 'start', behavior: 'instant' }));
  else window.scrollTo({ top: 0, behavior: 'instant' });
}

function resetFilters() {
  $('query').value=''; $('category').value=''; $('source-filter').value=''; $('sort').value='change_pct'; renderRadar();
}
function download(name, body, type='application/json') {
  const url=URL.createObjectURL(new Blob([body],{type})); const link=document.createElement('a'); link.href=url; link.download=name; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportSelection(savedOnly=false) {
  if(state.loading || !state.data) return;
  const trends=savedOnly?state.data.trends.filter(item=>session.saved[item.id]):state.filtered; if(!trends.length) return;
  const lines=['FROM SOCIAL TO SCREEN — NOTE D’EXPLORATION',`Export : ${state.data.metadata.as_of}`,`Horizon : ${periodLabel()}`,`Intention : ${decision().label}`,decision().question,'Sujets sélectionnés manuellement ou collectes privées. Aucune émergence ni recommandation d’acquisition établie.',''];
  for(const trend of trends) {
    lines.push(trend.title,`Origine : ${provenance(trend)}`,`Catégorie : ${trend.category}`,`Collecte : ${trend.collected_at || 'Date non renseignée'}`);
    const c=trend.comparison;
    if(c) lines.push(`${c.previous_start} au ${c.previous_end} : ${fmt(c.previous)} ; ${c.current_start} au ${c.current_end} : ${fmt(c.current)} ${c.unit}`,`Variation : ${variation(c.change_pct)} ; ${c.previous_days}/${c.days} et ${c.current_days}/${c.days} jours renseignés.`);
    else lines.push('Historique comparable non fourni ; aucune variation calculée.');
    if(trend.source_url) lines.push(`Données d’origine : ${trend.source_url}`);
    if(savedOnly) lines.push(`Analyse privée : ${session.saved[trend.id]?.note || 'Non renseignée'}`);
    lines.push('');
  }
  lines.push('À vérifier : pratiques sociales, public, persistance, droits et adéquation éditoriale. Les consultations ne sont pas des personnes uniques ni des visionnages.');
  download(savedOnly?'from-social-to-screen-ma-veille.txt':'from-social-to-screen-selection.txt',lines.join('\n'),'text/plain;charset=utf-8'); notify('Note d’exploration exportée.');
}

document.addEventListener('click',async event=>{
  const target=event.target.closest('[data-detail], [data-save], [data-auth], [data-close], [data-reset], [data-retry], [data-period], [data-proof-retry], [data-export-collection]'); if(!target) return;
  if(target.hasAttribute('data-detail')) showDetail(target.dataset.detail);
  if(target.hasAttribute('data-auth')) openAuth('login');
  if(target.hasAttribute('data-close')) $(target.dataset.close).close();
  if(target.hasAttribute('data-reset')) resetFilters();
  if(target.hasAttribute('data-retry')) loadRadar();
  if(target.hasAttribute('data-period')) { $('period').value=target.dataset.period; loadRadar(); }
  if(target.hasAttribute('data-proof-retry')) renderProof();
  if(target.hasAttribute('data-export-collection')) {
    const owner=session.user?.id || null;
    try { const collection=await getCollection(target.dataset.exportCollection); if(owner===(session.user?.id || null)) download('from-social-to-screen-observations.json',JSON.stringify(collection,null,2)); }
    catch(error) { notify(error.message); }
  }
  if(target.hasAttribute('data-save')) {
    target.disabled=true;
    try { const remove=Boolean(session.saved[target.dataset.save]); if(await saveTrend(target.dataset.save,{remove})) { notify(remove?'Sujet retiré de votre veille.':'Sujet ajouté à votre veille.'); if($('detail-dialog').open) showDetail(target.dataset.save); } }
    catch(error) { notify(error.message); } finally { target.disabled=false; }
  }
});
document.addEventListener('keydown',event=>{
  if(document.body.classList.contains('menu-open') && event.key==='Tab') {
    const links=[...$('sidebar').querySelectorAll('a,button')];
    if(event.shiftKey && document.activeElement===links[0]) { event.preventDefault(); links.at(-1).focus(); }
    if(!event.shiftKey && document.activeElement===links.at(-1)) { event.preventDefault(); links[0].focus(); }
  }
  if(event.key==='Escape') closeMenu();
  if(event.key==='/' && !event.ctrlKey && !event.metaKey && !event.altKey && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName) && !document.querySelector('dialog[open]')) { event.preventDefault(); location.hash='rechercher'; $('query').focus(); }
});
$('query').addEventListener('input',renderRadar); $('category').addEventListener('change',renderRadar); $('source-filter').addEventListener('change',renderRadar);
$('sort').addEventListener('change',renderRadar); $('period').addEventListener('change',loadRadar);
$('filters').addEventListener('submit',event=>{event.preventDefault();renderRadar()}); $('filters').addEventListener('reset',event=>{event.preventDefault();resetFilters()});
$('decision-focus').addEventListener('change',()=>{ $('decision-question').textContent=decision().question; $('decision-evidence').textContent=decision().evidence; renderProof(); });
$('featured-open').addEventListener('click',()=>showDetail(state.selected || state.data?.trends[0]?.id));
$('prepare-analysis').addEventListener('click',()=>{ if(state.data?.trends.length) showDetail(state.selected || state.data.trends[0].id); else { location.hash='sources'; notify('Ajoutez des observations réelles avant de préparer une analyse.'); } });
$('refresh-snapshot').addEventListener('click',async()=>{
  if(session.storage === 'unavailable') { try { await api('/api/snapshot/refresh',{body:{}}); $('snapshot-operation').textContent='Dernière version publiée relue. La date de collecte des observations reste celle affichée.'; document.dispatchEvent(new Event('collectionchange')); document.dispatchEvent(new Event('snapshotchange')); } catch(error) { $('snapshot-operation').textContent=error.message; } return; }
  if(!session.user) { openAuth('login'); notify('Connectez-vous pour lancer une actualisation des données publiques.'); return; }
  const owner=session.user.id, button=$('refresh-snapshot'); button.disabled=true; $('snapshot-operation').textContent='Actualisation des quatre séries publiques en cours. L’instantané précédent reste conservé jusqu’au succès complet.';
  try { await api('/api/snapshot/refresh',{body:{}}); if(owner!==session.user?.id) return; $('snapshot-operation').textContent='Instantané public actualisé depuis l’API Wikimedia.'; document.dispatchEvent(new Event('collectionchange')); document.dispatchEvent(new Event('snapshotchange')); }
  catch(error) { if(owner===session.user?.id) $('snapshot-operation').textContent=`${error.message} L’instantané précédent reste disponible.`; }
  finally { button.disabled=false; }
});
$('export-radar').addEventListener('click',()=>exportSelection()); $('export-saved').addEventListener('click',()=>exportSelection(true));
$('menu-button').addEventListener('click',()=>{ document.body.classList.add('menu-open'); $('menu-button').setAttribute('aria-expanded','true'); $('nav-backdrop').hidden=false; $('sidebar').inert=false; document.querySelector('.app-shell').inert=true; $('sidebar').querySelector('a').focus(); });
$('nav-backdrop').addEventListener('click',closeMenu); window.matchMedia('(max-width:950px)').addEventListener('change',closeMenu);
document.addEventListener('accountchange',()=>{
  if(state.owner!==(session.user?.id || null)) { state.selected=null; $('detail-dialog').close(); $('detail-content').replaceChildren(); $('snapshot-operation').textContent=''; $('home-sources').innerHTML='<p>Lecture des statuts…</p>'; loadRadar(); }
  else renderRadar();
});
document.addEventListener('sourceserror',event=>{ $('home-sources').innerHTML=`<div class="error-box"><h3>Statuts des sources indisponibles</h3><p>${esc(event.detail)}</p><a class="text-button" href="#sources">Réessayer depuis Sources & API</a></div>`; });
document.addEventListener('sourceschange',event=>renderHomeSources(event.detail)); document.addEventListener('collectionchange',loadRadar);
window.addEventListener('hashchange',switchView);
switchView(); loadRadar(); initializeAccount(); initializeSources();
