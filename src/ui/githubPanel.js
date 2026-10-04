/**
 * GITHUB — Parte 19
 * -----------------
 * B18: o rótulo visível é SEMPRE "Atualizar código". A string "Commit GitHub"
 *      não existe mais na interface.
 * B19: exatamente 4 integrantes, nesta ordem: João Vitor, José, Rafael, Fernanda.
 * S01: o token NUNCA chega ao navegador — toda chamada passa por /api/github/*.
 * S02: e-mails NUNCA aparecem na interface.
 * N18: sem credenciais ou sem resposta, mostrar estado "indisponível".
 *      NUNCA inventar números.
 *
 * 19.5: avatar_url REAL do GitHub. Proibido avatar genérico. Sem username
 *       configurado, mostrar iniciais em disco colorido (Parte 26).
 */

import { sound } from "./sound.js";

const AVATAR_COLORS = ["#3D7EFF", "#FF6B6B", "#9B6BFF", "#FFB03A"];

export class GitHubPanel {
  constructor({
    panel, toggle, close, contributor, repoPath, message, commitButton,
    profileStack, profilePanel, profileName, profileSummary, ranking,
    closeProfile, getFiles, getActiveOutput, onToast, onLog,
  }) {
    Object.assign(this, {
      panel, toggle, close, contributor, repoPath, message, commitButton,
      profileStack, profilePanel, profileName, profileSummary, ranking,
      closeProfile, getFiles, getActiveOutput, onToast, onLog,
    });

    this.users = [];
    this.available = false;
    this.busy = false;
    this.lastCommitter = null;
    this.order = ["1", "2", "3", "4"]; // João Vitor, José, Rafael, Fernanda

    this.bind();
  }

  bind() {
    this.toggle?.addEventListener("click", () => this.setOpen(!this.isOpen));
    this.close?.addEventListener("click", () => this.setOpen(false));
    this.commitButton?.addEventListener("click", () => this.commit());
    this.contributor?.addEventListener("change", () => {
      sound.play("click");
      this.onLog?.(`Integrante selecionado: ${this.selectedUser()?.name ?? "—"}`, "info");
    });
    this.profileStack?.addEventListener("click", (event) => {
      const avatar = event.target.closest(".profile-avatar");
      if (!avatar) return;
      this.openProfile(avatar.dataset.user);
    });
    this.closeProfile?.addEventListener("click", () => this.closeProfilePanel());
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.closeProfilePanel();
    });
  }

  get isOpen() { return this.panel?.classList.contains("open") ?? false; }

  setOpen(open) {
    this.panel?.classList.toggle("open", open);
    document.getElementById("mainGrid")?.classList.toggle("github-open", open);
    this.toggle?.setAttribute("aria-expanded", String(open));
  }

  /* ------------------------------ usuários ------------------------------ */

  /**
   * Busca os integrantes autorizados + avatar real no GitHub.
   * O servidor resolve username/email a partir do .env (S01/S02):
   * nenhum e-mail é enviado ao navegador.
   */
  async loadUsers() {
    this.renderStack([]);
    try {
      const response = await fetch("/api/github/stats");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      this.users = normalizeUsers(data.users);
      this.available = Boolean(data.available);
      this.renderContributorOptions();
      await this.loadAvatars();
      this.renderStack(this.users);
      this.renderRanking();
      if (!this.available) {
        this.onLog?.("GitHub indisponível: GITHUB_TOKEN/GITHUB_REPOSITORY não configurados no servidor. Métricas não são inventadas.", "warning");
      }
      return this.users;
    } catch (error) {
      this.available = false;
      this.users = FALLBACK_USERS.map((user) => ({ ...user, added: 0, deleted: 0, commits: 0, files: 0, lastActivity: null }));
      this.renderContributorOptions();
      await this.loadAvatars();
      this.renderStack(this.users);
      this.renderRanking();
      this.onLog?.(`Não foi possível ler as métricas do GitHub (${error.message}). Estado: indisponível.`, "warning");
      return this.users;
    }
  }

  /**
   * Avatar REAL do GitHub (19.5). Se não houver username configurado,
   * usa iniciais em disco colorido — nunca avatar genérico de estoque.
   */
  async loadAvatars() {
    await Promise.all(this.users.map(async (user) => {
      if (!user.username) return;
      try {
        const response = await fetch(`/api/github/avatar?u=${encodeURIComponent(user.username)}`);
        if (!response.ok) return;
        const data = await response.json();
        if (data?.avatar_url) {
          user.avatar = data.avatar_url;
          user.login = data.login ?? user.username;
          user.githubName = data.name ?? user.name;
        }
      } catch { /* mantém iniciais */ }
    }));
  }

  renderContributorOptions() {
    if (!this.contributor) return;
    // B19: exatamente 4 opções, nesta ordem
    const options = this.users.length ? this.users : FALLBACK_USERS;
    this.contributor.replaceChildren(...options.map((user) => {
      const option = document.createElement("option");
      option.value = user.id;
      option.textContent = user.name; // só o NOME — sem e-mail (S02)
      return option;
    }));
  }

  selectedUser() {
    const id = this.contributor?.value ?? "1";
    return (this.users.length ? this.users : FALLBACK_USERS).find((user) => user.id === id) ?? null;
  }

  /* ------------------------------ avatares ------------------------------ */

  /**
   * Pilha de avatares no canto superior direito (19.5).
   * Máximo 3 visíveis + indicador +N. Último contribuidor primeiro.
   */
  renderStack(users) {
    if (!this.profileStack) return;
    const ordered = [...users].sort((a, b) => {
      if (a.username === this.lastCommitter) return -1;
      if (b.username === this.lastCommitter) return 1;
      return (b.added ?? 0) - (a.added ?? 0);
    });

    const visible = ordered.slice(0, 3);
    const rest = ordered.length - visible.length;

    const nodes = visible.map((user, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "profile-avatar";
      button.dataset.user = user.username ?? user.id;
      button.style.setProperty("--avatar-color", AVATAR_COLORS[index % AVATAR_COLORS.length]);
      button.title = describeUser(user);
      button.setAttribute("aria-label", describeUser(user));

      if (user.avatar) {
        button.classList.add("photo", "connected");
        const image = document.createElement("img");
        image.src = user.avatar;
        image.alt = "";
        image.loading = "lazy";
        image.referrerPolicy = "no-referrer";
        image.addEventListener("error", () => {
          button.classList.remove("photo");
          button.textContent = initials(user.name);
        });
        button.appendChild(image);
      } else {
        button.textContent = initials(user.name);
      }
      if (user.username === this.lastCommitter) button.classList.add("last-commit");
      return button;
    });

    if (rest > 0) {
      const more = document.createElement("span");
      more.className = "team-more";
      more.textContent = `+${rest}`;
      more.title = `${rest} integrante(s) a mais`;
      nodes.push(more);
    }

    this.profileStack.replaceChildren(...nodes);
    this.profileStack.classList.toggle("connected", this.available);
  }

  /* ------------------------------ perfil / ranking ------------------------------ */

  openProfile(username) {
    if (!this.profilePanel) return;
    const user = this.users.find((item) => item.username === username || item.id === username);

    if (!this.available || !user) {
      // N18: estado "indisponível", sem números inventados
      this.profileName.textContent = "Ranking de versionamento";
      this.profileSummary.innerHTML = `<p class="unavailable">Métricas indisponíveis. Configure GITHUB_TOKEN e GITHUB_REPOSITORY nas variáveis de ambiente da Vercel.</p>`;
      this.ranking.replaceChildren();
    } else {
      this.profileName.textContent = `${user.githubName ?? user.name} · @${user.username}`;
      this.profileSummary.innerHTML = `
        <div class="profile-avatar big${user.avatar ? " photo" : ""}" style="--avatar-color:${AVATAR_COLORS[0]}">
          ${user.avatar ? `<img src="${user.avatar}" alt="" referrerpolicy="no-referrer" />` : initials(user.name)}
        </div>
        <dl>
          <div><dt>Linhas adicionadas</dt><dd>${formatNumber(user.added)}</dd></div>
          <div><dt>Linhas removidas</dt><dd>${formatNumber(user.deleted)}</dd></div>
          <div><dt>Atualizações</dt><dd>${formatNumber(user.commits)}</dd></div>
          <div><dt>Última atividade</dt><dd>${relativeTime(user.lastActivity)}</dd></div>
        </dl>`;
      this.renderRanking();
    }

    this.profilePanel.hidden = false;
    this.profilePanel.classList.add("show");
  }

  closeProfilePanel() {
    this.profilePanel?.classList.remove("show");
    this.profilePanel?.setAttribute("hidden", "");
  }

  /** 19.7: separado em adicionadas / removidas / commits, com o rótulo obrigatório. */
  renderRanking() {
    if (!this.ranking) return;
    if (!this.available) {
      this.ranking.innerHTML = `<li class="unavailable">Indisponível — sem credenciais ou sem resposta do GitHub.</li>`;
      return;
    }
    const ordered = [...this.users].sort((a, b) => (b.added ?? 0) - (a.added ?? 0));
    this.ranking.replaceChildren(...ordered.map((user, index) => {
      const item = document.createElement("li");
      item.innerHTML = `
        <span class="rank">${index + 1}.</span>
        <span class="who">${escapeHtml(user.githubName ?? user.name)}${user.username ? ` <em>@${escapeHtml(user.username)}</em>` : ""}</span>
        <span class="metrics">${formatNumber(user.added)} linhas adicionadas · ${formatNumber(user.deleted)} removidas · ${formatNumber(user.commits)} atualizações</span>`;
      return item;
    }));
  }

  /* ------------------------------ commit ------------------------------ */

  /**
   * 19.3: commit atômico multi-arquivo via Git Data API (api/github/commit.js).
   * O caminho muda automaticamente com a saída ativa (19.1) e é somente leitura.
   */
  async commit() {
    if (this.busy) return;
    const files = this.getFiles?.() ?? [];
    const user = this.selectedUser();
    if (!user) { this.onToast?.("Selecione um integrante.", "warning"); return; }

    const changed = files.filter((file) => file.gitStatus !== "sincronizado");
    if (!changed.length) {
      this.onToast?.("Nada para atualizar: nenhum arquivo modificado.", "info");
      this.onLog?.("Nenhum arquivo modificado — nada foi enviado.", "info");
      return;
    }

    this.busy = true;
    this.commitButton?.classList.add("busy");
    this.commitButton?.setAttribute("disabled", "");
    this.onLog?.(`Enviando ${changed.length} arquivo(s) para o repositório…`, "info");

    try {
      const response = await fetch("/api/github/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: user.id,
          message: (this.message?.value || "atualizar código").slice(0, 120),
          files: changed.map((file) => ({
            path: repositoryPath(file, this.getActiveOutput?.()),
            content: file.content,
          })),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);

      this.lastCommitter = user.username ?? null;
      changed.forEach((file) => { file.gitStatus = "sincronizado"; file.modified = false; });
      sound.play("commit");
      this.onToast?.("Código atualizado no GitHub.", "success");
      this.onLog?.(`Código atualizado no GitHub por ${user.name}. ${data.commit ?? ""}`, "success");
      this.renderStack(this.users);
      await this.loadUsers();
      return data;
    } catch (error) {
      sound.play("error");
      this.onToast?.("Não foi possível atualizar o código.", "error");
      this.onLog?.(`Falha ao atualizar o código: ${error.message}`, "error");
      return null;
    } finally {
      this.busy = false;
      this.commitButton?.classList.remove("busy");
      this.commitButton?.removeAttribute("disabled");
    }
  }
}

/* ------------------------------------------------------------------ */
/* Caminho no repositório (19.1)                                       */
/* ------------------------------------------------------------------ */

/**
 * Saída 5 -> programacao/saidas/saida_5.py
 * Outros arquivos -> programacao/<caminho relativo>
 */
export function repositoryPath(file, activeOutput = null) {
  // Normaliza de verdade: colapsa barras repetidas e remove as das pontas.
  // Só tirar a barra inicial deixava "missions//saida_2.py" escapar para o
  // ramo genérico e gerar um caminho que o backend rejeita.
  const path = String(file?.path ?? "")
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "");
  const mission = /^missions\/saida_(\d+)\.py$/.exec(path);
  if (mission) return `programacao/saidas/saida_${mission[1]}.py`;
  if (path === "main.py") return "programacao/main.py";
  return `programacao/${path}`;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const FALLBACK_USERS = [
  { id: "1", name: "João Vitor", username: "", added: 0, deleted: 0, commits: 0, files: 0, lastActivity: null },
  { id: "2", name: "José", username: "", added: 0, deleted: 0, commits: 0, files: 0, lastActivity: null },
  { id: "3", name: "Rafael", username: "", added: 0, deleted: 0, commits: 0, files: 0, lastActivity: null },
  { id: "4", name: "Fernanda", username: "", added: 0, deleted: 0, commits: 0, files: 0, lastActivity: null },
];

function normalizeUsers(raw) {
  const list = Array.isArray(raw) && raw.length ? raw : FALLBACK_USERS;
  // Ordem obrigatória (B19): João Vitor, José, Rafael, Fernanda
  const byName = new Map(list.map((user) => [String(user.name ?? "").trim().toLowerCase(), user]));
  return FALLBACK_USERS.map((fallback, index) => {
    const found = byName.get(fallback.name.toLowerCase()) ??
      list.find((user) => String(user.id) === fallback.id);
    return {
      ...fallback,
      ...(found ?? {}),
      id: String(index + 1),
      name: fallback.name, // o NOME da interface é fixo
    };
  });
}

const initials = (name) => String(name ?? "?")
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0].toUpperCase())
  .join("");

function formatNumber(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return "0";
  return number.toLocaleString("pt-BR");
}

function relativeTime(unixSeconds) {
  if (!unixSeconds) return "sem registro";
  const diff = Date.now() / 1000 - Number(unixSeconds);
  if (!Number.isFinite(diff) || diff < 0) return "sem registro";
  if (diff < 60) return "agora";
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  if (diff < 2592000) return `há ${Math.floor(diff / 86400)} dias`;
  return new Date(Number(unixSeconds) * 1000).toLocaleDateString("pt-BR");
}

function describeUser(user) {
  const parts = [user.githubName ?? user.name];
  if (user.username) parts.push(`@${user.username}`);
  if (user.commits) parts.push(`${formatNumber(user.commits)} atualizações`);
  if (user.lastActivity) parts.push(`última atividade ${relativeTime(user.lastActivity)}`);
  // S02: nunca inclui e-mail
  return parts.join(" · ");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

export { FALLBACK_USERS };
export default GitHubPanel;
