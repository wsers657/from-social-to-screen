// Identifiants de projet publics uniquement dans index.html ; aucune clé API côté navigateur.
const base = document.querySelector('meta[name="account-api"]').content;
const storageKey = 'fsts-account-session';
const $ = id => document.getElementById(id);
let mode = 'login';
let session = null;
let refreshTimer;
let renewing;

function message(text = '', error = false) {
  $('auth-status').hidden = error || !text;
  $('auth-error').hidden = !error || !text;
  $(error ? 'auth-error' : 'auth-status').textContent = text;
}

function busy(value) {
  $('auth-form').setAttribute('aria-busy', String(value));
  document.querySelectorAll('#account-guest input, #account-guest button, #logout-button').forEach(element => { element.disabled = value; });
  $('auth-submit').textContent = value ? (mode === 'register' ? 'Création…' : 'Connexion…') : (mode === 'register' ? 'Créer un compte' : 'Se connecter');
}

function setMode(value) {
  mode = value;
  const register = mode === 'register';
  for (const id of ['name-label', 'confirmation-label', 'registration-note']) $(id).hidden = !register;
  $('auth-name').required = register;
  $('auth-confirmation').required = register;
  $('auth-password').autocomplete = register ? 'new-password' : 'current-password';
  $('login-tab').setAttribute('aria-pressed', String(!register));
  $('register-tab').setAttribute('aria-pressed', String(register));
  $('auth-confirmation').setCustomValidity('');
  busy(false);
  message();
}

async function call(action, body, token) {
  let response;
  try {
    response = await fetch(`${base}/${action}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch { throw new Error('Le service de compte est injoignable. Réessayez.'); }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || 'Le service est indisponible. Réessayez.');
    error.status = response.status;
    throw error;
  }
  return result;
}

function remember(value) {
  session = value;
  try {
    if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
    else sessionStorage.removeItem(storageKey);
  } catch { /* Une session en mémoire reste utilisable si le stockage d'onglet est bloqué. */ }
  clearTimeout(refreshTimer);
  if (session) refreshTimer = setTimeout(() => restore(), Math.max(30000, session.expires_at * 1000 - Date.now() - 60000));
}

function showUser(user) {
  $('account-member').hidden = !user;
  $('account-guest').hidden = Boolean(user);
  $('member-name').textContent = user ? `Bonjour ${user.name}.` : '';
  $('member-email').textContent = user?.email || '';
  $('header-account').setAttribute('aria-label', user ? `Compte de ${user.name}` : 'Compte');
}

function accept(result) {
  const data = result.session;
  if (!data?.access_token || !data?.refresh_token || !Number.isFinite(data.expires_at) || !result.user?.id) throw new Error('La connexion n’a pas pu être vérifiée. Réessayez.');
  remember(data);
  showUser(result.user);
  $('auth-form').reset();
}

async function renew() {
  if (!renewing) {
    renewing = call('refresh', { refresh_token: session.refresh_token }).then(result => { accept(result); return result; }).finally(() => { renewing = null; });
  }
  return renewing;
}

async function restore() {
  if (!session) return;
  message('Vérification de votre connexion…');
  busy(true);
  try {
    if (session.expires_at * 1000 < Date.now() + 60000) await renew();
    else {
      const result = await call('me', undefined, session.access_token);
      showUser(result.user);
      remember(session);
    }
    message();
  } catch (error) {
    if (error.status === 401) { remember(null); showUser(null); }
    message(error.message, true);
  } finally { busy(false); }
}

export function initializeAccount() {
  $('login-tab').addEventListener('click', () => setMode('login'));
  $('register-tab').addEventListener('click', () => setMode('register'));
  $('auth-confirmation').addEventListener('input', () => $('auth-confirmation').setCustomValidity(''));
  $('auth-password').addEventListener('input', () => $('auth-confirmation').setCustomValidity(''));
  $('show-password').addEventListener('click', () => {
    const show = $('auth-password').type === 'password';
    $('auth-password').type = show ? 'text' : 'password';
    $('auth-confirmation').type = show ? 'text' : 'password';
    $('show-password').textContent = show ? 'Masquer' : 'Afficher';
    $('show-password').setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
    $('show-password').setAttribute('aria-pressed', String(show));
  });
  $('auth-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (mode === 'register' && $('auth-password').value !== $('auth-confirmation').value) {
      $('auth-confirmation').setCustomValidity('Les deux mots de passe doivent être identiques.');
      $('auth-confirmation').reportValidity();
      return;
    }
    const action = mode;
    const payload = { email: $('auth-email').value.trim(), password: $('auth-password').value };
    if (action === 'register') payload.name = $('auth-name').value.trim();
    busy(true); message(action === 'register' ? 'Création de votre compte…' : 'Connexion…');
    try {
      accept(await call(action, payload));
      message(action === 'register' ? 'Votre compte a été créé.' : 'Vous êtes connecté.');
    } catch (error) { message(error.message, true); }
    finally { busy(false); }
  });
  $('logout-button').addEventListener('click', async () => {
    busy(true); message('Déconnexion…');
    try {
      if (session.expires_at * 1000 < Date.now() + 60000) await renew();
      await call('logout', {}, session.access_token);
      remember(null); showUser(null); setMode('login');
      message('Vous êtes déconnecté.');
    } catch (error) {
      if (error.status === 401) { remember(null); showUser(null); message('Vous êtes déconnecté.'); }
      else message(error.message, true);
    } finally { busy(false); }
  });
  try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey));
    if (stored?.access_token && stored?.refresh_token && Number.isFinite(stored.expires_at)) session = stored;
  } catch { /* Aucune identité n'est déduite d'une valeur stockée invalide. */ }
  if (session) restore();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && session && session.expires_at * 1000 < Date.now() + 60000) restore();
  });
}
