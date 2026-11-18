// ============================================
// ClarIA Widget — Pequi Express (Governo de Goiás)
// ============================================

(function () {
  const state = {
    open: false,
    messages: [],
    loading: false,
    lastReply: "",
    voice: { selected: null, rate: 1, pitch: 1, autoSpeak: false }
  };

  let db = null;

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function loadVoicePrefs() {
    try {
      const raw = localStorage.getItem("claria_voice_pequi");
      if (raw) state.voice = { ...state.voice, ...JSON.parse(raw) };
    } catch {}
  }

  function saveVoicePrefs() {
    try {
      localStorage.setItem("claria_voice_pequi", JSON.stringify(state.voice));
    } catch {}
  }

  function getUser() {
    try {
      const flag = localStorage.getItem(CLARIA_CONFIG.GOID_LOGOUT_FLAG);
      if (flag) return null;
      const raw = localStorage.getItem(CLARIA_CONFIG.GOID_SESSION_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && (!s.exp || Date.now() <= s.exp)) return s;
      }
      const sso =
        localStorage.getItem(CLARIA_CONFIG.GOID_SSO_KEY) ||
        sessionStorage.getItem(CLARIA_CONFIG.GOID_SSO_KEY);
      if (sso) {
        const t = JSON.parse(sso);
        if (t && (!t.exp || Date.now() <= t.exp)) return t;
      }
    } catch {}
    return null;
  }

  function userKey() {
    const u = getUser();
    return u?.goId || u?.id || "anon";
  }

  function initFirebase() {
    try {
      if (typeof firebase !== "undefined" && CLARIA_CONFIG.FIREBASE_URL) {
        if (!firebase.apps.length) {
          firebase.initializeApp({ databaseURL: CLARIA_CONFIG.FIREBASE_URL });
        }
        db = firebase.database();
      }
    } catch (e) {
      console.warn("[ClarIA]", e.message);
    }
  }

  function injectUI() {
    if ($("#clariaFab")) return;

    const fab = document.createElement("button");
    fab.id = "clariaFab";
    fab.className = "claria-fab";
    fab.type = "button";
    fab.title = "ClarIA — Assistente Pequi Express";
    fab.setAttribute("aria-label", "Abrir ClarIA");
    fab.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <span class="claria-fab-badge" id="clariaBadge">1</span>
    `;

    const panel = document.createElement("div");
    panel.id = "clariaPanel";
    panel.className = "claria-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "ClarIA");
    panel.innerHTML = `
      <div class="claria-header">
        <div class="claria-header-orb" aria-hidden="true"></div>
        <div class="claria-header-text">
          <strong>ClarIA</strong>
          <span>Pequi Express · Governo de Goiás</span>
        </div>
        <div class="claria-header-actions">
          <button type="button" class="claria-hdr-btn" id="clariaVoiceBtn" title="Voz">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            </svg>
          </button>
          <button type="button" class="claria-hdr-btn" id="clariaCloseBtn" title="Fechar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="claria-messages" id="clariaMessages">
        <div class="claria-welcome" id="clariaWelcome">
          <p>Olá! Sou a <strong>ClarIA</strong>, assistente do Pequi Express. Posso ajudar com o boletim, o GO ID e também com organização de estudos e vida pessoal.</p>
          <div class="claria-chips">
            <button type="button" class="claria-chip" data-q="Como consulto meu boletim no Pequi Express?">Como ver o boletim?</button>
            <button type="button" class="claria-chip" data-q="Como recupero a senha do GO ID?">Recuperar senha GO ID</button>
            <button type="button" class="claria-chip" data-q="Me ajude a montar um plano de estudos para melhorar as notas">Plano de estudos</button>
            <button type="button" class="claria-chip" data-q="O que significa média e situação de recuperação?">Médias e recuperação</button>
          </div>
        </div>
      </div>
      <div class="claria-input-area">
        <div class="claria-input-row">
          <textarea id="clariaInput" rows="1" placeholder="Pergunte à ClarIA..." aria-label="Mensagem"></textarea>
          <button type="button" class="claria-speak" id="clariaSpeak" title="Ouvir" disabled>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            </svg>
          </button>
          <button type="button" class="claria-send" id="clariaSend" title="Enviar" disabled>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
        <p class="claria-foot">ClarIA · Pequi Express · Governo de Goiás · Sykara</p>
      </div>
    `;

    const voiceModal = document.createElement("div");
    voiceModal.id = "clariaVoiceModal";
    voiceModal.className = "claria-voice-modal";
    voiceModal.innerHTML = `
      <div class="claria-voice-box">
        <h3>Voz da ClarIA</h3>
        <label for="clariaVoiceSelect">Voz</label>
        <select id="clariaVoiceSelect"></select>
        <label>Velocidade: <span id="clariaRateVal">1.0</span></label>
        <input type="range" id="clariaRate" min="0.6" max="1.4" step="0.1" value="1" />
        <label>Tom: <span id="clariaPitchVal">1.0</span></label>
        <input type="range" id="clariaPitch" min="0.7" max="1.3" step="0.1" value="1" />
        <label style="display:flex;align-items:center;gap:8px;font-weight:500;margin-top:12px">
          <input type="checkbox" id="clariaAutoSpeak" />
          Falar respostas automaticamente
        </label>
        <div class="claria-voice-actions">
          <button type="button" class="claria-btn-cancel" id="clariaVoiceCancel">Cancelar</button>
          <button type="button" class="claria-btn-ok" id="clariaVoiceOk">Salvar</button>
        </div>
      </div>
    `;

    document.body.appendChild(fab);
    document.body.appendChild(panel);
    document.body.appendChild(voiceModal);

    fab.addEventListener("click", togglePanel);
    $("#clariaCloseBtn").addEventListener("click", closePanel);
    $("#clariaSend").addEventListener("click", send);
    $("#clariaSpeak").addEventListener("click", () => {
      if ($("#clariaSpeak").classList.contains("speaking")) stopSpeak();
      else if (state.lastReply) speak(state.lastReply);
    });
    $("#clariaVoiceBtn").addEventListener("click", openVoiceModal);
    $("#clariaVoiceCancel").addEventListener("click", () =>
      $("#clariaVoiceModal").classList.remove("open")
    );
    $("#clariaVoiceOk").addEventListener("click", saveVoiceModal);

    const input = $("#clariaInput");
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 100) + "px";
      $("#clariaSend").disabled = !input.value.trim() || state.loading;
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });

    panel.querySelectorAll(".claria-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        input.value = btn.dataset.q || "";
        $("#clariaSend").disabled = false;
        send();
      });
    });

    $("#clariaRate").addEventListener("input", (e) => {
      $("#clariaRateVal").textContent = parseFloat(e.target.value).toFixed(1);
    });
    $("#clariaPitch").addEventListener("input", (e) => {
      $("#clariaPitchVal").textContent = parseFloat(e.target.value).toFixed(1);
    });

    // badge de novidade na primeira visita
    if (!localStorage.getItem("claria_seen_pequi")) {
      $("#clariaBadge")?.classList.add("show");
    }
  }

  function togglePanel() {
    state.open ? closePanel() : openPanel();
  }

  function openPanel() {
    state.open = true;
    $("#clariaPanel")?.classList.add("open");
    $("#clariaFab")?.classList.add("open");
    localStorage.setItem("claria_seen_pequi", "1");
    $("#clariaBadge")?.classList.remove("show");
    setTimeout(() => $("#clariaInput")?.focus(), 200);
  }

  function closePanel() {
    state.open = false;
    $("#clariaPanel")?.classList.remove("open");
    $("#clariaFab")?.classList.remove("open");
  }

  function formatMd(text) {
    if (!text) return "";
    let h = String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    h = h.replace(/\*(.+?)\*/g, "<em>$1</em>");
    h = h.replace(/^- (.+)$/gm, "<li>$1</li>");
    h = h.replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>");
    h = h.replace(/\n\n/g, "</p><p>");
    h = h.replace(/\n/g, "<br>");
    return `<p>${h}</p>`;
  }

  function appendMsg(role, content, typing) {
    const box = $("#clariaMessages");
    const welcome = $("#clariaWelcome");
    if (welcome) welcome.style.display = "none";

    const div = document.createElement("div");
    div.className = `claria-msg ${role}`;
    const av = document.createElement("div");
    av.className = "claria-msg-avatar";
    av.textContent = role === "user" ? "EU" : "IA";
    const bubble = document.createElement("div");
    bubble.className = "claria-msg-bubble";
    if (typing) {
      bubble.innerHTML =
        '<div class="claria-typing"><span></span><span></span><span></span></div>';
    } else {
      bubble.innerHTML = formatMd(content);
    }
    div.appendChild(av);
    div.appendChild(bubble);
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    return div;
  }

  function contextExtra() {
    // Se o Pequi já tiver aluno logado, injeta contexto (sem inventar notas)
    try {
      if (typeof alunoAtual !== "undefined" && alunoAtual) {
        const a = alunoAtual;
        return (
          "\n\n[Contexto da sessão do aluno no Pequi Express — use só se ajudar; não invente notas]\n" +
          `Nome: ${a.nome || "—"}\n` +
          `Matrícula: ${a.matricula || "—"}\n` +
          `Turma: ${a.turma || a.turmaNome || "—"}\n` +
          `Escola: ${a.escola || a.escolaNome || "—"}\n` +
          `Ano letivo: ${typeof ANO_LETIVO !== "undefined" ? ANO_LETIVO : "2026"}`
        );
      }
    } catch {}
    return "";
  }

  async function callGroq(msgs) {
    const system = CLARIA_SYSTEM_PROMPT + contextExtra();
    const payload = {
      model: CLARIA_CONFIG.GROQ_MODEL,
      messages: [
        { role: "system", content: system },
        ...msgs.map((m) => ({ role: m.role, content: m.content }))
      ],
      temperature: 0.65,
      max_tokens: 1800,
      stream: false
    };
    const res = await fetch(CLARIA_CONFIG.GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CLARIA_CONFIG.GROQ_API_KEY}`
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      let msg = `Erro ${res.status}`;
      try {
        const j = await res.json();
        msg = j.error?.message || msg;
      } catch {}
      throw new Error(msg);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "Não consegui gerar uma resposta.";
  }

  async function send() {
    const input = $("#clariaInput");
    const text = input?.value.trim();
    if (!text || state.loading) return;

    input.value = "";
    input.style.height = "auto";
    $("#clariaSend").disabled = true;
    state.loading = true;
    stopSpeak();

    state.messages.push({ role: "user", content: text });
    appendMsg("user", text);
    const typing = appendMsg("assistant", "", true);

    try {
      const reply = await callGroq(state.messages);
      typing.remove();
      state.messages.push({ role: "assistant", content: reply });
      appendMsg("assistant", reply);
      state.lastReply = reply;
      $("#clariaSpeak").disabled = false;
      saveHistory();
      if (state.voice.autoSpeak) speak(reply);
    } catch (err) {
      typing.remove();
      const msg = `Desculpe, ocorreu um erro: ${err.message}. Tente novamente em instantes.`;
      state.messages.push({ role: "assistant", content: msg });
      appendMsg("assistant", msg);
    } finally {
      state.loading = false;
      input?.focus();
    }
  }

  function saveHistory() {
    try {
      const key = "claria_hist_" + userKey();
      localStorage.setItem(
        key,
        JSON.stringify({ messages: state.messages.slice(-40), at: Date.now() })
      );
    } catch {}
    if (!db) return;
    try {
      db.ref(`clarIA/pequi/${userKey()}/last`).set({
        messages: state.messages.slice(-20),
        updatedAt: Date.now()
      });
    } catch {}
  }

  function loadHistory() {
    try {
      const key = "claria_hist_" + userKey();
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data?.messages?.length) {
        state.messages = data.messages;
        const welcome = $("#clariaWelcome");
        if (welcome) welcome.style.display = "none";
        data.messages.forEach((m) => appendMsg(m.role, m.content));
        const last = data.messages[data.messages.length - 1];
        if (last?.role === "assistant") {
          state.lastReply = last.content;
          $("#clariaSpeak").disabled = false;
        }
      }
    } catch {}
  }

  /* TTS */
  function voices() {
    if (!window.speechSynthesis) return [];
    return speechSynthesis
      .getVoices()
      .filter((v) => v.lang.startsWith("pt") || v.lang.startsWith("en"));
  }

  function populateVoices() {
    const sel = $("#clariaVoiceSelect");
    if (!sel) return;
    const list = voices();
    sel.innerHTML = "";
    if (!list.length) {
      sel.innerHTML = "<option>Nenhuma voz disponível</option>";
      return;
    }
    list.forEach((v, i) => {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = `${v.name} (${v.lang})`;
      if (state.voice.selected === v.name) opt.selected = true;
      sel.appendChild(opt);
    });
    if (!state.voice.selected) {
      const pt =
        list.find((v) => v.lang.startsWith("pt-BR")) ||
        list.find((v) => v.lang.startsWith("pt")) ||
        list[0];
      if (pt) state.voice.selected = pt.name;
    }
  }

  function speak(text) {
    if (!window.speechSynthesis || !text) return;
    stopSpeak();
    const clean = text.replace(/[*#`_~\[\]]/g, " ").replace(/\s+/g, " ").trim();
    const u = new SpeechSynthesisUtterance(clean);
    const list = voices();
    const v = list.find((x) => x.name === state.voice.selected) || list[0];
    if (v) u.voice = v;
    u.rate = state.voice.rate || 1;
    u.pitch = state.voice.pitch || 1;
    u.lang = v?.lang || "pt-BR";
    u.onstart = () => $("#clariaSpeak")?.classList.add("speaking");
    u.onend = () => $("#clariaSpeak")?.classList.remove("speaking");
    u.onerror = () => $("#clariaSpeak")?.classList.remove("speaking");
    speechSynthesis.speak(u);
  }

  function stopSpeak() {
    if (window.speechSynthesis) speechSynthesis.cancel();
    $("#clariaSpeak")?.classList.remove("speaking");
  }

  function openVoiceModal() {
    populateVoices();
    $("#clariaRate").value = state.voice.rate;
    $("#clariaRateVal").textContent = Number(state.voice.rate).toFixed(1);
    $("#clariaPitch").value = state.voice.pitch;
    $("#clariaPitchVal").textContent = Number(state.voice.pitch).toFixed(1);
    $("#clariaAutoSpeak").checked = !!state.voice.autoSpeak;
    $("#clariaVoiceModal").classList.add("open");
  }

  function saveVoiceModal() {
    const list = voices();
    const idx = parseInt($("#clariaVoiceSelect")?.value, 10);
    if (!Number.isNaN(idx) && list[idx]) state.voice.selected = list[idx].name;
    state.voice.rate = parseFloat($("#clariaRate")?.value) || 1;
    state.voice.pitch = parseFloat($("#clariaPitch")?.value) || 1;
    state.voice.autoSpeak = !!$("#clariaAutoSpeak")?.checked;
    saveVoicePrefs();
    $("#clariaVoiceModal").classList.remove("open");
  }

  function boot() {
    loadVoicePrefs();
    initFirebase();
    injectUI();
    loadHistory();
    if (window.speechSynthesis) {
      speechSynthesis.onvoiceschanged = populateVoices;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // API pública mínima
  window.ClarIA = {
    open: openPanel,
    close: closePanel,
    ask(q) {
      openPanel();
      const input = $("#clariaInput");
      if (input) {
        input.value = q;
        $("#clariaSend").disabled = false;
        send();
      }
    }
  };
})();
