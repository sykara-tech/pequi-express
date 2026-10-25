/**
 * GO ID — Identidade Digital do Estado de Goiás
 * Estilo gov.br · Firebase Realtime Database
 */

const FIREBASE_URL = "https://goid-57028-default-rtdb.firebaseio.com";
const SIGEP_URL = "https://siap-f9cbb-default-rtdb.firebaseio.com";
const STORAGE_KEY = "goid_session";
const SSO_KEY = "goid_sso";
const ANO = "2026";
const SSO_TTL_MS = 3 * 60 * 1000; // 3 minutos para voltar ao Pequi
const GOID_SESSION_MS = 30 * 60 * 1000; // sessão GO ID 30 min

let usuarioAtual = null;
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
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const sess = JSON.parse(raw);
    if (!sessaoValida(sess)) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return sess;
  } catch { return null; }
}
function limparSessao() {
  localStorage.removeItem(STORAGE_KEY);
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
  document.getElementById("loginForm")?.reset();
  showScreen("auth");
  showAuthView("login");
  showToast("Você saiu do GO ID");
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

/* ========== Init ========== */
document.addEventListener("DOMContentLoaded", () => {
  if (localStorage.getItem("goid-theme") === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  }

  document.getElementById("themeToggle")?.addEventListener("click", toggleTheme);
  document.getElementById("themeToggleApp")?.addEventListener("click", toggleTheme);

  // views
  document.getElementById("btnShowRegister")?.addEventListener("click", () => showAuthView("register"));
    document.getElementById("btnBackLogin")?.addEventListener("click", () => showAuthView("login"));

  // forms
  document.getElementById("loginForm")?.addEventListener("submit", handleLogin);
  document.getElementById("registerForm")?.addEventListener("submit", handleRegister);
  document.getElementById("perfilForm")?.addEventListener("submit", handlePerfil);

  // máscaras CPF
  ["loginCpf", "regCpf"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", e => {
      e.target.value = formatarCPF(e.target.value);
    });
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
