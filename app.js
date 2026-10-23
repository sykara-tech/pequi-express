/**
 * Pequi Express — Portal de Boletim Escolar
 */

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
      if (section === "servicos" && !alunoAtual) {
        showToast("Faça login para acessar os serviços");
        return;
      }
      if (section === "servicos") {
        showSection("dashboard");
      } else {
        showSection(section);
      }
      document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
      link.classList.add("active");
    });
  });

  document.getElementById("loginForm").addEventListener("submit", handleLogin);

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
  if (alunoAtual) showSection("dashboard");
  else showSection("home");
}

// ===== Login (mock ou Firebase) =====
async function handleLogin(e) {
  e.preventDefault();
  const matricula=document.getElementById("matricula").value.trim();
  const dataNasc=document.getElementById("dataNascimento").value;
  const errorEl=document.getElementById("loginError");
  const btn=document.getElementById("btnAcessar");
  const btnText=btn.querySelector(".btn-text"), btnLoader=btn.querySelector(".btn-loader");
  errorEl.classList.add("hidden"); btnText.classList.add("hidden"); btnLoader.classList.remove("hidden"); btn.disabled=true;
  try {
    if (!matricula || !dataNasc) throw new Error("Informe a matrícula e a data de nascimento.");
    // O SIGEP usa Realtime Database e guarda os alunos em siap/alunos/{id}.
    const registros=await dbGet("siap/alunos");
    const par=Object.entries(registros||{}).find(([id,a]) =>
      a && String(a.matricula||"").trim()===matricula &&
      normalizarDataISO(a.dataNascimento)===dataNasc
    );
    if(!par) throw new Error("Não foi possível validar os dados. Confira a matrícula e a data de nascimento com a escola.");
    const [id,raw]=par;
    const turmaId=raw.turma || raw.turmaId || "";
    const turmas=await dbGet("siap/turmas").catch(()=>({}));
    const turma=turmas?.[turmaId]||{};
    alunoAtual={
      ...raw,id,matricula:raw.matricula||id,
      turmaId, turma:turma.nome||raw.turmaNome||turmaId||"—",
      turno:raw.turno||turma.turno||"—", serie:raw.serie||turma.serie||"—",
      composicao:raw.composicao||turma.composicao||turma.serie||"—",
      anoLetivo:raw.ano||ANO_LETIVO,
      escola:raw.escolaNome||raw.escola||"Unidade escolar",
      inep:raw.inep||raw.codigoEscola||"—", municipio:raw.municipio||"—", uf:"GO",
      situacao:raw.status||raw.situacao||"Matriculado",
      dataNascimento:raw.dataNascimento||"", disciplinas:[],
      frequenciaGeral:raw.frequenciaGeral??null,totalAulas:raw.totalAulas??null,totalFaltas:raw.totalFaltas??null
    };
    entrarDashboard(alunoAtual);
  } catch(err) {
    console.error(err); errorEl.textContent=err.message||"Erro ao consultar o sistema. Tente novamente."; errorEl.classList.remove("hidden");
  } finally {btnText.classList.remove("hidden");btnLoader.classList.add("hidden");btn.disabled=false;}
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

function logout() {
  alunoAtual = null;
  document.getElementById("userBadge").classList.add("hidden");
  document.getElementById("loginForm").reset();
  showSection("home");
  document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
  document.querySelector('.nav-link[data-section="home"]').classList.add("active");
  showToast("Você saiu do portal");
}

// ===== Documentos =====
async function abrirDocumento(id) {
  if(!alunoAtual)return;
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
  const [turmas,disciplinas,vinculos]=await Promise.all([
    dbGet("siap/turmas"),dbGet("siap/disciplinas"),dbGet("siap/vinculos")
  ]);
  const turmaId=String(aluno.turmaId||aluno.turma||"");
  const ids=new Set();
  Object.values(vinculos||{}).forEach(v=>{if(String(v?.turmaId)===turmaId&&v.disciplinaId)ids.add(v.disciplinaId);});
  const turma=turmas?.[turmaId]||{};
  if(Array.isArray(turma.disciplinas))turma.disciplinas.forEach(id=>ids.add(id));
  const list=[...ids].map(id=>disciplinas?.[id]).filter(Boolean).sort((a,b)=>String(a.nome).localeCompare(String(b.nome),"pt-BR"));
  if(!list.length)throw new Error("Não há disciplinas vinculadas à turma deste aluno.");
  const alunoId=aluno.id;
  const rows=[];
  for(const disc of list){
    const row={nome:disc.nome,b1:null,b2:null,b3:null,b4:null,f1:null,f2:null,f3:null,f4:null,ma:null,mf:null,faltas:0};
    for(const bim of ["1","2","3","4"]){
      const slug=String(disc.id||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g,"").replace(/[^a-zA-Z0-9]/g,"");
      const path=`siap/arquivos_anuais/${ANO_LETIVO}/turmas/${encodeURIComponent(turmaId)}/disciplinas/${slug}/bimestre_${bim}/diario`;
      let data;
      try{data=await dbGet(path);}catch(e){throw new Error("Falha ao ler o diário de "+disc.nome+" ("+bim+"º bimestre). "+e.message);}
      const rec=data?.alunos?.[alunoId];
      if(rec){
        row["b"+bim]=rec.media_final??rec.media_bimestral??null;
        row["f"+bim]=rec.faltas??0;
        row.faltas+=Number(rec.faltas||0);
      }
    }
    if(["b1","b2","b3","b4"].some(k=>row[k]!=null)){
      row.ma=["b1","b2","b3","b4"].reduce((sum,k)=>sum+(row[k]!=null?Number(row[k]):0),0)/4;
      row.mf=row.ma;
    }
    rows.push(row);
  }
  aluno._turma=turma;
  aluno.totalFaltas=rows.reduce((s,r)=>s+r.faltas,0);
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
