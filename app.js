// Coquille de navigation uniquement : aucun jeu de données ou appel API automatique.
const labels = { home: 'Accueil', saved: 'Ma veille', connections: 'Connexions', account: 'Compte' };
const aliases = { radar: 'home', sources: 'connections' };
const sidebar = document.getElementById('sidebar');
const menu = document.getElementById('menu-button');
const backdrop = document.getElementById('nav-backdrop');
const main = document.getElementById('main-content');

function setMenu(open, restoreFocus = false) {
  sidebar.classList.toggle('is-open', open);
  backdrop.hidden = !open;
  document.body.classList.toggle('menu-open', open);
  menu.setAttribute('aria-expanded', String(open));
  menu.setAttribute('aria-label', open ? 'Fermer la navigation' : 'Ouvrir la navigation');
  if (open) sidebar.querySelector('nav a').focus();
  else if (restoreFocus) menu.focus();
}

function navigate(focus = false) {
  const hash = location.hash.slice(1);
  // Le lien d'évitement déplace le focus sans quitter la vue courante.
  if (hash === 'main-content') return;
  const view = aliases[hash] || (Object.hasOwn(labels, hash) ? hash : 'home');
  if (hash !== view) history.replaceState(null, '', `#${view}`);
  document.querySelectorAll('.view').forEach(section => { section.hidden = section.id !== `view-${view}`; });
  document.querySelectorAll('[data-view]').forEach(link => {
    if (link.dataset.view === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.getElementById('current-view').textContent = labels[view];
  document.title = `${labels[view]} · From Social to Screen`;
  setMenu(false);
  if (focus) main.focus();
}

menu.addEventListener('click', () => setMenu(!sidebar.classList.contains('is-open')));
backdrop.addEventListener('click', () => setMenu(false, true));
window.addEventListener('hashchange', () => navigate(true));
matchMedia('(max-width: 760px)').addEventListener('change', () => setMenu(false));
document.querySelectorAll('[data-view], .brand').forEach(link => link.addEventListener('click', () => {
  if (link.hash === location.hash) { setMenu(false); main.focus(); }
}));
document.addEventListener('keydown', event => {
  if (!sidebar.classList.contains('is-open')) return;
  if (event.key === 'Escape') { event.preventDefault(); setMenu(false, true); }
  if (event.key !== 'Tab') return;
  const links = [...sidebar.querySelectorAll('a')];
  if (event.shiftKey && document.activeElement === links[0]) { event.preventDefault(); links.at(-1).focus(); }
  else if (!event.shiftKey && document.activeElement === links.at(-1)) { event.preventDefault(); links[0].focus(); }
});
navigate();
