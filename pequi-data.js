/**
 * Pequi Express — Portal escolar do Estado de Goiás
 */
const FIREBASE_DATABASE_URL = "https://siap-f9cbb-default-rtdb.firebaseio.com";
const ANO_LETIVO = "2026";
const USE_MOCK_DATA = false;
const ALUNOS = [];

/** Somente documentos oficiais com autenticação */
const DOCUMENTOS = [
  {
    id: "boletim",
    titulo: "Boletim Escolar",
    descricao: "Notas, faltas e médias do ano letivo — modelo oficial",
    cor: "#0f7a4f",
    acao: "Emitir boletim →",
    tipo: "documento"
  },
  {
    id: "declaracao-matricula",
    titulo: "Comprovante de Matrícula",
    descricao: "Declaração de vínculo escolar com autenticação",
    cor: "#166534",
    acao: "Emitir comprovante →",
    tipo: "documento"
  },
  {
    id: "frequencia-anual",
    titulo: "Declaração de Frequência",
    descricao: "Percentual anual e identificação do aluno, no padrão de secretaria",
    cor: "#1a9b65",
    acao: "Emitir frequência →",
    tipo: "documento"
  },
  {
    id: "claria-ajuda",
    titulo: "ClarIA — Assistente",
    descricao: "Dúvidas do sistema e organização de estudos",
    cor: "#22c55e",
    acao: "Abrir →",
    tipo: "assistente"
  }
];

function calcularMedia(d) {
  const vals = [d.b1, d.b2, d.b3, d.b4].filter(v => v !== null && v !== undefined && v !== "");
  if (!vals.length) return "—";
  return (vals.reduce((s, v) => s + Number(v), 0) / vals.length).toFixed(1).replace(".", ",");
}

function situacaoDisciplina(media) {
  const n = Number(String(media).replace(",", "."));
  if (!Number.isFinite(n)) return "Sem notas";
  return n >= 6 ? "Aprovado" : n >= 4 ? "Recuperação" : "Reprovado";
}

async function dbGet(path) {
  const url = FIREBASE_DATABASE_URL + "/" + path.replace(/^\/+|\/+$/g, "") + ".json";
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) {
    throw new Error(
      response.status === 401 || response.status === 403
        ? "Acesso ao banco de dados negado."
        : "Não foi possível consultar o sistema (" + response.status + ")."
    );
  }
  return response.json();
}

const sigepGet = dbGet;
const SIGEP_ANO_LETIVO = ANO_LETIVO;

function formatarData(value) {
  if (!value) return "—";
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-");
    return `${d}/${m}/${y}`;
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  return s;
}

function formatarDataHoje() {
  return new Date().toLocaleDateString("pt-BR");
}

function formatarCPF(v) {
  const d = String(v || "").replace(/\D/g, "").slice(0, 11);
  if (d.length !== 11) return v || "—";
  return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

/** Código único PE-XXXXXX */
function gerarCodigoAutenticacao() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  const arr = new Uint32Array(6);
  if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(arr);
  else for (let i = 0; i < 6; i++) arr[i] = Math.floor(Math.random() * 256);
  for (let i = 0; i < 6; i++) s += chars[arr[i] % chars.length];
  return "PE-" + s;
}

function qrUrl(data) {
  return "https://api.qrserver.com/v1/create-qr-code/?size=120x120&margin=2&data=" + encodeURIComponent(data);
}
