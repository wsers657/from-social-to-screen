// Catalogue d'accès, recherche Oriane et imports. Aucun secret n'est conservé côté client.
import { api, session, openAuth, notify } from './account.js';
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const number = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const fmt = (value) => value == null ? 'Non renseigné' : number.format(value);
const platformLabel = (value) => ({ wikimedia: 'Wikimedia', google_trends: 'Google Trends', youtube: 'YouTube', reddit: 'Reddit', instagram: 'Instagram', tiktok: 'TikTok' })[value] || value;
const state = { items: [], selected: null, selection: null, lastRequest: null, visible: 20, busy: false, owner: null, refresh: null };

function dateLabel(value) {
  if (!value) return 'Date inconnue';
  return value.length <= 10 ? value : new Date(value).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
}

function sourceStatus(source) {
  if (!session.user) return 'Configuration privée';
  if (source.last_success_at) return 'Requête validée';
  if (source.id === 'oriane' && source.credential_present && source.approved) return 'Prêt à tester';
  if (source.id === 'google_trends' && source.approved) return 'Import disponible';
  return source.approved ? 'Documentation à compléter' : 'À préparer';
}

function renderCatalog(data) {
  state.items = data.items;
  const snapshot = data.public_snapshot;
  $('public-source-status').textContent = snapshot?.available ? `${snapshot.topics} sujets documentés · mesures jusqu’au ${snapshot.reference_day} · collecte : ${dateLabel(snapshot.collected_at)}.` : 'Aucun instantané public disponible. Actualisez-le depuis l’accueil.';
  document.dispatchEvent(new CustomEvent('sourceschange', {detail: data}));
  $('source-guest').hidden = Boolean(session.user);
  $('sources-summary').textContent = `${data.collections.length} collecte${data.collections.length > 1 ? 's' : ''} privée${data.collections.length > 1 ? 's' : ''} enregistrée${data.collections.length > 1 ? 's' : ''}`;
  $('source-cards').innerHTML = data.items.map((source) => `
    <article class="source-card connector-card">
      <div class="source-card-top"><span class="connector-symbol">${esc(source.name.slice(0, 1))}</span><span class="subtle-tag">${esc(source.type)}</span></div>
      <h2>${esc(source.name)}</h2><p>${esc(source.purpose)}</p>
      <div class="connector-state"><strong>${esc(sourceStatus(source))}</strong><span>${esc(source.mode)}</span>${source.last_success_at ? `<small>Dernière requête réussie : ${dateLabel(source.last_success_at)}</small>` : ''}</div>
      <button type="button" class="button button-outline" data-source="${source.id}">${source.id === 'oriane' ? 'Configurer et explorer' : source.id === 'google_trends' ? 'Configurer et importer' : 'Préparer cet accès'}</button>
    </article>`).join('');
  $('source-history-list').innerHTML = data.collections.length ? data.collections.map((collection) => `
    <button type="button" class="collection-row" data-collection="${collection.id}"><span><strong>${esc(collection.query)}</strong><small>${esc(collection.source)} · ${collection.record_count} observations · ${dateLabel(collection.saved_at)}</small></span><span class="status-pill">${collection.provenance === 'provider_api' ? 'API fournisseur' : 'Export déclaré'}</span></button>`).join('')
    : `<div class="empty-state"><h3>Les preuves de votre veille, au même endroit.</h3><p>${session.user ? 'Enregistrez une sélection Oriane ou importez une série Google Trends. Aucun résultat politique de l’ancien projet n’a été importé.' : 'Connectez-vous pour conserver vos collectes dans votre espace.'}</p></div>`;
}

async function refreshCatalog() {
  state.refresh?.abort();
  state.refresh = new AbortController();
  const owner = session.user?.id;
  $('sources-error').hidden = true;
  try {
    const data = await api('/api/sources', { signal: state.refresh.signal });
    if (owner !== session.user?.id) return;
    renderCatalog(data);
  } catch (error) {
    if (error.name === 'AbortError') return;
    document.dispatchEvent(new CustomEvent('sourceserror', {detail: error.message}));
    $('sources-error').textContent = `Impossible de lire les sources : ${error.message}`;
    $('sources-error').hidden = false;
    $('public-source-status').textContent = 'État de l’instantané indisponible. Réessayez pour vérifier les dates.';
  }
}

function chooseSource(id, scroll = true) {
  if (!session.user) { openAuth('login'); return; }
  const source = state.items.find((item) => item.id === id);
  if (!source) return;
  state.selected = id;
  $('source-workspace').hidden = false;
  $('source-workspace-title').textContent = source.name;
  $('source-documentation').href = source.documentation;
  $('source-requirement').textContent = source.requirement;
  $('source-doc-url').value = source.documentation_url;
  $('source-key').value = '';
  $('source-clear-key').checked = false;
  $('source-approved').checked = source.approved;
  $('source-key-label').hidden = id !== 'oriane';
  $('clear-key-label').hidden = id !== 'oriane';
  $('source-key').placeholder = source.credential_present ? 'Clé présente · laisser vide pour la conserver' : 'Coller la clé privée ici';
  $('source-config-status').textContent = '';
  $('oriane-workbench').hidden = id !== 'oriane';
  $('trends-workbench').hidden = id !== 'google_trends';
  $('future-workbench').hidden = ['oriane', 'google_trends'].includes(id);
  $('oriane-readiness').textContent = !source.approved ? 'Enregistrez la validation de votre équipe pour activer la recherche.'
    : !source.credential_present ? 'Ajoutez une clé privée pour activer la recherche.' : 'Recherche côté serveur disponible. Aucun appel avant votre clic.';
  setBusy(state.busy);
  if (scroll) { $('source-workspace').scrollIntoView({ block: 'start', behavior: 'instant' }); $('source-workspace-title').focus({ preventScroll: true }); }
}

function setBusy(busy) {
  state.busy = busy;
  const source = state.items.find((item) => item.id === state.selected);
  $('oriane-search-submit').disabled = busy || !session.user || !source?.approved || !source?.credential_present;
  $('trends-import-submit').disabled = busy || !session.user || !source?.approved;
  $('source-next').disabled = busy;
  $('source-save').disabled = busy || (state.selection?.stored_count ?? 0) >= (state.selection?.records?.length ?? 0);
  $('source-config-form').querySelector('[type=submit]').disabled = busy;
  $('oriane-search-submit').textContent = busy ? 'Recherche en cours…' : 'Rechercher les publications';
}

function showSelection(selection) {
  state.selection = selection;
  $('source-selection').hidden = false;
  $('source-selection-title').textContent = selection.query;
  $('source-selection-nature').textContent = selection.provenance === 'public_api' ? 'API publique Wikimedia' : selection.provenance === 'provider_api' ? 'Résultats fournisseur' : 'Export déclaré par l’utilisateur';
  const stored = selection.stored_count ?? (selection.saved_at ? selection.records.length : 0);
  const announced = selection.source === 'oriane' ? fmt(selection.total_announced) : 'Sans objet';
  $('source-selection-counts').innerHTML = `<div><span>Annoncés par le fournisseur</span><strong>${announced}</strong></div><div><span>Chargés dans cette sélection</span><strong>${selection.records.length}</strong></div><div><span>Conservés dans votre espace</span><strong>${stored}</strong></div>`;
  const summary = selection.summary;
  const socialSummary = selection.source === 'oriane' ? ` ${summary.authors} auteurs renseignés ; vues renseignées pour ${summary.views_known_for} publications${summary.views_sum == null ? '' : ` : ${fmt(summary.views_sum)} vues cumulées, pas des spectateurs uniques`}.` : '';
  const recurring = selection.source === 'oriane' && summary.terms.length ? ` Mots récurrents dans les extraits : ${summary.terms.map((item) => `${item.term} (${item.publications})`).join(', ')}. Comptage lexical de la sélection.` : '';
  $('source-analysis').textContent = `${summary.platforms.map(platformLabel).join(', ')}.${socialSummary}${recurring}${selection.series ? ` Série : ${selection.series}.` : ''}`;
  const collectionDate = selection.imported_at ? `Importé : ${dateLabel(selection.imported_at)}. Date d'extraction d'origine non fournie.` : `Collecte : ${dateLabel(selection.collected_at)}.`;
  $('source-selection-limit').textContent = `${selection.partial ? 'Réponse fournisseur partielle. ' : ''}${collectionDate} ${selection.rows_scanned != null ? `${selection.rows_scanned} lignes fournisseur parcourues ; doublons et liens inexploitables écartés. ` : ''}Cette sélection ne prouve ni l'émergence d'un usage ni un succès futur. Aucun score d’émergence n’est calculé. Les sélections conservées apparaissent dans votre radar.`;
  $('source-next').hidden = selection.next_offset == null || !state.lastRequest || Boolean(selection.saved_at);
  $('source-save').hidden = !selection.selection_id || Boolean(selection.saved_at);
  renderRecords();
  setBusy(state.busy);
}

function renderRecords() {
  const records = state.selection.records;
  $('source-records').innerHTML = records.slice(0, state.visible).map((record) => `
    <article class="source-record"><div class="source-record-heading"><span class="category-pill">${esc(platformLabel(record.platform))}</span><span class="muted small">${esc(dateLabel(record.published_at))}</span></div>
      <a href="${esc(record.url)}" target="_blank" rel="noopener noreferrer">${esc(record.author || record.excerpt || 'Voir la source')}</a>
      ${['google_trends', 'wikimedia'].includes(record.platform) ? `<p>${record.platform === 'wikimedia' ? 'Consultations' : 'Intérêt'} : <strong>${esc(record.value_text || 'Non renseigné')}</strong> · ${esc(record.unit)} · précision : ${esc(({ day: 'jour', month: 'mois', year: 'année' })[record.date_precision])}</p>` : `<p>${esc(record.excerpt || 'Aucun extrait disponible.')}</p><small>${esc(record.excerpt_type)} · Vues : ${fmt(record.views)} · Interactions : ${fmt(record.interactions)}</small>`}
    </article>`).join('') + (state.visible < records.length ? `<button type="button" class="button button-outline" data-more-records>Afficher 20 observations de plus (${Math.min(state.visible, records.length)} sur ${records.length})</button>` : '');
}

function operationError(error) {
  $('source-operation-error').textContent = `${error.message}${state.selection ? ' La sélection précédente est conservée.' : ''}`;
  $('source-operation-error').hidden = false;
}

async function searchOriane(request) {
  const owner = session.user?.id;
  setBusy(true);
  $('source-operation-error').hidden = true;
  try {
    const result = await api('/api/sources/search-oriane', { body: request });
    if (owner !== session.user?.id) return;
    if (!request.offset) state.visible = 20;
    state.lastRequest = request;
    showSelection(result);
    await refreshCatalog();
  } catch (error) { if (owner === session.user?.id) operationError(error); }
  finally { setBusy(false); }
}

function download(name, body, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function initializeSources() {
  $('refresh-sources').addEventListener('click', refreshCatalog);
  document.addEventListener('snapshotchange', refreshCatalog);
  $('sources-login').addEventListener('click', () => openAuth('login'));
  document.addEventListener('click', async (event) => {
    const sourceButton = event.target.closest('[data-source]');
    if (sourceButton) chooseSource(sourceButton.dataset.source);
    if (event.target.closest('[data-more-records]')) { state.visible += 20; renderRecords(); }
    const collectionButton = event.target.closest('[data-collection]');
    if (collectionButton) {
      const owner = session.user?.id;
      try {
        const result = await api(`/api/sources/collection?id=${encodeURIComponent(collectionButton.dataset.collection)}`);
        if (owner !== session.user?.id) return;
        state.lastRequest = null; state.visible = 20; showSelection(result);
        $('source-selection').scrollIntoView({ block: 'start', behavior: 'instant' });
      } catch (error) { operationError(error); }
    }
  });
  $('source-config-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const owner = session.user?.id;
    const source = state.selected;
    setBusy(true);
    $('source-config-status').textContent = '';
    try {
      const result = await api('/api/sources/configure', { body: { source, approved: $('source-approved').checked,
        documentation_url: $('source-doc-url').value, credential: $('source-key').value, clear_credential: $('source-clear-key').checked } });
      if (owner !== session.user?.id) return;
      renderCatalog(result); chooseSource(source, false); state.selection = null;
      $('source-selection').hidden = true; $('source-key').value = '';
      $('source-config-status').textContent = source === 'oriane' ? 'Configuration enregistrée. La présence d’une clé ne constitue pas un test de connexion.' : 'Configuration enregistrée. Les possibilités disponibles sont indiquées ci-dessous.';
    } catch (error) { $('source-config-status').textContent = error.message; }
    finally { setBusy(false); }
  });
  $('oriane-search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    searchOriane({ query: $('oriane-query').value, period: $('oriane-period').value, platform: $('oriane-platform').value,
      sort: $('oriane-sort').value, category: $('oriane-category').value, decision: $('oriane-decision').value, offset: 0 });
  });
  $('source-next').addEventListener('click', () => searchOriane({ ...state.lastRequest, offset: state.selection.next_offset, selection_id: state.selection.selection_id }));
  $('source-save').addEventListener('click', async () => {
    const owner = session.user?.id;
    const selectionId = state.selection?.selection_id;
    setBusy(true); $('source-operation-error').hidden = true;
    try {
      const result = await api('/api/sources/save', { body: { selection_id: selectionId } });
      if (owner !== session.user?.id || selectionId !== state.selection?.selection_id) return;
      showSelection({ ...state.selection, stored_count: result.stored_count }); await refreshCatalog();
      document.dispatchEvent(new Event('collectionchange'));
      notify('Sélection conservée avec sa provenance dans votre espace.');
    } catch (error) { operationError(error); }
    finally { setBusy(false); }
  });
  $('trends-import-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = $('trends-file').files[0];
    if (!file || file.size > 1_000_000) { operationError(new Error('Choisissez un CSV de 1 Mo maximum.')); return; }
    const owner = session.user?.id;
    setBusy(true); $('source-operation-error').hidden = true;
    try {
      const result = await api('/api/sources/import-trends', { body: { content: await file.text(), query: $('trends-query').value,
        category: $('trends-category').value, decision: $('trends-decision').value, source_url: $('trends-url').value,
        column: Number($('trends-column').value), simulated: false, confirmed_official_export: $('trends-confirm-real').checked } });
      if (owner !== session.user?.id) return;
      state.lastRequest = null; state.visible = 20; showSelection(result); await refreshCatalog();
      document.dispatchEvent(new Event('collectionchange'));
      notify('Série importée et enregistrée. Aucun score de tendance déduit automatiquement.');
    } catch (error) { if (owner === session.user?.id) operationError(error); }
    finally { setBusy(false); }
  });
  $('source-export').addEventListener('click', () => {
    if (state.selection) download('signal-collecte.json', JSON.stringify(state.selection, null, 2));
  });
  document.addEventListener('accountchange', () => {
    if (state.owner === session.user?.id) return;
    state.owner = session.user?.id; state.selection = null; state.lastRequest = null; state.selected = null;
    $('source-workspace').hidden = true; $('source-selection').hidden = true; $('source-key').value = '';
    $('source-config-status').textContent = ''; $('source-operation-error').hidden = true;
    state.items = []; $('source-cards').replaceChildren(); $('source-doc-url').value = ''; $('source-approved').checked = false;
    $('sources-summary').textContent = 'Lecture des accès…';
    $('source-history-list').replaceChildren(); $('source-records').replaceChildren(); refreshCatalog();
  });
  refreshCatalog();
}
