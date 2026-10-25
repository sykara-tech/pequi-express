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
  // não remove goid_session do GO ID — só a sessão do Pequi
}

function salvarSessaoPequi(aluno, sso) {
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
    const raw = localStorage.getItem(PEQUI_SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !data.exp || Date.now() > data.exp) {
      limparSessaoPequi();
      return null;
    }
    return data;
  } catch {
    limparSessaoPequi();
    return null;
  }
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
  if (!alunoAtual) return;
  const sess = lerSessaoPequi();
  if (!sess) {
    showToast("Sessão expirada. Entre novamente com o GO ID.");
    logout(true);
    return;
  }
  if (Date.now() - lastActivity > SESSION_IDLE_MS) {
    showToast("Sessão encerrada por inatividade.");
    logout(true);
  }
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
  const turmas = await dbGet("siap/turmas").catch(() => ({}));
  const turma = turmas?.[turmaId] || {};
  return {
    ...raw, id, matricula: raw.matricula || id,
    turmaId, turma: turma.nome || raw.turmaNome || turmaId || "—",
    turno: raw.turno || turma.turno || "—", serie: raw.serie || turma.serie || "—",
    composicao: raw.composicao || turma.composicao || turma.serie || "—",
    anoLetivo: raw.ano || ANO_LETIVO,
    escola: raw.escolaNome || raw.escola || "Unidade escolar",
    inep: raw.inep || raw.codigoEscola || "—", municipio: raw.municipio || "—", uf: "GO",
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
  grid.innerHTML = DOCUMENTOS.map(doc => `
    <div class="doc-card" onclick="abrirDocumento('${doc.id}')">
      <div class="doc-icon" style="background: ${doc.cor}22">${doc.icon}</div>
      <h3>${doc.titulo}</h3>
      <p>${doc.descricao}</p>
      <span class="doc-action">Emitir agora →</span>
    </div>
  `).join("");

  showSection("dashboard");
  showToast(`Bem-vindo(a), ${aluno.nome.split(" ")[0]}!`);
}

function logout(silencioso) {
  alunoAtual = null;
  limparSessaoPequi();
  clearTimeout(idleTimer);
  const badge = document.getElementById("userBadge");
  if (badge) badge.classList.add("hidden");
  showSection("home");
  document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
  const homeLink = document.querySelector('.nav-link[data-section="home"]');
  if (homeLink) homeLink.classList.add("active");
  if (!silencioso) showToast("Você saiu do portal");
}

// ===== Documentos =====
async function abrirDocumento(id) {
  if(!alunoAtual){ showToast("Entre com o GO ID para acessar o boletim"); irParaGoId(); return; }
  verificarSessao();
  documentoAtual=id;
  const doc=DOCUMENTOS.find(d=>d.id===id);
  document.getElementById("modalTitle").textContent=doc?.titulo||"Documento escolar";
  document.getElementById("modalBody").innerHTML='<p class="document-loading">Preparando boletim…</p>';
  document.getElementById("docModal").classList.remove("hidden"); document.body.style.overflow="hidden";
  try {
    if(id==="boletim"){
      mostrarCarregando("Montando boletim...");
      alunoAtual.disciplinas=await buscarBoletim(alunoAtual);
      ocultarCarregando();
    }
    document.getElementById("modalBody").innerHTML=gerarConteudoDocumento(id);
  } catch(err) {
    ocultarCarregando();
    document.getElementById("modalBody").innerHTML=`<div class="data-error"><h3>Não foi possível emitir o documento</h3><p>${escapeHTML(err.message||"Falha na consulta ao sistema.")}</p><p>Confira a conexão e tente novamente.</p></div>`;
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

  aluno._turma = turma;
  aluno.totalFaltas = rows.reduce((s, r) => s + r.faltas, 0);
  return rows;
}

function closeModal() {
  document.getElementById("docModal").classList.add("hidden");
  document.body.style.overflow = "";
  documentoAtual = null;
}

function gerarConteudoDocumento(id) {
  const a = alunoAtual;
  const dataEmissao = formatarDataHoje();
  if (id !== "boletim") {
    return `<div class="doc-print" id="docPrintArea"><p>Serviço disponível: somente boletim escolar.</p></div>`;
  }

  const t = a._turma || {};
  const discs = a.disciplinas || [];
  const cel = (v) => (v == null || v === "" ? "—" : (typeof v === "number" ? Number(v).toFixed(1).replace(".", ",") : v));
  const rows = discs.map(d => {
    return `<tr>
      <td class="disc">${escapeHTML(d.nome)}</td>
      ${["1","2","3","4"].map(b => `
        <td>${cel(d["b"+b])}</td>
        <td>${d["f"+b] != null && Number(d["f"+b]) !== 0 ? Number(d["f"+b]) : "—"}</td>
      `).join("")}
      <td>${cel(d.ma)}</td>
      <td>${cel(d.mf)}</td>
      <td>${d.faltas || "—"}</td>
    </tr>`;
  }).join("");
  const totalFaltas = discs.reduce((s, d) => s + Number(d.faltas || 0), 0);
  let freq;
  if (a.frequenciaGeral != null && a.frequenciaGeral !== "") {
    freq = `${a.frequenciaGeral}%`;
  } else if (totalFaltas > 0 && discs.length) {
    freq = Math.max(0, Math.round(100 - (totalFaltas / Math.max(discs.length * 20, 1)) * 100)) + "%";
  } else {
    freq = "100%";
  }
  const escolaNome = a.escola && a.escola !== "Unidade escolar"
    ? a.escola
    : "COLÉGIO ESTADUAL MARIA DO CARMO LIMA — CÓD. 520";

  return `<div class="doc-print bol-oficial bol-anim" id="docPrintArea">
    <div class="bol-cab">
      <img src="brasao-goias.svg" alt="Goiás" onerror="this.style.display='none'" />
      <div class="esq">
        <h1>ESTADO DE GOIÁS</h1>
        <p>SECRETARIA DE ESTADO DA EDUCAÇÃO</p>
        <p>${escapeHTML(escolaNome)}</p>
      </div>
      <div class="dir">
        <h2>BOLETIM ESCOLAR</h2>
        <p>${escapeHTML(t.composicao || a.composicao || "Ensino Médio")}</p>
        <p>ANO: ${escapeHTML(a.anoLetivo || ANO_LETIVO)}</p>
      </div>
    </div>
    <div class="bol-dados">
      <div><strong>NOME DO ALUNO(A):</strong> ${escapeHTML(a.nome)}</div>
      <div><strong>SEXO:</strong> ${escapeHTML(a.sexo || "—")}</div>
      <div><strong>N. CHAM.:</strong> ${escapeHTML(a.nCham ?? "—")}</div>
      <div><strong>MATRÍCULA:</strong> ${escapeHTML(a.matricula)}</div>
      <div><strong>CÓD. INEP:</strong> ${escapeHTML(a.inep || "—")}</div>
      <div><strong>EMISSÃO:</strong> ${dataEmissao}</div>
      <div><strong>TURNO:</strong> ${escapeHTML(a.turno || t.turno || "—")}</div>
      <div><strong>TURMA:</strong> ${escapeHTML(t.nome || a.turma || "—")}</div>
      <div><strong>SÉRIE:</strong> ${escapeHTML(t.serie || a.serie || "—")}</div>
    </div>
    <table class="bol-table">
      <thead>
        <tr>
          <th rowspan="2">COMPONENTES CURRICULARES</th>
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
      <tbody>${rows}</tbody>
    </table>
    <div class="bol-rodape">
      <div><strong>% Frequência</strong>${freq}</div>
      <div><strong>Total de Faltas</strong>${totalFaltas || "0"}</div>
      <div><strong>Faltas Justificadas</strong>—</div>
      <div><strong>Resultado Final</strong>${escapeHTML(a.situacao || "Cursando")}</div>
    </div>
  </div>`;
}


function printDocument() {
  const area = document.getElementById("docPrintArea");
  if (!area) return;
  const isBoletim = area.classList.contains("bol-oficial");
  const pageSize = isBoletim ? "A4 landscape" : "A4 portrait";
  const printWindow = window.open("", "_blank");
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Boletim Escolar — Pequi Express</title>
      <style>
        @page { size: ${pageSize}; margin: 6mm; }
        body { font-family: Arial, Helvetica, sans-serif; margin: 0; color: #111; font-size: 11px; }
        table { border-collapse: collapse; width: 100%; }
        img { max-height: 52px; width: auto; }
        .bol-oficial { max-width: none; border: none; padding: 2mm 4mm; font-size: 8.5pt; }
        .bol-cab { display: flex; align-items: flex-start; gap: 12px; border-bottom: 2px solid #1a5f9e; padding-bottom: 8px; margin-bottom: 8px; }
        .bol-cab .esq { flex: 1; } .bol-cab .dir { text-align: right; flex: 1; }
        .bol-cab h1 { font-size: 11pt; color: #0d3a66; margin: 0 0 2px; }
        .bol-cab h2 { font-size: 10pt; margin: 0; color: #0d3a66; }
        .bol-cab p { margin: 0; font-size: 8pt; color: #444; }
        .bol-dados { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 2px 10px; margin-bottom: 6px; font-size: 8pt; }
        .bol-table th, .bol-table td { border: 1px solid #333; padding: 1px 2px; text-align: center; font-size: 7.5pt; }
        .bol-table th { background: #e8eef5; }
        .bol-table td.disc { text-align: left; font-weight: 600; }
        .bol-rodape { display: grid; grid-template-columns: repeat(4,1fr); border: 1px solid #333; font-size: 8pt; margin-top: 4px; }
        .bol-rodape div { border-right: 1px solid #333; padding: 3px 4px; text-align: center; }
        .bol-rodape div:last-child { border-right: none; }
        .bol-rodape strong { display: block; font-size: 7.5pt; color: #555; }
      </style>
    </head>
    <body>${area.innerHTML}</body>
    </html>
  `);
  printWindow.document.close();
  setTimeout(() => printWindow.print(), 350);
  showToast("Documento pronto para impressão / PDF");
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
