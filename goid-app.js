/**
 * GO ID — Identidade Digital do Estado de Goiás
 * Estilo gov.br · Firebase Realtime Database
 */

const FIREBASE_URL = "https://goid-57028-default-rtdb.firebaseio.com";
const SIGEP_URL = "https://siap-f9cbb-default-rtdb.firebaseio.com";
const STORAGE_KEY = "goid_session";
const SSO_KEY = "goid_sso";
const LOGOUT_FLAG_KEY = "goid_logged_out_at"; // impede restauração automática após Sair
const ANO = "2026";
const SSO_TTL_MS = 3 * 60 * 1000; // 3 minutos para voltar ao Pequi
const GOID_SESSION_MS = 30 * 60 * 1000; // sessão GO ID 30 min
const RESET_TTL_MS = 15 * 60 * 1000; // código válido por 15 min
const RESET_MAX_ATTEMPTS = 5;        // tentativas máximas por código
const RESET_RESEND_COOLDOWN_MS = 60 * 1000; // 60s entre reenvios
const RESET_RATE_KEY = "goid_reset_rate";  // rate-limit local por CPF

/**
 * Configuração EmailJS — envio real de e-mail de recuperação
 * Service e Template já configurados. Preencha apenas a Public Key
 * (EmailJS → Account → API Keys → Public Key).
 *
 * Variáveis do template: to_email, to_name, code, cpf_mask, year
 */
const EMAILJS_CONFIG = {
  publicKey: "9G75_7zh1KHJ6vMSe",
  serviceId: "service_x8u2ird",
  templateId: "template_gmwdrb8"
};

let usuarioAtual = null;
let resetContext = null; // { userId, email, cpf, nome, lastSentAt }
/* ========== Firebase ========== */
async function dbGet(base, path) {
  const url = `${base}/${path.replace(/^\/+|\/+$/g, "")}.json`;
  const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`Erro ao consultar (${res.status})`);
  return res.json();
}
async function goidGet(path) { return dbGet(FIREBASE_URL, path); }
async function goidSet(path, data) {
  const url = `${FIREBASE_URL}/${path.replace(/^\/+|\/+$/g, "")}.json`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(`Erro ao gravar (${res.status})`);
  return res.json();
}
async function goidPush(path, data) {
  const url = `${FIREBASE_URL}/${path.replace(/^\/+|\/+$/g, "")}.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(`Erro ao criar (${res.status})`);
  return res.json();
}
async function sigepGet(path) { return dbGet(SIGEP_URL, path); }

/* ========== Utils ========== */
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
function showToast(msg, ms = 3400) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.remove("hidden");
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(t._tid);
  t._tid = setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.classList.add("hidden"), 300);
  }, ms);
}
function apenasDigitos(v) { return String(v || "").replace(/\D/g, ""); }
function formatarCPF(v) {
  const d = apenasDigitos(v).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0,3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`;
  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
}
function validarCPF(cpf) {
  const d = apenasDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += +d[i] * (10 - i);
  let r = (s * 10) % 11; if (r === 10) r = 0;
  if (r !== +d[9]) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += +d[i] * (11 - i);
  r = (s * 10) % 11; if (r === 10) r = 0;
  return r === +d[10];
}
function formatarDataBR(iso) {
  if (!iso) return "—";
  const s = String(iso);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split("-");
    return `${d}/${m}/${y}`;
  }
  return s;
}
function iniciais(nome) {
  const p = String(nome || "").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "GO";
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  return (p[0][0] + p[p.length - 1][0]).toUpperCase();
}
function gerarGoId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `GO${ANO}${s}`;
}
async function hashSenha(senha) {
  const enc = new TextEncoder().encode("goid-salt-2026:" + senha);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/* ========== Sessão ========== */
function salvarSessao(user) {
  const safe = { ...user };
  delete safe.senhaHash;
  safe.exp = Date.now() + GOID_SESSION_MS;
  safe.issuedAt = Date.now();
  // Login bem-sucedido: remove flag de logout explícito
  localStorage.removeItem(LOGOUT_FLAG_KEY);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  usuarioAtual = safe;
}

function sessaoValida(sess) {
  if (!sess) return false;
  if (sess.exp && Date.now() > sess.exp) return false;
  return true;
}

/** Emite token SSO de curta duração para o Pequi Express */
function emitirSsoToken(user) {
  const token = {
    goId: user.goId,
    nome: user.nome,
    cpf: user.cpf,
    dataNascimento: user.dataNascimento,
    email: user.email,
    matricula: user.matricula || null,
    origem: "goid",
    timestamp: Date.now(),
    exp: Date.now() + SSO_TTL_MS,
    nonce: Math.random().toString(36).slice(2) + Date.now().toString(36)
  };
  sessionStorage.setItem(SSO_KEY, JSON.stringify(token));
  localStorage.setItem(SSO_KEY, JSON.stringify(token));
  return token;
}

function obterReturnPequi() {
  const params = new URLSearchParams(window.location.search);
  const ret = params.get("return");
  if (ret === "pequi") return "pequi.html";
  return "pequi.html";
}

function voltarAoPequi(user) {
  if (!user.matricula) {
    showToast("Informe a matrícula escolar no perfil antes de acessar o boletim.");
    atualizarHeaderUser(user);
    preencherDashboard(user);
    const pn = document.getElementById("perfilNome");
    if (pn) {
      pn.value = user.nome || "";
      document.getElementById("perfilEmail").value = user.email || "";
      document.getElementById("perfilMatricula").value = user.matricula || "";
    }
    showScreen("app");
    showSection("perfil");
    return;
  }
  emitirSsoToken(user);
  showToast("Retornando ao Pequi Express...");
  window.location.href = obterReturnPequi() + "?sso=1&t=" + Date.now();
}

function carregarSessao() {
  try {
    // Após "Sair" explícito, não restaura sessão até novo login
    if (localStorage.getItem(LOGOUT_FLAG_KEY)) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const sess = JSON.parse(raw);
    if (!sessaoValida(sess)) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return sess;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

/** Limpa TODAS as sessões (GO ID + Pequi + SSO) e marca logout explícito */
function limparSessao() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(SSO_KEY);
  sessionStorage.removeItem(SSO_KEY);
  localStorage.removeItem("pequi_session"); // impede reentrada automática no Pequi
  // Flag impede que F5 / outra aba / bfcache restaure a sessão sozinha
  localStorage.setItem(LOGOUT_FLAG_KEY, String(Date.now()));
  usuarioAtual = null;
}

/* ========== Busca no SIGEP (Educação) ========== */
/**
 * Tenta localizar aluno no SIGEP por CPF ou por matrícula + data nasc.
 * Retorna dados básicos se encontrar.
 */
async function buscarAlunoEducacao({ cpf, matricula, dataNascimento, nome }) {
  try {
    const alunos = await sigepGet("siap/alunos");
    if (!alunos) return null;

    const cpfDigits = cpf ? apenasDigitos(cpf) : null;
    const mat = matricula ? String(matricula).trim() : null;
    const nasc = dataNascimento || null;

    // 1) por CPF (se o campo existir no cadastro)
    if (cpfDigits && cpfDigits.length === 11) {
      const found = Object.entries(alunos).find(([, a]) =>
        a && apenasDigitos(a.cpf || a.documento || "") === cpfDigits
      );
      if (found) {
        const [id, raw] = found;
        return normalizarAlunoSigep(id, raw);
      }
    }

    // 2) por matrícula + data de nascimento
    if (mat && nasc) {
      const found = Object.entries(alunos).find(([, a]) =>
        a && String(a.matricula || "").trim() === mat &&
        normalizarDataISO(a.dataNascimento) === nasc
      );
      if (found) {
        const [id, raw] = found;
        return normalizarAlunoSigep(id, raw);
      }
    }

    // 3) só matrícula
    if (mat) {
      const found = Object.entries(alunos).find(([, a]) =>
        a && String(a.matricula || "").trim() === mat
      );
      if (found) {
        const [id, raw] = found;
        return normalizarAlunoSigep(id, raw);
      }
    }

    return null;
  } catch (err) {
    console.warn("Busca Educação:", err.message);
    return null;
  }
}

function normalizarDataISO(value) {
  const s = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
}

function normalizarAlunoSigep(id, raw) {
  return {
    id,
    nome: raw.nome || "",
    matricula: String(raw.matricula || id),
    dataNascimento: normalizarDataISO(raw.dataNascimento),
    cpf: raw.cpf || raw.documento || null,
    turma: raw.turmaNome || raw.turma || "",
    serie: raw.serie || "",
    escola: raw.escolaNome || raw.escola || "",
    status: raw.status || raw.situacao || "Matriculado"
  };
}

/* ========== UI Auth ========== */
function showAuthView(view) {
  document.getElementById("view-login").classList.toggle("hidden", view !== "login");
  document.getElementById("view-register").classList.toggle("hidden", view !== "register");
  document.getElementById("view-forgot")?.classList.toggle("hidden", view !== "forgot");
  document.getElementById("view-code")?.classList.toggle("hidden", view !== "code");
  document.getElementById("view-newpass")?.classList.toggle("hidden", view !== "newpass");
}

function mascararEmail(email) {
  if (!email || !email.includes("@")) return "***";
  const [local, domain] = email.split("@");
  if (local.length <= 2) return local[0] + "***@" + domain;
  return local.slice(0, 2) + "***@" + domain;
}

function gerarCodigoReset() {
  // 8 caracteres: letras maiúsculas + números (sem 0/O/1/I para evitar confusão)
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const arr = new Uint32Array(8);
  crypto.getRandomValues(arr);
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[arr[i] % chars.length];
  return s;
}

async function hashCodigoReset(codigo) {
  return hashSenha("reset:" + codigo);
}

/** Rate-limit local: no máx. 3 solicitações por CPF em 10 min */
function checarRateLimitCpf(cpf) {
  try {
    const raw = sessionStorage.getItem(RESET_RATE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    const agora = Date.now();
    const hist = (map[cpf] || []).filter(t => agora - t < 10 * 60 * 1000);
    if (hist.length >= 3) return false;
    hist.push(agora);
    map[cpf] = hist;
    sessionStorage.setItem(RESET_RATE_KEY, JSON.stringify(map));
    return true;
  } catch {
    return true;
  }
}

async function enviarEmailReset({ email, nome, codigo, cpf }) {
  const cfg = EMAILJS_CONFIG;
  if (!cfg.publicKey || !cfg.serviceId || !cfg.templateId) {
    console.warn("[GO ID] EmailJS incompleto:", cfg);
    return { ok: false, via: "fallback", codigo, motivo: "Configuração EmailJS incompleta" };
  }
  if (!window.emailjs) {
    console.warn("[GO ID] Biblioteca EmailJS não carregou (CDN).");
    return { ok: false, via: "fallback", codigo, motivo: "Biblioteca EmailJS não carregou" };
  }

  // Inicializa de novo para garantir a public key
  try {
    window.emailjs.init({ publicKey: cfg.publicKey });
  } catch (e) {
    console.warn("[GO ID] emailjs.init:", e);
  }

  const params = {
    // nomes mais comuns usados em templates EmailJS
    to_email: email,
    email: email,
    user_email: email,
    reply_to: email,
    to_name: (nome || "Usuário").split(" ")[0],
    name: (nome || "Usuário").split(" ")[0],
    code: codigo,
    codigo: codigo,
    cpf_mask: formatarCPF(cpf),
    year: String(new Date().getFullYear()),
    message: `Seu código de recuperação GO ID é: ${codigo}`
  };

  try {
    const resp = await window.emailjs.send(
      cfg.serviceId,
      cfg.templateId,
      params,
      { publicKey: cfg.publicKey }
    );
    console.info("[GO ID] EmailJS OK:", resp?.status, resp?.text);
    return { ok: true, via: "emailjs", resp };
  } catch (err) {
    const detalhe = err?.text || err?.message || String(err);
    console.error("[GO ID] EmailJS FALHOU:", err);
    return { ok: false, via: "emailjs", error: err, motivo: detalhe, codigo };
  }
}
function showScreen(name) {
  document.getElementById("screen-auth").classList.toggle("hidden", name !== "auth");
  document.getElementById("screen-app").classList.toggle("hidden", name !== "app");
}
function showSection(id) {
  document.querySelectorAll("#screen-app .section").forEach(s => s.classList.remove("active"));
  const el = document.getElementById("section-" + id);
  if (el) el.classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function goHome() {
  if (usuarioAtual) showSection("dashboard");
  else showScreen("auth");
}

function atualizarHeaderUser(user) {
  if (!user) return;
  document.getElementById("userNameShort").textContent = user.nome.split(" ")[0];
  document.getElementById("userGoId").textContent = user.goId;
  document.getElementById("userAvatar").textContent = iniciais(user.nome);
}

function preencherDashboard(user) {
  document.getElementById("dashNome").textContent = user.nome.split(" ")[0];
  document.getElementById("dashGoId").textContent = user.goId;
  document.getElementById("profileNome").textContent = user.nome;
  document.getElementById("profileEmail").textContent = user.email;
  document.getElementById("profileCpf").textContent = formatarCPF(user.cpf);
  document.getElementById("profileNasc").textContent = formatarDataBR(user.dataNascimento);
  document.getElementById("profileAvatar").textContent = iniciais(user.nome);

  const matWrap = document.getElementById("profileMatriculaWrap");
  if (user.matricula) {
    matWrap.classList.remove("hidden");
    document.getElementById("profileMatricula").textContent = user.matricula;
  } else {
    matWrap.classList.add("hidden");
  }

  document.getElementById("servicesGrid").innerHTML = `
    <div class="service-card" onclick="abrirPequiExpress()">
      <div class="service-icon pequi">🍊</div>
      <h3>Pequi Express</h3>
      <p>Consulte e imprima seu boletim escolar com dados da Educação.</p>
      <span class="tag">Educação</span>
      <a class="btn-open" href="#" onclick="event.preventDefault(); abrirPequiExpress();">Acessar com GO ID →</a>
    </div>
    <div class="service-card" onclick="showToast('O SIGEP é o sistema interno da escola. Use o Pequi Express para o boletim.')">
      <div class="service-icon sigep">📋</div>
      <h3>SIGEP</h3>
      <p>Sistema de Gerenciamento Pedagógico (secretaria e diário).</p>
      <span class="tag">Educação</span>
    </div>
    <div class="service-card soon">
      <div class="service-icon">🏛️</div>
      <h3>Outros serviços</h3>
      <p>Em breve novos portais do Estado de Goiás integrados ao GO ID.</p>
      <span class="tag">Em breve</span>
    </div>
  `;
}

function abrirPequiExpress() {
  if (!usuarioAtual) {
    showToast("Faça login no GO ID primeiro");
    return;
  }
  voltarAoPequi(usuarioAtual);
}

/* ========== Recuperação de senha ========== */
async function handleForgot(e) {
  e.preventDefault();
  const cpf = apenasDigitos(document.getElementById("forgotCpf").value);
  const errorEl = document.getElementById("forgotError");
  const infoEl = document.getElementById("forgotInfo");
  const btn = document.getElementById("btnForgotSubmit");
  const btnText = btn.querySelector(".btn-text");
  const btnLoader = btn.querySelector(".btn-loader");

  errorEl.classList.add("hidden");
  infoEl.classList.add("hidden");
  btnText.classList.add("hidden");
  btnLoader.classList.remove("hidden");
  btn.disabled = true;

  try {
    if (!cpf || cpf.length !== 11) throw new Error("Informe um CPF válido.");
    if (!validarCPF(cpf)) throw new Error("CPF inválido.");

    if (!checarRateLimitCpf(cpf)) {
      throw new Error("Muitas solicitações para este CPF. Aguarde alguns minutos e tente novamente.");
    }

    // Cooldown de reenvio
    if (resetContext && resetContext.cpf === cpf && resetContext.lastSentAt) {
      const restante = RESET_RESEND_COOLDOWN_MS - (Date.now() - resetContext.lastSentAt);
      if (restante > 0) {
        throw new Error(`Aguarde ${Math.ceil(restante / 1000)}s para reenviar o código.`);
      }
    }

    mostrarCarregando("Verificando dados e preparando envio...");

    const usuarios = (await goidGet("usuarios")) || {};
    const entry = Object.entries(usuarios).find(([, u]) =>
      u && u.cpf && apenasDigitos(u.cpf) === cpf
    );

    // Anti-enumeração: mensagem genérica se não encontrar conta ou e-mail
    if (!entry || !entry[1].email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry[1].email)) {
      ocultarCarregando();
      // Atraso artificial para dificultar timing attacks
      await new Promise(r => setTimeout(r, 600 + Math.random() * 400));
      infoEl.innerHTML = `Se existir uma conta com este CPF e e-mail válido, enviamos um código de verificação.<br>
        <span class="hint-inline">Verifique a caixa de entrada e a pasta de spam.</span>`;
      infoEl.classList.remove("hidden");
      showToast("Verifique seu e-mail");
      // Não avança para a tela de reset se não houver conta real
      return;
    }

    const [key, user] = entry;
    const codigo = gerarCodigoReset();
    const codigoHash = await hashCodigoReset(codigo);
    const agora = Date.now();

    const atualizado = {
      ...user,
      resetCodeHash: codigoHash,
      resetExp: agora + RESET_TTL_MS,
      resetAttempts: 0,
      resetRequestedAt: new Date().toISOString(),
      // limpa campo antigo (compatibilidade)
      resetCode: null
    };
    await goidSet(`usuarios/${key}`, atualizado);

    resetContext = {
      userId: key,
      email: user.email,
      cpf: user.cpf,
      nome: user.nome,
      lastSentAt: agora
    };

    const envio = await enviarEmailReset({
      email: user.email,
      nome: user.nome,
      codigo,
      cpf: user.cpf
    });

    ocultarCarregando();

    const mask = mascararEmail(user.email);
    document.getElementById("resetEmailMask").textContent = mask;

    if (!envio.ok) {
      const motivo = envio.motivo ? ` Detalhe: ${envio.motivo}` : "";
      throw new Error("Não foi possível enviar o e-mail de recuperação." + motivo + " Tente novamente.");
    }

    const secBadge = document.getElementById("resetSecurityBadge");
    if (secBadge) {
      secBadge.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Código enviado com segurança`;
    }

    // Limpa info da tela de CPF (sucesso será visto na próxima etapa)
    infoEl.classList.add("hidden");
    showToast("Código enviado para " + mask);
    showAuthView("code");
    document.getElementById("codeForm")?.reset();
    document.getElementById("resetAttemptsLeft")?.classList.add("hidden");
  } catch (err) {
    ocultarCarregando();
    console.error(err);
    errorEl.textContent = err.message || "Não foi possível iniciar a recuperação.";
    errorEl.classList.remove("hidden");
  } finally {
    btnText.classList.remove("hidden");
    btnLoader.classList.add("hidden");
    btn.disabled = false;
  }
}

async function handleCodeVerify(e) {
  e.preventDefault();
  const codigo = String(document.getElementById("resetCode").value || "").trim();
  const errorEl = document.getElementById("codeError");
  const attemptsEl = document.getElementById("resetAttemptsLeft");
  const btn = document.getElementById("btnCodeSubmit");
  const btnText = btn.querySelector(".btn-text");
  const btnLoader = btn.querySelector(".btn-loader");

  errorEl.classList.add("hidden");
  btnText.classList.add("hidden");
  btnLoader.classList.remove("hidden");
  btn.disabled = true;

  try {
    if (!resetContext || !resetContext.userId) {
      throw new Error("Sessão de recuperação expirada. Solicite um novo código.");
    }
    if (!/^[A-Za-z0-9]{8}$/.test(codigo)) throw new Error("Informe o código de 8 caracteres enviado por e-mail.");

    mostrarCarregando("Validando código...");

    const user = await goidGet(`usuarios/${resetContext.userId}`);
    if (!user) throw new Error("Conta não encontrada. Solicite um novo código.");

    if (!user.resetExp || Date.now() > user.resetExp) {
      throw new Error("Código expirado. Solicite um novo código.");
    }

    const tentativas = Number(user.resetAttempts || 0);
    if (tentativas >= RESET_MAX_ATTEMPTS) {
      await goidSet(`usuarios/${resetContext.userId}`, {
        ...user,
        resetCodeHash: null,
        resetCode: null,
        resetExp: null,
        resetAttempts: tentativas
      });
      throw new Error("Muitas tentativas inválidas. Solicite um novo código.");
    }

    const codigoHash = await hashCodigoReset(codigo);
    const hashOk = user.resetCodeHash && user.resetCodeHash === codigoHash;
    const plainOk = user.resetCode && String(user.resetCode) === codigo;

    if (!hashOk && !plainOk) {
      const novasTentativas = tentativas + 1;
      await goidSet(`usuarios/${resetContext.userId}`, {
        ...user,
        resetAttempts: novasTentativas
      });
      const restantes = RESET_MAX_ATTEMPTS - novasTentativas;
      if (attemptsEl) {
        attemptsEl.textContent = restantes > 0
          ? `${restantes} tentativa${restantes > 1 ? "s" : ""} restante${restantes > 1 ? "s" : ""}`
          : "Nenhuma tentativa restante";
        attemptsEl.classList.remove("hidden");
      }
      throw new Error("Código inválido.");
    }

    // Código válido — marca como verificado na sessão e avança
    resetContext.codeVerified = true;
    resetContext.verifiedCode = codigo;
    ocultarCarregando();
    if (attemptsEl) attemptsEl.classList.add("hidden");
    document.getElementById("newpassForm")?.reset();
    showAuthView("newpass");
    showToast("Código validado. Defina sua nova senha.");
  } catch (err) {
    ocultarCarregando();
    console.error(err);
    errorEl.textContent = err.message || "Não foi possível validar o código.";
    errorEl.classList.remove("hidden");
  } finally {
    btnText.classList.remove("hidden");
    btnLoader.classList.add("hidden");
    btn.disabled = false;
  }
}

async function handleNewPassword(e) {
  e.preventDefault();
  const senha = document.getElementById("resetSenha").value;
  const senha2 = document.getElementById("resetSenha2").value;
  const errorEl = document.getElementById("newpassError");
  const btn = document.getElementById("btnNewpassSubmit");
  const btnText = btn.querySelector(".btn-text");
  const btnLoader = btn.querySelector(".btn-loader");

  errorEl.classList.add("hidden");
  btnText.classList.add("hidden");
  btnLoader.classList.remove("hidden");
  btn.disabled = true;

  try {
    if (!resetContext || !resetContext.userId || !resetContext.codeVerified) {
      throw new Error("Valide o código de verificação antes de criar a nova senha.");
    }
    if (senha.length < 6) throw new Error("A senha deve ter no mínimo 6 caracteres.");
    if (senha !== senha2) throw new Error("As senhas não coincidem.");

    mostrarCarregando("Salvando nova senha...");

    const user = await goidGet(`usuarios/${resetContext.userId}`);
    if (!user) throw new Error("Conta não encontrada. Solicite a recuperação novamente.");

    // Revalida expiração por segurança
    if (!user.resetExp || Date.now() > user.resetExp) {
      throw new Error("Código expirado. Solicite um novo código.");
    }

    const senhaHash = await hashSenha(senha);
    const agora = new Date().toISOString();

    const atualizado = {
      ...user,
      senhaHash,
      atualizadoEm: agora,
      resetCodeHash: null,
      resetCode: null,
      resetExp: null,
      resetAttempts: null,
      resetRequestedAt: null
    };
    await goidSet(`usuarios/${resetContext.userId}`, atualizado);

    ocultarCarregando();
    resetContext = null;
    document.getElementById("codeForm")?.reset();
    document.getElementById("newpassForm")?.reset();
    document.getElementById("forgotForm")?.reset();
    showToast("Senha redefinida com sucesso! Faça login com a nova senha.");
    showAuthView("login");
  } catch (err) {
    ocultarCarregando();
    console.error(err);
    errorEl.textContent = err.message || "Não foi possível salvar a nova senha.";
    errorEl.classList.remove("hidden");
  } finally {
    btnText.classList.remove("hidden");
    btnLoader.classList.add("hidden");
    btn.disabled = false;
  }
}

async function handleResendCode() {
  if (!resetContext) {
    showToast("Solicite a recuperação novamente.");
    showAuthView("forgot");
    return;
  }
  if (resetContext.lastSentAt) {
    const restante = RESET_RESEND_COOLDOWN_MS - (Date.now() - resetContext.lastSentAt);
    if (restante > 0) {
      showToast(`Aguarde ${Math.ceil(restante / 1000)}s para reenviar`);
      return;
    }
  }
  document.getElementById("forgotCpf").value = formatarCPF(resetContext.cpf);
  const fakeEvent = { preventDefault() {} };
  await handleForgot(fakeEvent);
}

/* ========== Login ========== */
async function handleLogin(e) {
  e.preventDefault();
  const senha = document.getElementById("loginSenha").value;
  const errorEl = document.getElementById("loginError");
  const btn = document.getElementById("btnLogin");
  const btnText = btn.querySelector(".btn-text");
  const btnLoader = btn.querySelector(".btn-loader");

  errorEl.classList.add("hidden");
  btnText.classList.add("hidden");
  btnLoader.classList.remove("hidden");
  btn.disabled = true;

  try {
    if (!senha) throw new Error("Informe a senha.");

    const identCpf = apenasDigitos(document.getElementById("loginCpf").value);
    if (!identCpf || identCpf.length !== 11) throw new Error("Informe um CPF válido.");
    if (!validarCPF(identCpf)) throw new Error("CPF inválido.");

    const usuarios = (await goidGet("usuarios")) || {};
    const senhaHash = await hashSenha(senha);

    const entry = Object.entries(usuarios).find(([, u]) =>
      u && u.cpf && apenasDigitos(u.cpf) === identCpf
    );

    if (!entry) throw new Error("Conta não encontrada. Verifique o CPF ou crie uma conta.");
    const [key, user] = entry;
    if (user.senhaHash !== senhaHash) throw new Error("Senha incorreta.");

    const sessionUser = {
      id: key,
      goId: user.goId,
      nome: user.nome,
      email: user.email,
      cpf: user.cpf,
      dataNascimento: user.dataNascimento,
      matricula: user.matricula || null,
      criadoEm: user.criadoEm
    };
    salvarSessao(sessionUser);
    // Sempre retorna ao Pequi Express com token SSO de curta duração
    voltarAoPequi(sessionUser);
    return;
  } catch (err) {
    console.error(err);
    errorEl.textContent = err.message || "Não foi possível entrar.";
    errorEl.classList.remove("hidden");
  } finally {
    btnText.classList.remove("hidden");
    btnLoader.classList.add("hidden");
    btn.disabled = false;
  }
}

/* ========== Cadastro ========== */
async function handleRegister(e) {
  e.preventDefault();
  const nome = document.getElementById("regNome").value.trim();
  const cpf = apenasDigitos(document.getElementById("regCpf").value);
  const dataNasc = document.getElementById("regNasc").value;
  const email = document.getElementById("regEmail").value.trim().toLowerCase();
  let matricula = document.getElementById("regMatricula").value.trim() || null;
  const senha = document.getElementById("regSenha").value;
  const senha2 = document.getElementById("regSenha2").value;
  const errorEl = document.getElementById("registerError");
  const infoEl = document.getElementById("registerInfo");
  const btn = document.getElementById("btnRegister");
  const btnText = btn.querySelector(".btn-text");
  const btnLoader = btn.querySelector(".btn-loader");

  errorEl.classList.add("hidden");
  infoEl.classList.add("hidden");
  btnText.classList.add("hidden");
  btnLoader.classList.remove("hidden");
  btn.disabled = true;

  try {
    if (!nome || nome.split(/\s+/).length < 2) throw new Error("Informe o nome completo.");
    if (!validarCPF(cpf)) throw new Error("CPF inválido.");
    if (!dataNasc) throw new Error("Informe a data de nascimento.");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("E-mail inválido.");
    if (senha.length < 6) throw new Error("A senha deve ter no mínimo 6 caracteres.");
    if (senha !== senha2) throw new Error("As senhas não coincidem.");

    mostrarCarregando("Criando conta e consultando Educação...");

    const usuarios = (await goidGet("usuarios")) || {};
    const jaExiste = Object.values(usuarios).some(u =>
      u && (apenasDigitos(u.cpf) === cpf || (u.email && u.email.toLowerCase() === email))
    );
    if (jaExiste) throw new Error("Já existe uma conta com este CPF ou e-mail.");

    // Tenta localizar aluno na Educação e preencher matrícula/nome se possível
    const alunoEdu = await buscarAlunoEducacao({ cpf, matricula, dataNascimento: dataNasc, nome });
    if (alunoEdu) {
      if (!matricula && alunoEdu.matricula) matricula = alunoEdu.matricula;
      infoEl.textContent = `Dados da Educação encontrados: matrícula ${alunoEdu.matricula}${alunoEdu.escola ? " · " + alunoEdu.escola : ""}.`;
      infoEl.classList.remove("hidden");
    }

    let goId = gerarGoId();
    const ids = new Set(Object.values(usuarios).map(u => u?.goId).filter(Boolean));
    let tentativas = 0;
    while (ids.has(goId) && tentativas < 20) {
      goId = gerarGoId();
      tentativas++;
    }

    const senhaHash = await hashSenha(senha);
    const agora = new Date().toISOString();

    const novo = {
      goId,
      nome: (alunoEdu?.nome || nome).toUpperCase(),
      cpf,
      dataNascimento: dataNasc,
      email,
      matricula,
      senhaHash,
      origemEducacao: !!alunoEdu,
      criadoEm: agora,
      atualizadoEm: agora
    };

    const result = await goidPush("usuarios", novo);
    const key = result.name;

    ocultarCarregando();

    const sessionUser = {
      id: key,
      goId: novo.goId,
      nome: novo.nome,
      email: novo.email,
      cpf: novo.cpf,
      dataNascimento: novo.dataNascimento,
      matricula: novo.matricula,
      criadoEm: novo.criadoEm
    };
    salvarSessao(sessionUser);
    atualizarHeaderUser(sessionUser);
    preencherDashboard(sessionUser);
    document.getElementById("perfilNome").value = sessionUser.nome || "";
    document.getElementById("perfilEmail").value = sessionUser.email || "";
    document.getElementById("perfilMatricula").value = sessionUser.matricula || "";

    document.getElementById("registerForm").reset();
    showToast(`Conta criada! Seu GO ID é ${goId}`);
    voltarAoPequi(sessionUser);
    return;
  } catch (err) {
    ocultarCarregando();
    console.error(err);
    errorEl.textContent = err.message || "Não foi possível criar a conta.";
    errorEl.classList.remove("hidden");
  } finally {
    btnText.classList.remove("hidden");
    btnLoader.classList.add("hidden");
    btn.disabled = false;
  }
}

/* ========== Perfil ========== */
async function handlePerfil(e) {
  e.preventDefault();
  if (!usuarioAtual) return;
  const nome = document.getElementById("perfilNome").value.trim();
  const email = document.getElementById("perfilEmail").value.trim().toLowerCase();
  const matricula = document.getElementById("perfilMatricula").value.trim() || null;
  const errorEl = document.getElementById("perfilError");
  const successEl = document.getElementById("perfilSuccess");
  errorEl.classList.add("hidden");
  successEl.classList.add("hidden");

  try {
    if (!nome || nome.split(/\s+/).length < 2) throw new Error("Informe o nome completo.");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("E-mail inválido.");

    const atual = await goidGet(`usuarios/${usuarioAtual.id}`);
    if (!atual) throw new Error("Usuário não encontrado.");

    const atualizado = {
      ...atual,
      nome: nome.toUpperCase(),
      email,
      matricula,
      atualizadoEm: new Date().toISOString()
    };
    await goidSet(`usuarios/${usuarioAtual.id}`, atualizado);

    usuarioAtual = { ...usuarioAtual, nome: atualizado.nome, email: atualizado.email, matricula: atualizado.matricula };
    salvarSessao(usuarioAtual);
    atualizarHeaderUser(usuarioAtual);
    preencherDashboard(usuarioAtual);
    successEl.textContent = "Perfil atualizado com sucesso.";
    successEl.classList.remove("hidden");
    showToast("Dados salvos!");
    // Se tem matrícula e veio do Pequi, retorna automaticamente
    const params = new URLSearchParams(window.location.search);
    if (usuarioAtual.matricula && (params.get("return") === "pequi" || params.get("action") === "perfil")) {
      setTimeout(() => voltarAoPequi(usuarioAtual), 900);
    }
  } catch (err) {
    errorEl.textContent = err.message || "Erro ao salvar.";
    errorEl.classList.remove("hidden");
  }
}

function logout() {
  limparSessao();
  // Limpa formulários e estado visual
  document.getElementById("loginForm")?.reset();
  document.getElementById("registerForm")?.reset();
  document.getElementById("forgotForm")?.reset();
  document.getElementById("codeForm")?.reset();
  document.getElementById("newpassForm")?.reset();
  document.getElementById("perfilForm")?.reset();
  // Garante que a UI não fique no painel logado
  showScreen("auth");
  showAuthView("login");
  // Remove query params que poderiam reativar fluxo de retorno
  if (window.history.replaceState) {
    window.history.replaceState({}, "", window.location.pathname);
  }
  showToast("Você saiu do GO ID. Faça login novamente para continuar.");
}

/* ========== Tema ========== */
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute("data-theme") === "dark";
  if (isDark) {
    html.removeAttribute("data-theme");
    localStorage.setItem("goid-theme", "light");
  } else {
    html.setAttribute("data-theme", "dark");
    localStorage.setItem("goid-theme", "dark");
  }
}


/* ========== Termos e LGPD ========== */
const POLICY_TERMOS = `
  <h3>1. Objeto</h3>
  <p>O GO ID é a identidade digital para acesso a serviços educacionais e públicos do Estado de Goiás, incluindo o Pequi Express e integrações com o SIGEP.</p>
  <h3>2. Cadastro e autenticação</h3>
  <p>O usuário é responsável pela veracidade dos dados informados (CPF, nome, data de nascimento, e-mail e, quando aplicável, matrícula escolar). A senha é pessoal e intransferível.</p>
  <h3>3. Uso adequado</h3>
  <ul>
    <li>Não compartilhar credenciais com terceiros;</li>
    <li>Não tentar acessar dados de outras pessoas;</li>
    <li>Comunicar imediatamente qualquer uso indevido da conta.</li>
  </ul>
  <h3>4. Disponibilidade</h3>
  <p>Os serviços podem passar por manutenção ou indisponibilidade temporária. O GO ID não se responsabiliza por prejuízos decorrentes de falhas de conexão ou de terceiros (incluindo provedores de e-mail).</p>
  <h3>5. Alterações</h3>
  <p>Estes Termos podem ser atualizados. O uso continuado dos serviços após a publicação de alterações implica concordância com a versão vigente.</p>
`;

const POLICY_LGPD = `
  <h3>1. Controlador e finalidade</h3>
  <p>Os dados pessoais tratados no GO ID destinam-se à autenticação do usuário e à prestação de serviços educacionais (consulta de boletim, vínculo de matrícula e comunicações de segurança, como recuperação de senha), em conformidade com a Lei nº 13.709/2018 (LGPD).</p>
  <h3>2. Dados coletados</h3>
  <ul>
    <li>Identificação: nome, CPF, data de nascimento, e-mail;</li>
    <li>Educação (quando aplicável): matrícula, vínculos escolares obtidos via SIGEP;</li>
    <li>Segurança: hash de senha, códigos temporários de recuperação, registros de solicitação de reset.</li>
  </ul>
  <h3>3. Bases legais</h3>
  <p>O tratamento fundamenta-se no consentimento do titular (cadastro), no legítimo interesse e na execução de políticas públicas educacionais, quando aplicável.</p>
  <h3>4. Compartilhamento</h3>
  <p>Dados podem ser consultados junto a bases da Educação (SIGEP) para localizar matrícula. O envio de e-mails de recuperação utiliza serviço de terceiros (EmailJS) apenas com as informações necessárias (nome, e-mail, código e CPF mascarado).</p>
  <h3>5. Armazenamento e segurança</h3>
  <p>Senhas são armazenadas exclusivamente na forma de hash. Códigos de recuperação expiram em poucos minutos e possuem limite de tentativas. Adotamos medidas técnicas razoáveis para proteger os dados.</p>
  <h3>6. Direitos do titular</h3>
  <p>Nos termos da LGPD, você pode solicitar confirmação de tratamento, acesso, correção, anonimização, portabilidade ou eliminação dos dados, quando cabível, pelos canais institucionais disponíveis.</p>
  <h3>7. Contato</h3>
  <p>Para exercer direitos ou esclarecer dúvidas sobre privacidade, utilize os canais oficiais da instituição de ensino ou da secretaria responsável pelo serviço.</p>
`;

function abrirPolitica(tipo) {
  const modal = document.getElementById("modalPolicy");
  const title = document.getElementById("modalPolicyTitle");
  const body = document.getElementById("modalPolicyBody");
  if (!modal || !title || !body) return;
  if (tipo === "lgpd") {
    title.textContent = "Política de Privacidade (LGPD)";
    body.innerHTML = POLICY_LGPD;
  } else {
    title.textContent = "Termos de Uso";
    body.innerHTML = POLICY_TERMOS;
  }
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function fecharPolitica() {
  const modal = document.getElementById("modalPolicy");
  if (!modal) return;
  modal.classList.add("hidden");
  document.body.style.overflow = "";
}

/* ========== Init ========== */
document.addEventListener("DOMContentLoaded", () => {
  if (localStorage.getItem("goid-theme") === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  }

  // Inicializa EmailJS se configurado
  if (EMAILJS_CONFIG.publicKey && window.emailjs) {
    try {
      window.emailjs.init({ publicKey: EMAILJS_CONFIG.publicKey });
    } catch (e) {
      console.warn("EmailJS init:", e);
    }
  }

  document.getElementById("themeToggle")?.addEventListener("click", toggleTheme);
  document.getElementById("themeToggleApp")?.addEventListener("click", toggleTheme);

  // Termos / LGPD
  document.querySelectorAll(".link-policy").forEach(el => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const id = el.id || "";
      const isLgpd = id.toLowerCase().includes("privacidade") || el.textContent.toLowerCase().includes("lgpd") || el.textContent.toLowerCase().includes("privacidade");
      abrirPolitica(isLgpd ? "lgpd" : "termos");
    });
  });
  document.getElementById("modalPolicyClose")?.addEventListener("click", fecharPolitica);
  document.getElementById("modalPolicyOk")?.addEventListener("click", fecharPolitica);
  document.getElementById("modalPolicy")?.addEventListener("click", (e) => {
    if (e.target.id === "modalPolicy") fecharPolitica();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") fecharPolitica();
  });

  // views
  document.getElementById("btnShowRegister")?.addEventListener("click", () => showAuthView("register"));
  document.getElementById("btnBackLogin")?.addEventListener("click", () => showAuthView("login"));
  document.getElementById("btnForgot")?.addEventListener("click", () => {
    document.getElementById("forgotForm")?.reset();
    document.getElementById("forgotError")?.classList.add("hidden");
    document.getElementById("forgotInfo")?.classList.add("hidden");
    showAuthView("forgot");
  });
  document.getElementById("btnBackFromForgot")?.addEventListener("click", () => showAuthView("login"));
  document.getElementById("btnBackFromCode")?.addEventListener("click", () => showAuthView("forgot"));
  document.getElementById("btnBackFromNewpass")?.addEventListener("click", () => showAuthView("code"));
  document.getElementById("btnResendCode")?.addEventListener("click", handleResendCode);

  // forms
  document.getElementById("loginForm")?.addEventListener("submit", handleLogin);
  document.getElementById("registerForm")?.addEventListener("submit", handleRegister);
  document.getElementById("perfilForm")?.addEventListener("submit", handlePerfil);
  document.getElementById("forgotForm")?.addEventListener("submit", handleForgot);
  document.getElementById("codeForm")?.addEventListener("submit", handleCodeVerify);
  document.getElementById("newpassForm")?.addEventListener("submit", handleNewPassword);

  // máscaras CPF
  ["loginCpf", "regCpf", "forgotCpf"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", e => {
      e.target.value = formatarCPF(e.target.value);
    });
  });

  // máscara código (só números)
  document.getElementById("resetCode")?.addEventListener("input", e => {
    e.target.value = e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8);
  });

  // toggle senha
  document.querySelectorAll(".toggle-pass").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = document.getElementById(btn.dataset.target);
      if (!target) return;
      const isPass = target.type === "password";
      target.type = isPass ? "text" : "password";
      btn.querySelector(".eye-open")?.classList.toggle("hidden", isPass);
      btn.querySelector(".eye-closed")?.classList.toggle("hidden", !isPass);
    });
  });

  // sessão existente
  const sess = carregarSessao();
  const params = new URLSearchParams(window.location.search);
  const querPequi = params.get("return") === "pequi";
  const querRegister = params.get("action") === "register";
  const querPerfil = params.get("action") === "perfil";

  if (querRegister) {
    showAuthView("register");
  }

  if (sess) {
    usuarioAtual = sess;
    // Se veio só para completar matrícula
    if (querPerfil) {
      atualizarHeaderUser(sess);
      preencherDashboard(sess);
      const pn = document.getElementById("perfilNome");
      if (pn) {
        pn.value = sess.nome || "";
        document.getElementById("perfilEmail").value = sess.email || "";
        document.getElementById("perfilMatricula").value = sess.matricula || "";
      }
      showScreen("app");
      showSection("perfil");
      showToast("Informe sua matrícula escolar e salve para acessar o boletim.");
      return;
    }
    if (querPequi) {
      // Já autenticado — se não tem matrícula, manda para o perfil
      if (!sess.matricula) {
        atualizarHeaderUser(sess);
        preencherDashboard(sess);
        const pn = document.getElementById("perfilNome");
        if (pn) {
          pn.value = sess.nome || "";
          document.getElementById("perfilEmail").value = sess.email || "";
          document.getElementById("perfilMatricula").value = "";
        }
        showScreen("app");
        showSection("perfil");
        showToast("Vincule sua matrícula escolar para acessar o Pequi Express.");
        return;
      }
      voltarAoPequi(sess);
      return;
    }
    atualizarHeaderUser(sess);
    preencherDashboard(sess);
    const pn = document.getElementById("perfilNome");
    if (pn) {
      pn.value = sess.nome || "";
      document.getElementById("perfilEmail").value = sess.email || "";
      document.getElementById("perfilMatricula").value = sess.matricula || "";
    }
    showScreen("app");
    showSection("dashboard");
  }

  setTimeout(ocultarCarregando, 600);
});
