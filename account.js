// Authentification et profil. La session est portée par un cookie HttpOnly du serveur.
import { request } from "./transport.js";
export const session = { user: null, csrf: "", saved: {}, storage: "local" };
const $ = (id) => document.getElementById(id);
let authMode = "login";
let toastTimer;
let pendingSave = null;

export function notify(message) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").hidden = false;
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 4500);
}

function updateSession(data = {}) {
  Object.assign(session, { user: data.user ?? null, csrf: data.csrf ?? "", saved: data.saved ?? {} });
  renderAccount();
  document.dispatchEvent(new Event("accountchange"));
}

export async function api(path, { body, signal } = {}) {
  const response = await request(path, {
    signal, method: body ? "POST" : "GET", credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json", "X-CSRF-Token": session.csrf } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/api/auth/")) updateSession();
    const error = new Error(data.error || "La requête a échoué. Réessayez.");
    error.status = response.status;
    throw error;
  }
  if (path.startsWith("/api/trends") && data.metadata?.authenticated === false && session.user) updateSession();
  return data;
}

export function openAuth(mode = "login") {
  if (session.storage === "unavailable") { pendingSave = null; location.hash = "account"; notify("Les comptes et la sauvegarde en ligne attendent l’activation de Supabase."); return; }
  authMode = mode;
  const register = mode === "register";
  $("auth-title").textContent = register ? "Votre veille commence ici." : "Retrouvez votre veille.";
  $("auth-description").textContent = register ? "Un espace personnel pour passer des signaux aux idées." : "Connectez-vous pour retrouver vos usages et vos notes.";
  if (pendingSave) $("auth-description").textContent = "Après connexion, cet usage sera ajouté automatiquement à votre veille.";
  $("auth-name-label").hidden = !register;
  $("auth-name").required = register;
  $("auth-login-tab").setAttribute("aria-pressed", String(!register));
  $("auth-register-tab").setAttribute("aria-pressed", String(register));
  $("auth-submit").textContent = register ? "Créer mon espace" : "Se connecter";
  $("auth-password").autocomplete = register ? "new-password" : "current-password";
  $("auth-error").hidden = true;
  if (!$("auth-dialog").open) {
    if ($("detail-dialog").open) $("detail-dialog").close();
    $("auth-dialog").showModal();
  }
}

export async function saveTrend(trendId, options = {}) {
  if (!session.user) {
    pendingSave = { trendId, options };
    openAuth("register");
    return false;
  }
  const owner = session.user.id;
  const data = await api("/api/saved", { body: { trend_id: trendId, ...options } });
  if (owner !== session.user?.id) return false;
  session.saved = data.saved;
  renderAccount();
  document.dispatchEvent(new Event("accountchange"));
  return true;
}

function renderAccount() {
  const user = session.user;
  $("account-guest").hidden = Boolean(user);
  $("account-content").hidden = !user;
  $("export-saved").hidden = !user;
  $("header-account").textContent = user ? user.name : session.storage === "unavailable" ? "État des comptes" : "Se connecter";
  $("sidebar-name").textContent = user?.name || "Espace visiteur";
  $("sidebar-role").textContent = user?.team || (session.storage === "unavailable" ? "Veille en ligne à activer" : "Créer votre veille personnelle");
  $("sidebar-avatar").textContent = user ? user.name.slice(0, 1).toUpperCase() : "V";
  $("saved-count").textContent = Object.keys(session.saved).length;
  if (!user) {
    $("profile-form").reset();
    $("password-form").reset();
    $("password-status").textContent = "";
    if ($("delete-dialog").open) $("delete-dialog").close();
    for (const id of ["profile-name", "profile-email", "profile-created"]) $(id).textContent = "—";
    return;
  }
  $("profile-name").textContent = user.name;
  $("profile-email").textContent = user.email;
  $("profile-avatar").textContent = user.name.slice(0, 1).toUpperCase();
  $("profile-name-input").value = user.name;
  $("profile-team-input").value = user.team;
  $("profile-email-input").value = user.email;
  $("profile-saved").textContent = Object.keys(session.saved).length;
  $("profile-created").textContent = new Date(user.created_at * 1000).toLocaleDateString("fr-FR");
}

export async function initializeAccount() {
  $("header-account").addEventListener("click", () => session.user ? location.hash = "account" : openAuth());
  $("sidebar-profile").addEventListener("click", () => session.user ? location.hash = "account" : openAuth());
  $("create-account").addEventListener("click", () => openAuth("register"));
  $("existing-account").addEventListener("click", () => openAuth());
  $("auth-login-tab").addEventListener("click", () => openAuth("login"));
  $("auth-register-tab").addEventListener("click", () => openAuth("register"));
  $("show-password").addEventListener("click", () => {
    const show = $("auth-password").type === "password";
    $("auth-password").type = show ? "text" : "password";
    $("show-password").textContent = show ? "Masquer" : "Afficher";
    $("show-password").setAttribute("aria-label", show ? "Masquer le mot de passe" : "Afficher le mot de passe");
  });
  $("auth-dialog").addEventListener("close", () => {
    pendingSave = null;
    $("auth-password").value = "";
    $("auth-password").type = "password";
    $("show-password").textContent = "Afficher";
    $("show-password").setAttribute("aria-label", "Afficher le mot de passe");
  });
  $("auth-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("auth-submit");
    button.disabled = true;
    button.textContent = "Un instant…";
    $("auth-error").hidden = true;
    try {
      const data = await api(`/api/auth/${authMode}`, { body: {
        email: $("auth-email").value, password: $("auth-password").value, name: $("auth-name").value,
      } });
      if (data.confirmation_required) {
        pendingSave = null; openAuth("login"); $("auth-error").textContent = data.message; $("auth-error").hidden = false; return;
      }
      updateSession(data);
      const requestedSave = pendingSave;
      $("auth-dialog").close();
      $("auth-form").reset();
      if (requestedSave) {
        try {
          await saveTrend(requestedSave.trendId, requestedSave.options);
          notify(`Bienvenue, ${data.user.name}. L'usage a été ajouté à votre veille.`);
        } catch (error) { notify(`Connexion réussie. L'usage n'a pas pu être enregistré : ${error.message}`); }
      } else notify(`Bienvenue, ${data.user.name}. Votre espace est prêt.`);
    } catch (error) {
      $("auth-error").textContent = error.message;
      $("auth-error").hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = authMode === "register" ? "Créer mon espace" : "Se connecter";
    }
  });
  $("logout").addEventListener("click", async () => {
    try { await api("/api/auth/logout", { body: {} }); updateSession(); notify("Vous êtes déconnecté."); }
    catch (error) { notify(error.message); }
  });
  $("profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter || event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    $("profile-error").hidden = true;
    try {
      const data = await api("/api/account", { body: { name: $("profile-name-input").value, team: $("profile-team-input").value } });
      session.user = data.user;
      renderAccount();
      notify("Votre profil a été mis à jour.");
    } catch (error) { $("profile-error").textContent = error.message; $("profile-error").hidden = false; }
    finally { button.disabled = false; }
  });
  $("password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = $("password-status");
    message.textContent = "";
    message.classList.remove("is-error");
    if ($("new-password").value !== $("confirm-password").value) {
      message.textContent = "Les nouveaux mots de passe ne correspondent pas.";
      message.classList.add("is-error");
      $("confirm-password").focus();
      return;
    }
    const button = event.submitter || event.currentTarget.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const data = await api("/api/account/password", { body: {
        current_password: $("current-password").value, new_password: $("new-password").value,
      } });
      updateSession(data);
      $("password-form").reset();
      message.textContent = data.notice || "Mot de passe mis à jour. Les anciennes sessions de ce serveur sont déconnectées.";
    } catch (error) { message.textContent = error.message; message.classList.add("is-error"); }
    finally { button.disabled = false; }
  });
  $("open-delete-account").addEventListener("click", () => {
    $("delete-error").hidden = true;
    $("delete-dialog").showModal();
  });
  $("delete-dialog").addEventListener("close", () => $("delete-form").reset());
  $("delete-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter || event.currentTarget.querySelector('[type="submit"]');
    button.disabled = true;
    $("delete-error").hidden = true;
    try {
      await api("/api/account/delete", { body: {
        current_password: $("delete-password").value, confirmation: $("delete-confirmation").value,
      } });
      $("delete-dialog").close();
      updateSession();
      notify("Votre compte, vos notes et vos favoris ont été supprimés.");
    } catch (error) { $("delete-error").textContent = error.message; $("delete-error").hidden = false; }
    finally { button.disabled = false; }
  });
  try {
    const config = await api("/api/config");
    session.storage = config.storage?.provider || "local";
    if (session.storage === "unavailable") {
      $("account-guest").innerHTML = '<h2>Comptes en ligne : activation en cours.</h2><p>Le radar public et ses preuves sont disponibles. Les comptes, les notes et Ma veille ne sont pas encore reliés à une base Supabase sur cette publication. Aucun compte ni enregistrement n’est simulé.</p><a class="button button-primary" href="#rechercher">Revenir au radar public</a>';
      $("refresh-snapshot").textContent = "Relire l’instantané publié";
      const note = document.createElement("p"); note.className = "hosting-note"; note.textContent = "Version GitHub Pages · radar public disponible · comptes et sauvegarde Supabase en attente d’activation.";
      document.querySelector(".demo-banner").after(note);
    }
    if (config.storage?.provider === "supabase") {
      document.querySelector(".auth-footnote").textContent = "Compte en ligne. Si une confirmation d’adresse est requise, consultez votre boîte mail avant de vous connecter.";
      $("delete-description").textContent = "Votre compte en ligne, votre profil, vos collectes privées, vos notes et vos favoris seront supprimés. Cette action est irréversible.";
    }
  } catch { /* L’authentification et les écritures vérifient elles-mêmes le service réel. */ }
  try { updateSession(await api("/api/account")); }
  catch (error) { updateSession(); if (error.status !== 401) notify("L'espace compte est momentanément indisponible."); }
}
