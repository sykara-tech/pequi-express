/**
 * Pequi Express — Portal de Boletim Escolar
 * Integrado ao GO ID (SSO) · Sessão com expiração automática
 */

const GOID_SSO_KEY = "goid_sso";
const PEQUI_SESSION_KEY = "pequi_session";
const SSO_MAX_AGE_MS = 3 * 60 * 1000;       // token de retorno do GO ID: 3 min
const SESSION_MAX_MS = 20 * 60 * 1000;      // sessão ativa no Pequi: 20 min
const SESSION_IDLE_MS = 10 * 60 * 1000;     // inatividade: 10 min
let sessionTimer = null;
let idleTimer = null;
let lastActivity = Date.now();

let alunoAtual = null;
let documentoAtual = null;
let ultimoDocMeta = null; // { tipo, nome, codigo, arquivo }

function mostrarCarregando(msg) {
  const el = document.getElementById("loadingOverlay");
  if (!el) return;
  const m = document.getElementById("loadingMsg");
  if (m) m.textContent = msg || "Aguarde...";
  el.classList.remove("hidden");
  document.body.classList.add("sys-busy");
}
function ocultarCarregando() {
  const el = document.getElementById("loadingOverlay");
  if (!el) return;
  el.classList.add("hidden");
  document.body.classList.remove("sys-busy");
}

document.addEventListener("DOMContentLoaded", () => {
  try {
    const h = (location.hash || "").replace(/^#/, "");
    if (h.startsWith("validar=")) {
      const cod = decodeURIComponent(h.slice(8));
      setTimeout(() => {
        const el = document.getElementById("validarCodigo");
        if (el) { el.value = cod; if (typeof validarDocumentoPublico === "function") validarDocumentoPublico(); }
        document.getElementById("validarSection")?.scrollIntoView({ behavior: "smooth" });
      }, 700);
    }
  } catch (e) {}
  setTimeout(() => {
    ocultarCarregando();
  }, 900);

  const savedTheme = localStorage.getItem("pequi-theme");
  if (savedTheme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  }
  document.getElementById("themeToggle").addEventListener("click", toggleTheme);

  document.querySelectorAll(".nav-link").forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const section = link.dataset.section;
      if (section === "home") {
        showSection(alunoAtual ? "dashboard" : "home");
      } else {
        showSection(section);
      }
      document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
      link.classList.add("active");
    });
  });

  // Login via GO ID (SSO)
  iniciarSessaoSegura();
  tentarEntrarComGoId();
  document.addEventListener("click", registrarAtividade);
  document.addEventListener("keydown", registrarAtividade);
  document.addEventListener("mousemove", throttle(registrarAtividade, 5000));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") verificarSessao();
  });

  // Animações de entrada
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = "1";
        entry.target.style.transform = "translateY(0)";
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll("[data-animate]").forEach(el => {
    el.style.opacity = "0";
    el.style.transform = "translateY(20px)";
    el.style.transition = "all 0.5s ease";
    observer.observe(el);
  });
});

function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute("data-theme") === "dark";
  if (isDark) {
    html.removeAttribute("data-theme");
    localStorage.setItem("pequi-theme", "light");
  } else {
    html.setAttribute("data-theme", "dark");
    localStorage.setItem("pequi-theme", "dark");
  }
}

function showSection(id) {
  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
  const el = document.getElementById("section-" + id);
  if (el) el.classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function goHome() {
  if (alunoAtual) {
    showSection("dashboard");
  } else {
    showSection("home");
  }
  document.querySelectorAll(".nav-link").forEach(l => {
    l.classList.toggle("active", l.dataset.section === "home");
  });
}

// ===== GO ID SSO + segurança de sessão =====
function throttle(fn, ms) {
  let last = 0;
  return function (...args) {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn.apply(this, args); }
  };
}

function registrarAtividade() {
  lastActivity = Date.now();
  if (alunoAtual) reiniciarIdleTimer();
}

function limparSessaoPequi() {
  localStorage.removeItem(PEQUI_SESSION_KEY);
  sessionStorage.removeItem(GOID_SSO_KEY);
  localStorage.removeItem(GOID_SSO_KEY);
  // Logout completo do ecossistema: também encerra GO ID para não "entrar sozinho"
  localStorage.removeItem("goid_session");
  localStorage.setItem("goid_logged_out_at", String(Date.now()));
}

function salvarSessaoPequi(aluno, sso) {
  // Novo acesso válido: remove flag de logout explícito
  localStorage.removeItem("goid_logged_out_at");
  const payload = {
    aluno,
    goId: sso?.goId || null,
    cpf: sso?.cpf || null,
    startedAt: Date.now(),
    lastActivity: Date.now(),
    exp: Date.now() + SESSION_MAX_MS
  };
  localStorage.setItem(PEQUI_SESSION_KEY, JSON.stringify(payload));
}

function lerSessaoPequi() {
  try {
    // Se o usuário saiu explicitamente (GO ID ou Pequi), não restaura
    if (localStorage.getItem("goid_logged_out_at")) {
      localStorage.removeItem(PEQUI_SESSION_KEY);
      return null;
    }
    const raw = localStorage.getItem(PEQUI_SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !data.exp || Date.now() > data.exp) {
      localStorage.removeItem(PEQUI_SESSION_KEY);
      return null;
    }
    return data;
  } catch {
    localStorage.removeItem(PEQUI_SESSION_KEY);
    return null;
  }
}

function renovarSessaoPequi() {
  if (!alunoAtual) return;
  try {
    const raw = localStorage.getItem(PEQUI_SESSION_KEY);
    const data = raw ? JSON.parse(raw) : {};
    data.aluno = alunoAtual;
    data.lastActivity = Date.now();
    data.exp = Date.now() + SESSION_MAX_MS;
    data.startedAt = data.startedAt || Date.now();
    localStorage.setItem(PEQUI_SESSION_KEY, JSON.stringify(data));
    localStorage.removeItem("goid_logged_out_at");
    lastActivity = Date.now();
  } catch {}
}

function iniciarSessaoSegura() {
  clearInterval(sessionTimer);
  sessionTimer = setInterval(verificarSessao, 15000);
  reiniciarIdleTimer();
}

function reiniciarIdleTimer() {
  clearTimeout(idleTimer);
  if (!alunoAtual) return;
  idleTimer = setTimeout(() => {
    showToast("Sessão encerrada por inatividade.");
    logout(true);
  }, SESSION_IDLE_MS);
}

function verificarSessao() {
  if (!alunoAtual) return false;
  const sess = lerSessaoPequi();
  if (!sess) {
    showToast("Sessão expirada. Entre novamente com o GO ID.");
    logout(true);
    return false;
  }
  if (Date.now() - lastActivity > SESSION_IDLE_MS) {
    showToast("Sessão encerrada por inatividade.");
    logout(true);
    return false;
  }
  return true;
}

function lerSsoGoId() {
  // prioriza sessionStorage (aba atual), depois localStorage
  for (const store of [sessionStorage, localStorage]) {
    try {
      const raw = store.getItem(GOID_SSO_KEY);
      if (!raw) continue;
      const data = JSON.parse(raw);
      if (!data || !data.timestamp) continue;
      // token de retorno deve ser recente
      if (Date.now() - data.timestamp > SSO_MAX_AGE_MS) {
        store.removeItem(GOID_SSO_KEY);
        continue;
      }
      // integridade mínima
      if (!data.goId || !data.cpf) {
        store.removeItem(GOID_SSO_KEY);
        continue;
      }
      return data;
    } catch {
      store.removeItem(GOID_SSO_KEY);
    }
  }
  return null;
}

function consumirSsoGoId() {
  const data = lerSsoGoId();
  sessionStorage.removeItem(GOID_SSO_KEY);
  // localStorage: remove após uso para não reutilizar token antigo
  localStorage.removeItem(GOID_SSO_KEY);
  return data;
}

function irParaGoId() {
  const returnUrl = encodeURIComponent(window.location.href.split("#")[0]);
  window.location.href = `goid.html?return=pequi&ts=${Date.now()}`;
}

async function montarAlunoDoSigep(matricula, dataNasc) {
  const registros = await dbGet("siap/alunos");
  const par = Object.entries(registros || {}).find(([id, a]) =>
    a && String(a.matricula || "").trim() === String(matricula).trim() &&
    (!dataNasc || normalizarDataISO(a.dataNascimento) === normalizarDataISO(dataNasc))
  );
  // se não achar com data, tenta só matrícula
  let found = par;
  if (!found && matricula) {
    found = Object.entries(registros || {}).find(([id, a]) =>
      a && String(a.matricula || "").trim() === String(matricula).trim()
    );
  }
  if (!found) return null;
  const [id, raw] = found;
  const turmaId = raw.turma || raw.turmaId || "";
  const [turmas, cfg] = await Promise.all([
    dbGet("siap/turmas").catch(() => ({})),
    dbGet("siap/config").catch(() => ({}))
  ]);
  const turma = turmas?.[turmaId] || {};
  const nomeEscola = (cfg && (cfg.nomeEscola || cfg.escola)) ||
    raw.escolaNome || raw.escola || "Unidade escolar";
  const mun = (cfg && cfg.municipio) || raw.municipio || "—";
  const cod = (cfg && cfg.codigoEscola) || raw.inep || raw.codigoEscola || "—";
  return {
    ...raw, id, matricula: raw.matricula || id,
    turmaId,
    turma: (function () {
      const n = normalizarTurmaLida(turma);
      return n.nome || raw.turmaNome || turmaId || "—";
    })(),
    turno: raw.turno || turma.turno || "—",
    serie: (function () {
      const n = normalizarTurmaLida(turma);
      return n.serie || raw.serie || "—";
    })(),
    composicao: (function () {
      const n = normalizarTurmaLida(turma);
      return n.composicao || raw.composicao || "—";
    })(),
    anoLetivo: raw.ano || raw.anoLetivo || (cfg && cfg.anoLetivo) || ANO_LETIVO,
    escola: nomeEscola,
    inep: cod, municipio: mun, uf: (cfg && cfg.uf) || "GO",
    situacao: raw.status || raw.situacao || "Matriculado",
    dataNascimento: raw.dataNascimento || dataNasc || "",
    disciplinas: [],
    frequenciaGeral: raw.frequenciaGeral ?? null,
    totalAulas: raw.totalAulas ?? null,
    totalFaltas: raw.totalFaltas ?? null
  };
}

async function tentarEntrarComGoId() {
  const params = new URLSearchParams(window.location.search);
  const veioDoGoId = params.get("sso") === "1";

  // Limpa query da URL sem recarregar (evita reprocessar no F5)
  if (veioDoGoId && window.history.replaceState) {
    const clean = window.location.pathname + window.location.hash;
    window.history.replaceState({}, "", clean);
  }

  // 1) sessão Pequi ainda válida
  const sess = lerSessaoPequi();
  if (sess && sess.aluno) {
    alunoAtual = sess.aluno;
    lastActivity = Date.now();
    entrarDashboard(alunoAtual);
    if (veioDoGoId) showToast("Sessão ativa.");
    return;
  }

  // 2) token SSO — só processa se veio do retorno do GO ID (?sso=1)
  //    Tokens antigos no storage são descartados em silêncio
  const sso = veioDoGoId ? consumirSsoGoId() : null;
  if (!veioDoGoId) {
    // Limpa lixo antigo sem avisar o usuário
    sessionStorage.removeItem(GOID_SSO_KEY);
    try {
      const raw = localStorage.getItem(GOID_SSO_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (!data?.timestamp || Date.now() - data.timestamp > SSO_MAX_AGE_MS) {
          localStorage.removeItem(GOID_SSO_KEY);
        }
      }
    } catch { localStorage.removeItem(GOID_SSO_KEY); }
    return;
  }

  if (!sso) {
    const errorEl = document.getElementById("loginError");
    const msg = "Login GO ID expirado ou incompleto. Clique em Entrar com GO ID novamente.";
    if (errorEl) { errorEl.textContent = msg; errorEl.classList.remove("hidden"); }
    showToast(msg);
    return;
  }

  const errorEl = document.getElementById("loginError");
  try {
    mostrarCarregando("Validando GO ID e carregando boletim...");
    if (!sso.matricula) {
      ocultarCarregando();
      const msg = "Sua conta GO ID não tem matrícula vinculada. Vamos abrir o perfil para você informar.";
      if (errorEl) { errorEl.textContent = msg; errorEl.classList.remove("hidden"); }
      showToast(msg);
      setTimeout(() => {
        window.location.href = "goid.html?return=pequi&action=perfil";
      }, 1800);
      return;
    }
    const aluno = await montarAlunoDoSigep(sso.matricula, sso.dataNascimento);
    if (!aluno) {
      throw new Error("Matrícula do GO ID não encontrada na Educação. Confira a matrícula no perfil do GO ID.");
    }
    alunoAtual = aluno;
    salvarSessaoPequi(aluno, sso);
    lastActivity = Date.now();
    reiniciarIdleTimer();
    ocultarCarregando();
    entrarDashboard(aluno);
    showToast(`Bem-vindo(a), ${aluno.nome.split(" ")[0]}! Acesso via GO ID.`);
  } catch (err) {
    ocultarCarregando();
    console.error(err);
    if (errorEl) {
      errorEl.textContent = err.message || "Falha na autenticação GO ID.";
      errorEl.classList.remove("hidden");
    }
    showToast(err.message || "Falha na autenticação GO ID.");
  }
}

// legado: mantido nome para compatibilidade interna
async function handleLogin() {
  irParaGoId();
}

function entrarDashboard(aluno) {
  document.getElementById("userBadge").classList.remove("hidden");
  document.getElementById("userNameShort").textContent = aluno.nome.split(" ")[0];

  document.getElementById("alunoNome").textContent = aluno.nome.split(" ")[0];
  document.getElementById("alunoInfo").textContent =
    `Matrícula ${aluno.matricula} · ${aluno.escola} · ${aluno.serie}`;
  document.getElementById("situacaoAluno").textContent = aluno.situacao;
  document.getElementById("turmaAluno").textContent = aluno.turma;
  document.getElementById("turnoAluno").textContent = aluno.turno;
  document.getElementById("anoLetivo").textContent = aluno.anoLetivo;

  const grid = document.getElementById("docsGrid");
  const icons = {
    boletim: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
    "declaracao-matricula": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15l2 2 4-4"/></svg>`,
    "frequencia-anual": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    "boletim": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
    calendario: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    "claria-ajuda": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`
  };
  grid.innerHTML = DOCUMENTOS.map(doc => {
    const icon = icons[doc.id] || icons.boletim;
    const acao = doc.acao || "Abrir →";
    return `
    <div class="doc-card" onclick="abrirDocumento('${doc.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();abrirDocumento('${doc.id}')}" role="button" tabindex="0" aria-label="${doc.titulo}">
      <div class="doc-icon" style="background: ${doc.cor}18; color: ${doc.cor}">${icon}</div>
      <div class="doc-card-body">
        <h3>${doc.titulo}</h3>
        <p>${doc.descricao}</p>
      </div>
      <span class="doc-action">${acao}</span>
    </div>`;
  }).join("");

  showSection("dashboard");
  showToast(`Bem-vindo(a), ${aluno.nome.split(" ")[0]}!`);
}

function logout(silencioso) {
  alunoAtual = null;
  limparSessaoPequi();
  clearTimeout(idleTimer);
  clearInterval(sessionTimer);
  sessionTimer = null;
  idleTimer = null;
  const badge = document.getElementById("userBadge");
  if (badge) badge.classList.add("hidden");
  showSection("home");
  document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
  const homeLink = document.querySelector('.nav-link[data-section="home"]');
  if (homeLink) homeLink.classList.add("active");
  // Limpa query SSO residual
  if (window.history.replaceState) {
    window.history.replaceState({}, "", window.location.pathname + window.location.hash);
  }
  if (!silencioso) showToast("Você saiu do portal. Entre novamente com o GO ID.");
}

// ===== Documentos =====
async function abrirDocumento(id) {
  // Garante aluno na memória (restaura da sessão se necessário)
  if (!alunoAtual) {
    const sess = lerSessaoPequi();
    if (sess && sess.aluno) {
      alunoAtual = sess.aluno;
      lastActivity = Date.now();
    }
  }
  if (!alunoAtual) {
    showToast("Entre com o GO ID para acessar os serviços");
    irParaGoId();
    return;
  }
  if (!verificarSessao()) {
    // tenta renovar se ainda há aluno em memória
    if (alunoAtual) {
      renovarSessaoPequi();
    } else {
      return;
    }
  } else {
    renovarSessaoPequi();
  }

  // Assistente ClarIA — abre o widget em vez do modal
  if (id === "claria-ajuda") {
    if (window.ClarIA && typeof ClarIA.open === "function") {
      ClarIA.open();
      showToast("ClarIA pronta para ajudar");
    } else {
      showToast("ClarIA indisponível no momento");
    }
    return;
  }

  documentoAtual = id;
  const doc = DOCUMENTOS.find(d => d.id === id);
  const modalTitle = document.getElementById("modalTitle");
  const modalBody = document.getElementById("modalBody");
  const modal = document.getElementById("docModal");
  if (modalTitle) modalTitle.textContent = doc?.titulo || "Documento escolar";
  if (modalBody) modalBody.innerHTML = '<p class="document-loading">Preparando documento…</p>';
  if (modal) modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";

  try {
    // Snapshot local para não depender de alunoAtual se a sessão limpar no meio
    const alunoSnap = { ...alunoAtual };
    if (id === "boletim" || id === "frequencia-anual") {
      mostrarCarregando("Consultando dados escolares...");
      try {
        if (!alunoSnap.disciplinas || !alunoSnap.disciplinas.length) {
          alunoSnap.disciplinas = await buscarBoletim(alunoSnap);
          // sincroniza de volta se ainda logado
          if (alunoAtual) {
            alunoAtual.disciplinas = alunoSnap.disciplinas;
            alunoAtual._turma = alunoSnap._turma || alunoAtual._turma;
          }
        }
      } catch (boletimErr) {
        // Declaração ainda pode ser emitida; boletim/freq/resumo precisam de dados
        if (id !== "declaracao-matricula") {
          throw boletimErr;
        }
      } finally {
        ocultarCarregando();
      }
    }
    // Garante referência usada na geração
    const prev = alunoAtual;
    alunoAtual = alunoSnap;
    try {
      if (modalBody) modalBody.innerHTML = gerarConteudoDocumento(id);
    } finally {
      // mantém alunoSnap se prev foi limpo
      if (!alunoAtual && prev) alunoAtual = prev;
      else if (alunoSnap && alunoSnap.matricula) alunoAtual = { ...(alunoAtual || {}), ...alunoSnap };
    }
  } catch (err) {
    ocultarCarregando();
    console.error("[Pequi] emitir documento:", err);
    if (modalBody) {
      modalBody.innerHTML =
        `<div class="data-error"><h3>Não foi possível emitir o documento</h3><p>${escapeHTML(err.message || "Falha na consulta ao sistema.")}</p><p>Se a sessão expirou, entre novamente com o GO ID. Caso o erro persista, confira a matrícula e a conexão.</p></div>`;
    }
  }
}
function normalizarDataISO(value){const s=String(value||"").trim();if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);const m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);return m?`${m[3]}-${m[2]}-${m[1]}`:s};
function escapeHTML(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
async function buscarBoletim(aluno) {
  const [turmas, disciplinas, vinculos] = await Promise.all([
    dbGet("siap/turmas"),
    dbGet("siap/disciplinas"),
    dbGet("siap/vinculos")
  ]);

  const turmaId = String(aluno.turmaId || aluno.turma || "").trim();
  if (!turmaId) throw new Error("Turma do aluno não identificada. Verifique o cadastro na escola.");

  const ids = new Set();
  Object.values(vinculos || {}).forEach(v => {
    if (v && String(v.turmaId) === turmaId && v.disciplinaId) ids.add(v.disciplinaId);
  });

  const turma = turmas?.[turmaId] || {};
  if (Array.isArray(turma.disciplinas)) {
    turma.disciplinas.forEach(id => ids.add(id));
  }

  // Fallback: se vinculos vazios, tenta listar o que existe em arquivos_anuais
  if (!ids.size) {
    try {
      const arqDisc = await dbGet(`siap/arquivos_anuais/${ANO_LETIVO}/turmas/${encodeURIComponent(turmaId)}/disciplinas`);
      if (arqDisc && typeof arqDisc === "object") {
        Object.keys(arqDisc).forEach(slug => {
          // tenta achar a disciplina pelo id "limpo"
          const found = Object.entries(disciplinas || {}).find(([id]) => {
            const s = String(id).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "");
            return s === slug;
          });
          if (found) ids.add(found[0]);
          else ids.add(slug); // usa o próprio slug como fallback
        });
      }
    } catch (_) { /* ignora */ }
  }

  let list = [...ids]
    .map(id => {
      if (disciplinas?.[id]) return disciplinas[id];
      // fallback quando só temos o slug
      return { id, nome: id };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));

  // remove duplicatas por nome
  const seen = new Set();
  list = list.filter(d => {
    const key = String(d.nome || d.id).toUpperCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (!list.length) {
    throw new Error("Não há disciplinas registradas para a turma deste aluno no ano letivo " + ANO_LETIVO + ".");
  }

  const alunoId = aluno.id;
  const rows = [];

  for (const disc of list) {
    const row = {
      nome: disc.nome || disc.id,
      b1: null, b2: null, b3: null, b4: null,
      f1: null, f2: null, f3: null, f4: null,
      ma: null, mf: null, faltas: 0
    };

    const slug = String(disc.id || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, "")
      .replace(/[^a-zA-Z0-9]/g, "");

    for (const bim of ["1", "2", "3", "4"]) {
      const path = `siap/arquivos_anuais/${ANO_LETIVO}/turmas/${encodeURIComponent(turmaId)}/disciplinas/${slug}/bimestre_${bim}/diario`;
      let data = null;
      try {
        data = await dbGet(path);
      } catch (_) {
        // Bimestre ainda não lançado — continua sem interromper o boletim
        continue;
      }
      const rec = data?.alunos?.[alunoId];
      if (rec) {
        row["b" + bim] = rec.media_final ?? rec.media_bimestral ?? null;
        row["f" + bim] = rec.faltas ?? 0;
        row.faltas += Number(rec.faltas || 0);
      }
    }

    // Inclui a disciplina mesmo sem notas (mostra "—" nas células)
    const temNota = ["b1", "b2", "b3", "b4"].some(k => row[k] != null);
    if (temNota) {
      const vals = ["b1", "b2", "b3", "b4"].map(k => row[k]).filter(v => v != null);
      row.ma = vals.reduce((s, v) => s + Number(v), 0) / vals.length;
      row.mf = row.ma;
    }
    rows.push(row);
  }

  aluno._turma = normalizarTurmaLida(turma);
  aluno.totalFaltas = rows.reduce((s, r) => s + r.faltas, 0);
  return rows;
}

function closeModal() {
  document.getElementById("docModal").classList.add("hidden");
  document.body.style.overflow = "";
  documentoAtual = null;
}

/* ========== Autenticação de documentos ========== */
function salvarValidacaoDoc(registro) {
  try {
    const key = "pequi_docs_auth";
    const map = JSON.parse(localStorage.getItem(key) || "{}");
    map[registro.codigo] = registro;
    localStorage.setItem(key, JSON.stringify(map));
  } catch {}
  try {
    if (typeof firebase !== "undefined" && firebase.apps && firebase.apps.length) {
      firebase.database().ref("pequi/validacoes/" + registro.codigo).set(registro);
    }
  } catch {}
}

function buscarValidacaoDoc(codigo) {
  const cod = String(codigo || "").trim().toUpperCase();
  if (!cod) return null;
  try {
    const map = JSON.parse(localStorage.getItem("pequi_docs_auth") || "{}");
    if (map[cod]) return map[cod];
  } catch {}
  return null;
}

function normalizarCodigoValidacao(raw) {
  let s = String(raw || "").trim().toUpperCase();
  // QR pode vir como PEQUI|PE-XXXX|...
  if (s.includes("|")) {
    const parts = s.split("|");
    const pe = parts.find(p => p.startsWith("PE-"));
    if (pe) return pe;
  }
  const m = s.match(/PE-[A-Z0-9]{6}/);
  if (m) return m[0];
  if (s.startsWith("PE-")) return s;
  return s;
}

async function validarDocumentoPublico(codigoForcado) {
  const input = document.getElementById("validarCodigo");
  const out = document.getElementById("validarResultado");
  if (!out) return;
  const codigo = normalizarCodigoValidacao(codigoForcado || input?.value || "");
  if (input && codigoForcado) input.value = codigo;
  out.classList.remove("hidden", "ok", "erro");
  if (!codigo) {
    out.classList.add("erro");
    out.innerHTML = "Informe o código de autenticação (ex.: PE-AB12CD) ou leia o QR Code.";
    return;
  }
  out.innerHTML = "Consultando…";
  let reg = buscarValidacaoDoc(codigo);
  if (!reg) {
    try {
      if (typeof firebase !== "undefined" && firebase.apps && firebase.apps.length) {
        const snap = await firebase.database().ref("pequi/validacoes/" + codigo).once("value");
        reg = snap.val();
      }
    } catch {}
  }
  if (!reg) {
    out.classList.add("erro");
    out.innerHTML = "<strong>Documento não encontrado.</strong> Verifique o código ou se a emissão foi feita neste portal.";
    return;
  }
  out.classList.add("ok");
  out.innerHTML = `
    <strong>✓ Documento autêntico</strong><br>
    Tipo: ${escapeHTML(reg.tipo || "—")}<br>
    Aluno(a): ${escapeHTML(reg.nome || "—")}<br>
    Matrícula: ${escapeHTML(reg.matricula || "—")}<br>
    Emitido em: ${escapeHTML(reg.emitidoEm || "—")}<br>
    Código: <code>${escapeHTML(reg.codigo)}</code>`;
}

/* ----- Scanner QR (câmera) ----- */
let qrStream = null;
let qrScanTimer = null;

async function abrirScannerQR() {
  const box = document.getElementById("qrScannerBox");
  const video = document.getElementById("qrVideo");
  if (!box || !video) return;
  box.classList.remove("hidden");
  try {
    qrStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });
    video.srcObject = qrStream;
    await video.play();
    if ("BarcodeDetector" in window) {
      const detector = new BarcodeDetector({ formats: ["qr_code"] });
      const tick = async () => {
        if (!qrStream) return;
        try {
          const codes = await detector.detect(video);
          if (codes && codes[0] && codes[0].rawValue) {
            const cod = normalizarCodigoValidacao(codes[0].rawValue);
            fecharScannerQR();
            const input = document.getElementById("validarCodigo");
            if (input) input.value = cod;
            validarDocumentoPublico(cod);
            showToast("QR lido: " + cod);
            return;
          }
        } catch {}
        qrScanTimer = setTimeout(tick, 400);
      };
      tick();
    } else {
      showToast("Seu navegador não lê QR pela câmera. Digite o código manualmente.");
    }
  } catch (err) {
    console.warn(err);
    showToast("Não foi possível acessar a câmera. Digite o código.");
    fecharScannerQR();
  }
}

function fecharScannerQR() {
  if (qrScanTimer) clearTimeout(qrScanTimer);
  qrScanTimer = null;
  if (qrStream) {
    qrStream.getTracks().forEach(t => t.stop());
    qrStream = null;
  }
  const video = document.getElementById("qrVideo");
  if (video) video.srcObject = null;
  document.getElementById("qrScannerBox")?.classList.add("hidden");
}

function dataPorExtenso(date) {
  const d = date || new Date();
  const s = d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function blocoAutenticidade(codigo, qrSrc, localidade) {
  return `
    <div class="decl-auth">
      <div class="decl-auth-txt">
        <p><strong>Autenticação:</strong> código <strong>${escapeHTML(codigo)}</strong> · valide no Pequi Express ou pelo QR Code.</p>
        <p>${escapeHTML(localidade || "Goiás")} · emissão digital · sem rasuras</p>
      </div>
      <img class="decl-qr" src="${qrSrc}" alt="QR ${escapeHTML(codigo)}" width="78" height="78" />
    </div>`;
}

/** Evita repetir o mesmo texto em turma e série (erro comum no cadastro SIGEP). */

function normalizarTurmaLida(turma) {
  const t = Object.assign({}, turma || {});
  let nome = String(t.nome || "").trim().replace(/\s+/g, " ");
  let serie = String(t.serie || "").trim().replace(/\s+/g, " ");
  let composicao = String(t.composicao || "").trim();
  if (nome && serie && nome.toUpperCase() === serie.toUpperCase()) {
    const m = nome.match(/^(\d+\s*[ªº°]?)\s*[\"“”']?\s*([A-Za-z0-9])?\s*[\"“”']?\s*[-—,]?\s*(.*)$/i);
    if (m) {
      serie = m[1].replace(/\s+/g, "");
      if (!/[ªº°]$/.test(serie)) serie += "ª";
      const letra = m[2] ? m[2].toUpperCase() : "";
      nome = letra ? (serie + " " + letra) : serie;
      const resto = (m[3] || "").replace(/^[-\s—]+/, "").trim();
      if (resto && (!composicao || composicao === "Ensino Médio")) {
        composicao = resto.replace(/\s+/g, " ");
      }
    }
  }
  return { nome, serie, composicao, turno: t.turno, id: t.id, disciplinas: t.disciplinas };
}

function rotulosTurmaSerie(a, t) {
  t = t || {};
  let turma = String(t.nome || a.turma || "").trim();
  let serie = String(t.serie || a.serie || "").trim();
  if (turma && serie && turma.toUpperCase() === serie.toUpperCase()) {
    // tenta extrair série curta e turma
    const m = turma.match(/^(\d+\s*[ªº°]?)\s*[\"“”']?\s*([A-Za-z0-9])?/i);
    if (m) {
      serie = m[1].replace(/\s+/g, "");
      if (!/[ªº°]$/.test(serie)) serie += "ª";
      turma = m[2] ? (serie + " " + m[2].toUpperCase()) : serie;
    } else {
      serie = ""; // não repetir
    }
  }
  return { turma: turma || "—", serie: serie || "—" };
}

function gerarConteudoDocumento(id) {
  const a = alunoAtual;
  if (!a || typeof a !== "object") {
    throw new Error("Sessão do aluno não encontrada. Entre novamente com o GO ID.");
  }
  const dataEmissao = formatarDataHoje();
  const codigo = (typeof gerarCodigoAutenticacao === "function")
    ? gerarCodigoAutenticacao()
    : ("PE-" + Date.now().toString(36).toUpperCase());
  const t = (a._turma && typeof a._turma === "object") ? a._turma : {};
  const rs = rotulosTurmaSerie(a, t);
  const escolaNome = (a.escola && a.escola !== "Unidade escolar")
    ? a.escola
    : (a.escolaNome || "Unidade escolar da rede estadual");
  const makeQr = (typeof qrUrl === "function") ? qrUrl : (d =>
    "https://api.qrserver.com/v1/create-qr-code/?size=120x120&margin=2&data=" + encodeURIComponent(d));

  const tituloMap = {
    boletim: "BOLETIM ESCOLAR",
    "declaracao-matricula": "COMPROVANTE DE MATRÍCULA",
    "frequencia-anual": "FREQUÊNCIA ANUAL"
  };
  const titulo = tituloMap[id] || "DOCUMENTO ESCOLAR";

  salvarValidacaoDoc({
    codigo,
    tipo: titulo,
    nome: a.nome || "",
    matricula: String(a.matricula || ""),
    emitidoEm: dataEmissao,
    anoLetivo: a.anoLetivo || ANO_LETIVO,
    escola: escolaNome
  });

  // Nome do arquivo para impressão/PDF: tipo-nome-codigo
  const slug = (s) => String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  const tipoSlug = {
    boletim: "boletim-escolar",
    "declaracao-matricula": "comprovante-matricula",
    "frequencia-anual": "frequencia-anual"
  }[id] || slug(titulo);
  ultimoDocMeta = {
    tipo: titulo,
    nome: a.nome || "aluno",
    codigo,
    arquivo: [tipoSlug, slug(a.nome || "aluno"), codigo].filter(Boolean).join("-")
  };

  const qrData = "PEQUI|" + codigo + "|" + (a.matricula || "") + "|" + dataEmissao;
  const qrSrc = makeQr(qrData);
  const cpfFmt = (typeof formatarCPF === "function") ? formatarCPF(a.cpf) : (a.cpf || "—");
  const cel = (v) => (v == null || v === "" ? "—" : (typeof v === "number" ? Number(v).toFixed(1).replace(".", ",") : String(v)));

  // ===== BOLETIM (modelo oficial SEDUC) =====
  if (id === "boletim") {
    const discs = a.disciplinas || [];
    const rows = discs.map(d => `<tr>
      <td class="col-disc">${escapeHTML(d.nome)}</td>
      <td>${cel(d.b1)}</td><td>${d.f1 != null && Number(d.f1) !== 0 ? d.f1 : "—"}</td>
      <td>${cel(d.b2)}</td><td>${d.f2 != null && Number(d.f2) !== 0 ? d.f2 : "—"}</td>
      <td>${cel(d.b3)}</td><td>${d.f3 != null && Number(d.f3) !== 0 ? d.f3 : "—"}</td>
      <td>${cel(d.b4)}</td><td>${d.f4 != null && Number(d.f4) !== 0 ? d.f4 : "—"}</td>
      <td>${cel(d.ma)}</td>
      <td>${cel(d.mf)}</td>
      <td>${d.faltas != null ? d.faltas : "—"}</td>
    </tr>`).join("");
    const totalFaltas = discs.reduce((s, d) => s + Number(d.faltas || 0), 0);
    let freq = "—";
    if (a.frequenciaGeral != null && a.frequenciaGeral !== "") freq = a.frequenciaGeral + "%";
    else if (discs.length) freq = Math.max(0, Math.round(100 - (totalFaltas / Math.max(discs.length * 20, 1)) * 100)) + "%";

    return `<div class="doc-print bol-oficial" id="docPrintArea">
      <div class="bol-top">
        <div class="bol-top-left">
          <img src="brasao-goias.svg" alt="" class="bol-logo" onerror="this.style.display='none'" />
          <div>
            <div class="bol-estado">ESTADO DE GOIÁS</div>
            <div class="bol-seduc">SECRETARIA DE ESTADO DA EDUCAÇÃO</div>
            <div class="bol-escola">${escapeHTML(escolaNome)}</div>
          </div>
        </div>
        <div class="bol-top-right">
          <div class="bol-titulo-doc">BOLETIM ESCOLAR</div>
          <div class="bol-meta-doc">${escapeHTML(t.composicao || a.composicao || a.serie || "Ensino Médio")}</div>
          <div class="bol-meta-doc">ANO: ${escapeHTML(String(a.anoLetivo || ANO_LETIVO))}</div>
        </div>
        <div class="bol-qr-box">
          <img src="${qrSrc}" alt="QR ${escapeHTML(codigo)}" width="72" height="72" />
          <span>${escapeHTML(codigo)}</span>
        </div>
      </div>
      <div class="bol-info">
        <div><b>NOME DO ALUNO(A):</b> ${escapeHTML(a.nome)}</div>
        <div><b>SEXO:</b> ${escapeHTML(a.sexo || "—")}</div>
        <div><b>N. CHAM.:</b> ${escapeHTML(a.nCham ?? "—")}</div>
        <div><b>MATRÍCULA:</b> ${escapeHTML(a.matricula)}</div>
        <div><b>CPF:</b> ${escapeHTML(cpfFmt)}</div>
        <div><b>CÓD. INEP:</b> ${escapeHTML(a.inep || "—")}</div>
        <div><b>EMISSÃO:</b> ${dataEmissao}</div>
        <div><b>TURNO:</b> ${escapeHTML(a.turno || t.turno || "—")}</div>
        <div><b>TURMA:</b> ${escapeHTML(rs.turma)}</div>
        <div><b>SÉRIE:</b> ${escapeHTML(rs.serie)}</div>
      </div>
      <table class="bol-grid">
        <thead>
          <tr>
            <th rowspan="2" class="col-disc">COMPONENTES CURRICULARES</th>
            <th colspan="2">1º BIM.</th>
            <th colspan="2">2º BIM.</th>
            <th colspan="2">3º BIM.</th>
            <th colspan="2">4º BIM.</th>
            <th rowspan="2">MA</th>
            <th rowspan="2">MÉDIA FINAL</th>
            <th rowspan="2">FALTAS</th>
          </tr>
          <tr>
            <th>N</th><th>F</th><th>N</th><th>F</th><th>N</th><th>F</th><th>N</th><th>F</th>
          </tr>
        </thead>
        <tbody>${rows || "<tr><td colspan='12'>Sem lançamentos no período.</td></tr>"}</tbody>
      </table>
      <div class="bol-foot">
        <div><span>% Frequência</span><strong>${freq}</strong></div>
        <div><span>Total de Faltas</span><strong>${totalFaltas || 0}</strong></div>
        <div><span>Faltas Justificadas</span><strong>—</strong></div>
        <div><span>Resultado Final</span><strong>${escapeHTML(a.situacao || "Cursando")}</strong></div>
      </div>
      ${blocoAutenticidade(codigo, qrSrc, (a.municipio && a.municipio !== "—") ? a.municipio + " - GO" : "Goiás")}
    </div>`;
  }

  const local = (a.municipio && a.municipio !== "—") ? a.municipio + " - GO" : "Goiás";
  const extenso = dataPorExtenso(new Date());
  const nasc = (typeof formatarData === "function") ? formatarData(a.dataNascimento) : (a.dataNascimento || "—");
  const filiacao = [a.nomeMae, a.nomePai].filter(Boolean).join(" e ") || "—";

  // ===== COMPROVANTE DE MATRÍCULA =====
  if (id === "declaracao-matricula") {
    return `<div class="doc-print decl" id="docPrintArea">
      <header class="decl-head">
        <img src="brasao-goias.svg" alt="" class="decl-brasao" onerror="this.style.display='none'" />
        <p>ESTADO DE GOIÁS</p>
        <p>SECRETARIA DE ESTADO DA EDUCAÇÃO</p>
        <p class="decl-escola">${escapeHTML(escolaNome)}</p>
      </header>
      <h1 class="decl-titulo">COMPROVANTE DE MATRÍCULA</h1>
      <div class="decl-texto">
        <p>Declaramos, para os devidos fins, que o(a) aluno(a) <strong>${escapeHTML(a.nome)}</strong>${filiacao !== "—" ? ", filho(a) de <strong>" + escapeHTML(filiacao) + "</strong>" : ""}${nasc && nasc !== "—" ? ", nascido(a) em <strong>" + escapeHTML(nasc) + "</strong>" : ""}, matrícula nº <strong>${escapeHTML(a.matricula)}</strong>${a.cpf ? ", CPF <strong>" + escapeHTML(cpfFmt) + "</strong>" : ""}, está regularmente matriculado(a) nesta Unidade de Ensino, na turma <strong>${escapeHTML(rs.turma)}</strong>${rs.serie !== "—" && rs.serie.toUpperCase() !== rs.turma.toUpperCase() ? ", série <strong>" + escapeHTML(rs.serie) + "</strong>" : ""}, turno <strong>${escapeHTML(a.turno || t.turno || "—")}</strong>, ano letivo de <strong>${escapeHTML(String(a.anoLetivo || ANO_LETIVO))}</strong>, encontrando-se na situação <strong>${escapeHTML(a.situacao || "Matriculado")}</strong>.</p>
        <p>Por ser verdade, firmamos a presente declaração.</p>
        <p class="decl-local">Secretaria da <strong>${escapeHTML(escolaNome)}</strong>, em ${escapeHTML(local)}, ${escapeHTML(extenso)}.</p>
      </div>
      <div class="decl-sign">
        <div class="decl-linha"></div>
        <p>Secretaria da Unidade Escolar</p>
      </div>
      ${blocoAutenticidade(codigo, qrSrc, local)}
    </div>`;
  }

  // ===== DECLARAÇÃO DE FREQUÊNCIA =====
  if (id === "frequencia-anual") {
    const discs = a.disciplinas || [];
    const totalFaltas = discs.reduce((s, d) => s + Number(d.faltas || 0), 0);
    let freq = "—";
    if (a.frequenciaGeral != null && a.frequenciaGeral !== "") freq = String(a.frequenciaGeral).replace("%", "") + "%";
    else if (discs.length) freq = Math.max(0, Math.round(100 - (totalFaltas / Math.max(discs.length * 20, 1)) * 100)) + "%";

    return `<div class="doc-print decl" id="docPrintArea">
      <header class="decl-head">
        <img src="brasao-goias.svg" alt="" class="decl-brasao" onerror="this.style.display='none'" />
        <p>ESTADO DE GOIÁS</p>
        <p>SECRETARIA DE ESTADO DA EDUCAÇÃO</p>
        <p class="decl-escola">${escapeHTML(escolaNome)}</p>
      </header>
      <h1 class="decl-titulo">DECLARAÇÃO DE FREQUÊNCIA</h1>
      <div class="decl-texto">
        <p>Declaramos, para os devidos fins de direito, que o(a) aluno(a) <strong>${escapeHTML(a.nome)}</strong>${filiacao !== "—" ? ", filho(a) de <strong>" + escapeHTML(filiacao) + "</strong>" : ""}, matrícula nº <strong>${escapeHTML(a.matricula)}</strong>, está regularmente matriculado(a) nesta Unidade de Ensino, na turma <strong>${escapeHTML(rs.turma)}</strong>${rs.serie !== "—" && rs.serie.toUpperCase() !== rs.turma.toUpperCase() ? ", série <strong>" + escapeHTML(rs.serie) + "</strong>" : ""}, turno <strong>${escapeHTML(a.turno || t.turno || "—")}</strong>, com frequência de <strong>${freq}</strong> no ano letivo de <strong>${escapeHTML(String(a.anoLetivo || ANO_LETIVO))}</strong> (total de faltas registradas: <strong>${totalFaltas}</strong>).</p>
        <p>Por ser verdade, firmamos a presente declaração.</p>
        <p class="decl-local">Secretaria da <strong>${escapeHTML(escolaNome)}</strong>, em ${escapeHTML(local)}, ${escapeHTML(extenso)}.</p>
      </div>
      <div class="decl-sign">
        <div class="decl-linha"></div>
        <p>Secretaria da Unidade Escolar</p>
      </div>
      ${blocoAutenticidade(codigo, qrSrc, local)}
    </div>`;
  }

  return `<div class="doc-print" id="docPrintArea"><p>Documento indisponível.</p></div>`;
}

function printDocument() {
  const area = document.getElementById("docPrintArea");
  if (!area) return;
  const isBol = area.classList.contains("bol-oficial");
  const pageSize = isBol ? "A4 landscape" : "A4 portrait";
  const win = window.open("", "_blank");
  if (!win) {
    showToast("Permita pop-ups para imprimir ou salvar em PDF");
    return;
  }
  // Nome sugerido ao salvar PDF (o navegador usa o <title>)
  let nomeArquivo = "documento-pequi-express";
  if (ultimoDocMeta && ultimoDocMeta.arquivo) {
    nomeArquivo = ultimoDocMeta.arquivo;
  } else if (alunoAtual) {
    const slug = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 50);
    const tipo = (documentoAtual === "boletim") ? "boletim-escolar"
      : (documentoAtual === "declaracao-matricula") ? "comprovante-matricula"
      : (documentoAtual === "frequencia-anual") ? "frequencia-anual" : "documento";
    nomeArquivo = tipo + "-" + slug(alunoAtual.nome || "aluno");
  }
  // Fallback: tenta ler código do QR impresso na área
  if (!ultimoDocMeta) {
    const codEl = area.querySelector(".bol-qr-box span, .bol-auth-line strong");
    if (codEl && /PE-[A-Z0-9]+/i.test(codEl.textContent)) {
      nomeArquivo += "-" + codEl.textContent.trim().toUpperCase().match(/PE-[A-Z0-9]+/i)[0];
    }
  }

  win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/>
<title>${nomeArquivo}</title>
<style>
@page { size: ${pageSize}; margin: 8mm 10mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 10px;
.decl { font-family: "Times New Roman", Times, serif; color: #111; }
.decl-head { text-align: center; border-bottom: 1.5px solid #111; padding-bottom: 6px; }
.decl-brasao { height: 52px; }
.decl-head p { margin: 0; font-weight: 700; font-size: 11pt; text-transform: uppercase; }
.decl-escola { text-decoration: underline; }
.decl-titulo { text-align: center; font-size: 16pt; text-decoration: underline; margin: 22px 0 16px; letter-spacing: .04em; }
.decl-texto { font-size: 12pt; line-height: 1.5; text-align: justify; }
.decl-texto p { margin: 0 0 10px; text-indent: 1.8em; }
.decl-local { text-indent: 0; }
.decl-sign { text-align: center; width: 240px; margin: 28px auto 8px; }
.decl-linha { border-top: 1px solid #111; }
.decl-sign p { margin: 4px 0 0; font-size: 11pt; }
.decl-auth { display: flex; align-items: center; gap: 10px; border-top: 1px solid #111; margin-top: 16px; padding-top: 8px; font-family: Arial, sans-serif; }
.decl-selo { width: 64px; height: 64px; border-radius: 50%; border: 2px solid #14532d; color: #14532d; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; font-size: 7px; transform: rotate(-8deg); }
.decl-selo strong { font-size: 9px; }
.decl-auth-txt { flex: 1; font-size: 8.5pt; }
.decl-auth-txt p { margin: 0 0 3px; }
.decl-qr { width: 64px; height: 64px; }
 -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.bol-oficial, .doc-formal { width: 100%; }
.bol-top { display: flex; align-items: flex-start; gap: 10px; border-bottom: 2px solid #1a5f9e; padding-bottom: 6px; margin-bottom: 6px; }
.bol-top-left { display: flex; gap: 8px; align-items: center; flex: 1; }
.bol-logo { height: 42px; width: auto; }
.bol-estado { font-weight: 700; font-size: 11px; color: #0d3a66; }
.bol-seduc { font-size: 9px; color: #0d3a66; font-weight: 600; }
.bol-escola { font-size: 9px; color: #333; }
.bol-top-right { text-align: right; min-width: 140px; }
.bol-titulo-doc { font-weight: 700; font-size: 12px; color: #0d3a66; }
.bol-meta-doc { font-size: 9px; color: #444; }
.bol-qr-box { text-align: center; font-size: 8px; }
.bol-qr-box img { display: block; width: 64px; height: 64px; margin: 0 auto 2px; }
.bol-info { display: grid; grid-template-columns: repeat(5, 1fr); gap: 2px 8px; font-size: 9px; margin-bottom: 6px; }
.bol-info b { color: #333; }
.bol-grid { width: 100%; border-collapse: collapse; font-size: 8.5px; table-layout: fixed; }
.bol-grid th, .bol-grid td { border: 1px solid #333; padding: 2px 3px; text-align: center; }
.bol-grid th { background: #d6e4f0; font-weight: 700; }
.bol-grid .col-disc, .bol-grid td.col-disc { text-align: left; font-weight: 600; width: 22%; font-size: 8px; }
.bol-foot { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid #333; margin-top: 4px; font-size: 9px; }
.bol-foot div { border-right: 1px solid #333; padding: 4px 6px; text-align: center; }
.bol-foot div:last-child { border-right: none; }
.bol-foot span { display: block; font-size: 8px; color: #555; }
.bol-auth-line { margin: 4px 0 0; font-size: 8px; color: #444; text-align: right; }
.formal-body { font-size: 11px; line-height: 1.45; margin-top: 10px; }
.formal-meta { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 10px; }
.formal-meta td { border: 1px solid #ccc; padding: 6px 8px; }
.formal-meta-wide td { padding: 7px 10px; }
.freq-destaque { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 14px 0; }
.freq-destaque div { border: 1px solid #1a5f9e; border-radius: 6px; padding: 10px; text-align: center; }
.freq-destaque span { display: block; font-size: 9px; color: #555; }
.freq-destaque strong { font-size: 16px; color: #0d3a66; }
.formal-obs { font-size: 9px; color: #555; margin-top: 12px; border-left: 3px solid #1a9b65; padding-left: 8px; }
</style></head><body>${area.outerHTML}</body></html>`);
  win.document.close();
  setTimeout(() => { try { win.focus(); win.print(); } catch (e) {} }, 450);
  showToast("Documento pronto para impressão ou salvar em PDF");
}

function showAjuda() {
  showSection("ajuda");
  closeModal();
}


function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  toast.classList.add("show");
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.classList.add("hidden"), 300);
  }, 3200);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});
