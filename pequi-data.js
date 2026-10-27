/**
 * Pequi Express — conexão com o banco de dados escolar.
 * Não mantém alunos de demonstração nem cria notas fictícias.
 */
const FIREBASE_DATABASE_URL = "https://siap-f9cbb-default-rtdb.firebaseio.com";
const ANO_LETIVO = "2026";
const USE_MOCK_DATA = false;
const ALUNOS = [];
const DOCUMENTOS = [
  {id:"boletim",titulo:"Boletim Escolar",descricao:"Notas, faltas e médias do ano letivo",cor:"#166534"}
];
function calcularMedia(d) {
  const vals=[d.b1,d.b2,d.b3,d.b4].filter(v=>v!==null&&v!==undefined&&v!=="");
  if(!vals.length)return "—";
  return (vals.reduce((s,v)=>s+Number(v),0)/vals.length).toFixed(1).replace(".",",");
}
function situacaoDisciplina(media) {
  const n=Number(String(media).replace(",",".")); if(!Number.isFinite(n))return "Sem notas";
  return n>=6?"Aprovado":n>=4?"Recuperação":"Reprovado";
}
async function dbGet(path) {
  const url=FIREBASE_DATABASE_URL+"/"+path.replace(/^\/+|\/+$/g,"")+".json";
  const response=await fetch(url,{headers:{Accept:"application/json"},cache:"no-store"});
  if(!response.ok) throw new Error(response.status===401||response.status===403?"Acesso ao banco de dados negado.":"Não foi possível consultar o sistema ("+response.status+").");
  return response.json();
}
// alias legado
const sigepGet = dbGet;
const SIGEP_ANO_LETIVO = ANO_LETIVO;
function formatarData(value) {
  if(!value)return "—";
  const s=String(value);
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)){const [y,m,d]=s.split("-");return `${d}/${m}/${y}`;}
  if(/^\d{2}\/\d{2}\/\d{4}$/.test(s))return s;
  return s;
}
function formatarDataHoje(){return new Date().toLocaleDateString("pt-BR");}
function gerarCodigoAutenticacao(){return "CONSULTA-"+Date.now().toString(36).toUpperCase();}
