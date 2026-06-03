// ═══════════════════════════════════════════════
//  Автопост — SPA  
// ═══════════════════════════════════════════════

const App = {
  token: localStorage.getItem("ap_token"),
  user: null, cfg: null,
  view: "dashboard",
  channelId: null,
  tab: "queue",
  _chan: null,
  _onboardPosts: null,   // 3 варианта при онбординге
};

const $ = id => document.getElementById(id);
const esc = s => (s||"").replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => (n||0).toLocaleString("ru-RU");
const isMobile = () => window.innerWidth <= 640;

function toast(msg, kind="") {
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const t = document.createElement("div");
  t.className = "toast " + kind; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (App.token) opts.headers["Authorization"] = "Bearer " + App.token;
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch("/api" + path, opts);
  if (res.status === 401) { logout(); throw new Error("Сессия истекла"); }
  let data = null;
  try { data = await res.json(); } catch(_) {}
  if (!res.ok) throw new Error((data && data.detail) || "Ошибка запроса");
  return data;
}

function logout() {
  App.token = null; App.user = null;
  localStorage.removeItem("ap_token");
  renderAuth();
}

async function refreshUser() {
  try { App.user = await api("GET", "/me"); } catch(_) {}
}

async function go(view, channelId) {
  App.view = view;
  if (channelId !== undefined) App.channelId = channelId;
  if (view === "dashboard") return renderDashboard();
  if (view === "new_channel") return renderNewChannel();
  if (view === "channel") return renderChannel();
  if (view === "billing") return renderBilling();
  if (view === "referral") return renderReferral();
}

// ══ AUTH ══════════════════════════════════════
function renderAuth(mode="login") {
  $("app").innerHTML = `
  <div class="auth-wrap">
    <div class="auth-box">
      <div class="auth-logo">Авто<span>пост</span></div>
      <div class="auth-sub">ИИ ведёт твой Telegram-канал на автопилоте</div>
      <div class="card">
        <label class="field">
          <span class="field-label">Email</span>
          <input id="em" type="email" placeholder="you@mail.ru" autocomplete="username">
        </label>
        <label class="field mt">
          <span class="field-label">Пароль</span>
          <input id="pw" type="password" placeholder="минимум 6 символов" autocomplete="current-password">
        </label>
        ${mode==="register" ? `<label class="field mt">
          <span class="field-label">Реферальный код (необязательно)</span>
          <input id="ref" type="text" placeholder="код друга">
        </label>` : ""}
        <button class="btn" style="width:100%;margin-top:18px;justify-content:center" id="authBtn">
          ${mode==="login" ? "Войти" : "Создать аккаунт"}</button>
        <div class="auth-switch">${mode==="login"
          ? `Нет аккаунта? <a id="sw">Зарегистрироваться →</a>`
          : `Уже есть аккаунт? <a id="sw">Войти</a>`}
        </div>
      </div>
    </div>
  </div>`;
  $("authBtn").onclick = async () => {
    const email = $("em").value.trim(), password = $("pw").value;
    if (!email || !password) return toast("Заполните email и пароль", "err");
    const body = {email, password};
    if (mode === "register" && $("ref") && $("ref").value.trim())
      body.ref_code = $("ref").value.trim();
    try {
      const r = await api("POST", mode==="login" ? "/login" : "/register", body);
      App.token = r.token; localStorage.setItem("ap_token", r.token);
      await boot();
    } catch(e) { toast(e.message, "err"); }
  };
  if ($("sw")) $("sw").onclick = () => renderAuth(mode==="login" ? "register" : "login");
  $("pw").onkeydown = e => { if (e.key==="Enter") $("authBtn").click(); };
}

// ══ TOPBAR ════════════════════════════════════
function topbar(backView, backLabel) {
  const low = App.user && App.user.token_balance < 5000;
  const back = backView
    ? `<button class="back-link" onclick="go('${backView}')">← ${backLabel||"назад"}</button>`
    : "";
  return `<div class="topbar">
    <div style="display:flex;align-items:center;gap:12px">
      <a class="brand" onclick="go('dashboard')">
        <span class="brand-name">Авто<span>пост</span></span>
      </a>
      ${back}
    </div>
    <div class="topbar-right">
      <div class="token-pill ${low?"low":""}" onclick="go('billing')" title="Баланс токенов">
        <span class="dot"></span>
        <span class="amount">${fmt(App.user?.token_balance||0)}</span>
        ${!isMobile() ? `<span class="label">токенов</span>` : ""}
      </div>
      <button class="btn-ghost btn-sm" onclick="logout()">Выйти</button>
    </div>
  </div>`;
}

// ══ DASHBOARD ═════════════════════════════════
async function renderDashboard() {
  await refreshUser();
  $("app").innerHTML = topbar() + `<div class="wrap">
    <div class="page-head row between" style="flex-wrap:wrap;gap:12px">
      <div>
        <h1>Твои каналы</h1>
        <p>ИИ пишет посты сам — тебе только выбирать лучший.</p>
      </div>
      <button class="btn" onclick="go('new_channel')">+ Добавить канал</button>
    </div>
    <div class="grid grid-3" id="chans"><div class="text-faint">Загрузка…</div></div>
  </div>`;

  let chans = [];
  try { chans = await api("GET", "/channels"); } catch(e) { toast(e.message, "err"); }

  if (!chans.length) {
    $("chans").innerHTML = `<div class="add-card" onclick="go('new_channel')" style="grid-column:1/-1;max-width:320px">
      <div class="plus">+</div>
      <div style="font-weight:500">Добавить первый канал</div>
      <div style="font-size:13px;color:var(--text-faint);margin-top:4px">Займёт 2 минуты</div>
    </div>`;
    return;
  }

  $("chans").innerHTML = chans.map(c => {
    const verified = c.verified
      ? `<span class="chip chip-green">● подключён</span>`
      : `<span class="chip chip-orange">● не проверен</span>`;
    const sched = c.schedule_kind==="interval"
      ? `каждые ${c.interval_hours}ч` : (c.daily_times||[]).join(", ");
    const nextPost = c.last_generated_at
      ? _nextPostTime(c) : "скоро";
    return `<div class="chan-card" onclick="go('channel',${c.id})">
      <h3>${esc(c.title)}</h3>
      <div class="chan-handle">${esc(c.tg_chat||"канал не указан")}</div>
      <div class="chan-about">${esc(c.about)||"<span class='text-faint'>тема не задана</span>"}</div>
      <div class="chan-foot">
        ${verified}
        <span class="chip chip-gray">🕑 ${esc(sched)}</span>
        <span class="chip chip-blue">⏱ след. ${nextPost}</span>
      </div>
    </div>`;
  }).join("") + `<div class="add-card" onclick="go('new_channel')">
    <div class="plus">+</div>
    <div style="font-size:14px;font-weight:500">Новый канал</div>
  </div>`;
}

function _nextPostTime(c) {
  if (!c.last_generated_at) return "скоро";
  const last = new Date(c.last_generated_at + "Z");
  const next = new Date(last.getTime() + c.interval_hours * 3600000);
  const diff = next - Date.now();
  if (diff <= 0) return "скоро";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `${h}ч ${m}м` : `${m}м`;
}

// ══ NEW CHANNEL ONBOARDING ════════════════════
function renderNewChannel() {
  $("app").innerHTML = topbar("dashboard", "все каналы") + `<div class="wrap" style="max-width:680px">
    <div class="page-head">
      <h1>Новый канал</h1>
      <p>Расскажи о канале — ИИ сразу покажет три варианта постов на выбор.</p>
    </div>

    <div class="card">
      <label class="field">
        <span class="field-label">Название канала (для тебя)</span>
        <input id="nc_title" placeholder="Например: Крипта без воды" maxlength="80">
      </label>

      <label class="field mt">
        <span class="field-label">О чём канал</span>
        <textarea id="nc_about" rows="3" placeholder="Опиши идею своими словами — о чём, для кого, что интересно аудитории"></textarea>
      </label>
      <div class="hint"><b>Примеры:</b><br>
        · <i>Крипта: новости, разбор монет, инвестиционные идеи — для тех кто уже в теме</i><br>
        · <i>Канал про богатых людей — как живут, что покупают, какие сделки делают</i><br>
        · <i>Психология отношений — понятно о сложном, практические советы</i>
      </div>

      <label class="field mt">
        <span class="field-label">Стиль и тон</span>
        <textarea id="nc_style" rows="2" placeholder="Как должен звучать канал — тон, атмосфера, что нельзя"></textarea>
      </label>
      <div class="hint"><b>Примеры:</b><br>
        · <i>Дерзко и по делу, как инсайдер который знает больше других</i><br>
        · <i>Тепло и честно, как умный друг без умничания</i><br>
        · <i>Атмосферно — детали и образы, читатель должен захотеть так жить</i>
      </div>

      <div class="divider"></div>

      <div style="margin-bottom:14px">
        <div class="field-label">Скопировать стиль с существующего канала (необязательно)</div>
        <div class="hint" style="margin:4px 0 8px">Вставь ссылку на публичный канал — ИИ изучит его посты</div>
        <div class="row">
          <input id="nc_ref_chan" placeholder="https://t.me/example">
          <button class="btn-outline btn-sm" onclick="ncAnalyze()" id="nc_an_btn" style="white-space:nowrap">Изучить</button>
        </div>
        <div id="nc_style_preview" class="hidden" style="margin-top:10px;padding:12px;background:var(--surface2);border-radius:10px;border:1px solid var(--border-soft)">
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-faint);margin-bottom:6px">Профиль стиля</div>
          <div id="nc_style_text" style="font-size:13px;color:var(--text-dim);line-height:1.6"></div>
        </div>
      </div>

      <div class="divider"></div>

      <div class="row between" style="flex-wrap:wrap;gap:10px">
        <div style="font-size:13px;color:var(--text-dim)">Частота: каждые
          <select id="nc_interval" style="width:auto;display:inline-block;padding:4px 8px;font-size:13px">
            <option value="6">6 часов</option>
            <option value="12" selected>12 часов</option>
            <option value="24">24 часа</option>
            <option value="48">48 часов</option>
          </select>
        </div>
        <div style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text-dim)">
          <label class="switch" style="transform:scale(.85)">
            <input type="checkbox" id="nc_web" checked>
            <span class="slider"></span>
          </label>
          Искать новости в интернете
        </div>
      </div>
    </div>

    <button class="btn" style="width:100%;justify-content:center;margin-top:16px;padding:14px" 
      onclick="ncGenerate()" id="nc_gen_btn">
      ✦ Сгенерировать три варианта поста
    </button>

    <div id="nc_results" class="hidden" style="margin-top:24px"></div>
  </div>`;
}

let _ncStyleProfile = "";

async function ncAnalyze() {
  const link = $("nc_ref_chan").value.trim();
  if (!link) return;
  const btn = $("nc_an_btn");
  btn.innerHTML = '<span class="spinner"></span>';
  btn.disabled = true;
  try {
    // Временно создаём канал для анализа стиля
    const r = await api("POST", "/analyze_style_only", { link });
    _ncStyleProfile = r.profile || "";
    $("nc_style_text").textContent = _ncStyleProfile;
    $("nc_style_preview").classList.remove("hidden");
    toast("Стиль изучен — учтём при генерации", "ok");
  } catch(e) {
    toast("Не удалось прочитать канал. Он должен быть публичным.", "err");
  }
  btn.innerHTML = "Изучить"; btn.disabled = false;
}

async function ncGenerate() {
  const title = ($("nc_title").value || "").trim() || "Новый канал";
  const about = ($("nc_about").value || "").trim();
  const style = ($("nc_style").value || "").trim();
  if (!about) { toast("Опишите тему канала", "err"); return; }

  const btn = $("nc_gen_btn");
  btn.innerHTML = '<span class="spinner"></span> Генерирую три варианта…';
  btn.disabled = true;

  // Создаём канал
  let chan;
  try {
    chan = await api("POST", "/channels", {
      title, about, style,
      interval_hours: parseInt($("nc_interval").value),
      use_web_search: $("nc_web").checked,
      style_profile: _ncStyleProfile,
    });
  } catch(e) {
    toast(e.message, "err");
    btn.innerHTML = "✦ Сгенерировать три варианта поста";
    btn.disabled = false;
    return;
  }

  // Генерируем 3 варианта разных форматов
  const formats = [
    { key: "story",    label: "История",  desc: "Рассказ с началом и выводом" },
    { key: "tips",     label: "Советы",   desc: "Конкретные шаги и рекомендации" },
    { key: "question", label: "Вопрос",   desc: "Пост-дискуссия для вовлечения" },
  ];

  btn.innerHTML = '<span class="spinner"></span> Пишу посты…';

  const results = [];
  for (const fmt of formats) {
    try {
      const r = await api("POST", `/channels/${chan.id}/generate_format`, { post_format: fmt.key });
      results.push({ ...fmt, text: r.text, post_id: r.post_id, tokens: r.tokens_used });
    } catch(e) {
      results.push({ ...fmt, text: null, error: e.message });
    }
  }

  App._onboardPosts = results;
  App.channelId = chan.id;

  btn.innerHTML = "✦ Сгенерировать три варианта поста";
  btn.disabled = false;

  $("nc_results").classList.remove("hidden");
  $("nc_results").innerHTML = `
    <h2 style="font-family:'Instrument Serif',serif;font-size:24px;font-weight:400;margin-bottom:6px">
      Выбери вариант который понравился
    </h2>
    <p style="color:var(--text-dim);font-size:14px;margin-bottom:20px">
      Выбранный пост попадёт в очередь. Остальные удалятся.
      Потом можно настроить детали в любое время.
    </p>
    ${results.map((r, i) => r.text ? `
    <div class="onboard-card" id="oc_${i}">
      <div class="onboard-header">
        <div>
          <span class="chip chip-blue">${esc(r.label)}</span>
          <span style="font-size:12px;color:var(--text-faint);margin-left:8px">${esc(r.desc)}</span>
        </div>
        <button class="btn btn-sm" onclick="ncSelect(${i})">Выбрать этот →</button>
      </div>
      <div class="post-body" style="margin-top:12px">${esc(r.text)}</div>
    </div>` : `
    <div class="onboard-card" style="opacity:.5">
      <span class="chip chip-gray">${esc(r.label)}</span>
      <p style="color:var(--red);font-size:13px;margin-top:8px">Не удалось: ${esc(r.error||"")}</p>
    </div>`).join("")}
    <div style="text-align:center;margin-top:16px">
      <button class="btn-ghost" onclick="go('channel',${chan.id})" style="font-size:13px">
        Настроить под себя →
        <span style="color:var(--text-faint);font-size:12px;margin-left:4px">голос, формат, автопубликация</span>
      </button>
    </div>`;
}

async function ncSelect(idx) {
  const picked = App._onboardPosts[idx];
  if (!picked || !picked.post_id) return;
  try {
    // Отклоняем остальные
    for (let i = 0; i < App._onboardPosts.length; i++) {
      if (i !== idx && App._onboardPosts[i].post_id) {
        await api("POST", `/posts/${App._onboardPosts[i].post_id}/reject`).catch(() => {});
      }
    }
    // Помечаем канал как прошедший онбординг
    await api("PATCH", `/channels/${App.channelId}`, { onboarded: true });
    toast("Отлично! Канал настроен.", "ok");
    go("channel", App.channelId);
  } catch(e) { toast(e.message, "err"); }
}

// ══ CHANNEL VIEW ══════════════════════════════
async function renderChannel() {
  await refreshUser();
  let c;
  try { c = await api("GET", "/channels/" + App.channelId); }
  catch(e) { toast(e.message, "err"); return go("dashboard"); }
  try { c.daily_times = JSON.parse(c.daily_times || "[]"); } catch(_) { c.daily_times = []; }
  App._chan = c;

  const schedLabel = c.schedule_kind === "interval"
    ? `каждые ${c.interval_hours}ч` : c.daily_times.join(", ");

  $("app").innerHTML = topbar("dashboard", "все каналы") + `<div class="wrap">

    <!-- Шапка канала -->
    <div class="chan-header card" style="margin-bottom:16px">
      <div class="row between" style="flex-wrap:wrap;gap:12px">
        <div>
          <h2 style="font-family:'Instrument Serif',serif;font-size:26px;font-weight:400">${esc(c.title)}</h2>
          <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;align-items:center">
            ${c.verified
              ? `<span class="chip chip-green">● подключён</span>`
              : `<span class="chip chip-orange">● не проверен</span>`}
            <span class="chip chip-gray">🕑 ${esc(schedLabel)}</span>
            <span class="chip chip-gray" style="font-family:monospace">${esc(c.tg_chat||"не указан")}</span>
          </div>
          ${c.about ? `<p style="font-size:13px;color:var(--text-dim);margin-top:8px;max-width:500px">${esc(c.about)}</p>` : ""}
        </div>
        <div style="text-align:right">
          <div id="timer_block"></div>
          <button class="btn btn-sm" style="margin-top:8px" onclick="openGenPanel()">✦ Создать пост</button>
        </div>
      </div>
    </div>

    <!-- Панель генерации -->
    <div class="gen-panel hidden" id="genPanel">
      <div class="gen-title">Задайте тему поста (необязательно)</div>
      <div class="gen-row">
        <input id="genTopic" placeholder="Например: биткоин пробил $80k — что это значит">
        <button class="btn" onclick="generateNow()" id="genRunBtn">Создать</button>
      </div>
      <div class="hint" style="margin-top:6px">Оставьте пустым — ИИ выберет тему сам</div>
    </div>

    <!-- Вкладки -->
    <div class="tabs">
      <button class="tab ${App.tab==="queue"?"active":""}" onclick="setTab('queue')">Очередь постов</button>
      <button class="tab ${App.tab==="settings"?"active":""}" onclick="setTab('settings')">Настройки</button>
      <button class="tab ${App.tab==="advanced"?"active":""}" onclick="setTab('advanced')">Расширенные</button>
      <button class="tab ${App.tab==="sources"?"active":""}" onclick="setTab('sources')">Источники</button>
    </div>
    <div id="tabbody"></div>
  </div>`;

  renderTimer();
  renderTab();
}

function renderTimer() {
  const block = $("timer_block");
  if (!block || !App._chan) return;
  const c = App._chan;
  if (!c.last_generated_at || !c.enabled) {
    block.innerHTML = `<div style="font-size:12px;color:var(--text-faint)">Автогенерация включена</div>`;
    return;
  }
  const last = new Date(c.last_generated_at + "Z");
  const nextMs = last.getTime() + c.interval_hours * 3600000;
  const diff = nextMs - Date.now();
  if (diff <= 0) {
    block.innerHTML = `<div style="font-size:12px;color:var(--green)">⏱ Генерация скоро</div>`;
    return;
  }
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  block.innerHTML = `
    <div style="font-size:11px;color:var(--text-faint);margin-bottom:2px">следующий пост через</div>
    <div style="font-family:'JetBrains Mono',monospace;font-size:22px;font-weight:500;color:var(--accent)">
      ${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}
    </div>`;
  setTimeout(renderTimer, 1000);
}

function openGenPanel() {
  const p = $("genPanel");
  if (!p) return;
  p.classList.toggle("hidden");
  if (!p.classList.contains("hidden")) $("genTopic").focus();
}

function setTab(t) {
  App.tab = t;
  document.querySelectorAll(".tab").forEach(b => {
    const map = {queue:"Очередь постов",settings:"Настройки",advanced:"Расширенные",sources:"Источники"};
    b.classList.toggle("active", b.textContent.trim() === map[t]);
  });
  renderTab();
}

function renderTab() {
  if (App.tab === "queue") return renderQueue();
  if (App.tab === "settings") return renderSettings();
  if (App.tab === "advanced") return renderAdvanced();
  if (App.tab === "sources") return renderSources();
}

// ══ QUEUE TAB ═════════════════════════════════
async function renderQueue() {
  $("tabbody").innerHTML = `<div id="postList"><div class="text-faint" style="padding:20px">Загрузка…</div></div>`;
  let posts = [];
  try { posts = await api("GET", "/channels/" + App._chan.id + "/posts"); } catch(e) {}

  if (!posts.length) {
    $("postList").innerHTML = `<div class="empty">
      <div class="empty-icon">✦</div>
      <h3>Очередь пуста</h3>
      <p>Нажми «Создать пост» — или подожди автогенерацию по расписанию.</p>
    </div>`;
    return;
  }

  const statusChip = {
    pending:    `<span class="chip chip-orange">на проверке</span>`,
    scheduled:  `<span class="chip chip-blue">запланирован</span>`,
    published:  `<span class="chip chip-green">опубликован</span>`,
    rejected:   `<span class="chip chip-gray">отклонён</span>`,
    onboarding: `<span class="chip chip-blue">выбор стиля</span>`,
  };

  $("postList").innerHTML = posts.map(p => {
    const when = new Date(p.created_at + "Z").toLocaleString("ru-RU", {
      day:"numeric", month:"short", hour:"2-digit", minute:"2-digit"
    });
    const sched = p.scheduled_at
      ? `<span class="text-faint mono" style="font-size:11px">⏰ ${new Date(p.scheduled_at+"Z").toLocaleString("ru-RU",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}</span>`
      : "";
    const editable = p.status === "pending" || p.status === "onboarding";
    let actions = "";
    if (p.status === "pending" || p.status === "onboarding") {
      actions = `
        <button class="btn btn-green btn-sm" onclick="publishPost(${p.id})">✓ Опубликовать</button>
        <button class="btn-outline btn-sm" onclick="schedulePrompt(${p.id})">⏰ По времени</button>
        <button class="btn-danger btn-sm" onclick="rejectPost(${p.id})">Удалить</button>`;
    } else if (p.status === "scheduled") {
      actions = `
        <button class="btn btn-green btn-sm" onclick="publishPost(${p.id})">✓ Сейчас</button>
        <button class="btn-danger btn-sm" onclick="rejectPost(${p.id})">Снять</button>`;
    } else {
      actions = `<button class="btn-ghost btn-sm" onclick="deletePost(${p.id})">Удалить</button>`;
    }

    return `<div class="post-card">
      <div class="post-header">
        <div class="row" style="gap:8px;flex-wrap:wrap">
          ${statusChip[p.status]||""}
          <span class="text-faint mono" style="font-size:11px">${when}</span>
          ${sched}
        </div>
        <span class="text-faint mono" style="font-size:11px">${fmt(p.tokens_used)} ток.</span>
      </div>
      ${editable
        ? `<textarea id="pt_${p.id}" class="post-body" style="width:100%;min-height:100px;margin-top:10px">${esc(p.text)}</textarea>`
        : `<div class="post-body" style="margin-top:10px">${esc(p.text)}</div>`}
      <div class="post-actions">
        ${editable ? `<button class="btn-ghost btn-sm" onclick="savePost(${p.id})">💾 Сохранить правки</button>` : ""}
        ${actions}
      </div>
    </div>`;
  }).join("");
}

// ══ SETTINGS TAB ══════════════════════════════
function renderSettings() {
  const c = App._chan;
  const lens = ["50-100 слов", "100-200 слов", "200-350 слов"];
  $("tabbody").innerHTML = `
    <div class="card">
      <div class="card-title">Telegram</div>
      <label class="field"><span class="field-label">Название</span>
        <input id="f_title" value="${esc(c.title)}"></label>
      <label class="field mt"><span class="field-label">@username или ID канала</span>
        <input id="f_chat" value="${esc(c.tg_chat)}" placeholder="@my_channel"></label>
      <div class="hint">Добавь бота <b>@${esc(App.cfg?.bot_username||"…")}</b> как администратора с правом публикации.</div>
      <div class="row mt">
        <button class="btn-outline btn-sm" onclick="verifyChannel()" id="verBtn">Проверить подключение</button>
        <span id="verMsg" class="text-faint" style="font-size:13px"></span>
      </div>
    </div>

    <div class="card">
      <div class="card-title">О канале</div>
      <label class="field"><span class="field-label">Тема</span>
        <textarea id="f_about" rows="3">${esc(c.about)}</textarea></label>
      <label class="field mt"><span class="field-label">Стиль и тон</span>
        <textarea id="f_style" rows="2">${esc(c.style)}</textarea></label>

      <div style="margin-top:16px">
        <div class="field-label">Длина поста</div>
        <div class="seg" style="max-width:400px" id="seg_len">
          ${lens.map(o => `<button class="${c.post_length===o?"on":""}" onclick="pickLen('${o}')">${o}</button>`).join("")}
        </div>
      </div>

      <div style="margin-top:16px">
        <div class="field-label">Скопировать стиль с канала</div>
        <div class="hint" style="margin:4px 0 8px">Ссылка на публичный канал — ИИ изучит посты и будет писать похоже</div>
        <div class="row">
          <input id="f_analyze" placeholder="https://t.me/example">
          <button class="btn-outline btn-sm" onclick="analyzeChannel()" id="anBtn" style="white-space:nowrap">Изучить</button>
        </div>
        <div id="analyze_result"></div>
        ${c.style_profile ? `<div class="hint" style="color:var(--green);margin-top:6px">✓ Профиль стиля сохранён (${c.style_profile.length} симв.)</div>` : ""}
      </div>
    </div>

    <div class="card">
      <div class="card-title">Расписание</div>
      <div class="seg" style="max-width:360px;margin-bottom:16px" id="seg_sched">
        <button class="${c.schedule_kind==="interval"?"on":""}" onclick="pickSched('interval')">Каждые N часов</button>
        <button class="${c.schedule_kind==="daily"?"on":""}" onclick="pickSched('daily')">В заданное время</button>
      </div>
      <div id="sched_interval" class="${c.schedule_kind==="interval"?"":"hidden"}">
        <label class="field"><span class="field-label">Интервал: <b id="ivLbl">${c.interval_hours}</b> ч</span>
          <input id="f_interval" type="range" min="1" max="48" value="${c.interval_hours}"
            oninput="$('ivLbl').textContent=this.value"
            style="padding:4px 0;height:auto;box-shadow:none;border:none;background:none">
        </label>
      </div>
      <div id="sched_daily" class="${c.schedule_kind==="daily"?"":"hidden"}">
        <label class="field"><span class="field-label">Время (UTC, через запятую)</span>
          <input id="f_times" value="${esc((c.daily_times||[]).join(", "))}" placeholder="10:00, 18:00"></label>
        <div class="hint">Москва = UTC+3. Для 13:00 МСК введите 10:00.</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Автоматизация</div>
      <div class="toggle-row">
        <div class="toggle-info">
          <b>Публиковать без проверки</b>
          <small>Посты уходят сразу. Иначе — ждут в очереди.</small>
        </div>
        <label class="switch"><input type="checkbox" id="sw_auto" ${c.auto_publish?"checked":""}><span class="slider"></span></label>
      </div>
      <div class="toggle-row">
        <div class="toggle-info">
          <b>Искать новости в интернете</b>
          <small>ИИ сам найдёт свежую информацию по теме.</small>
        </div>
        <label class="switch"><input type="checkbox" id="sw_web" ${c.use_web_search?"checked":""}><span class="slider"></span></label>
      </div>
    </div>

    <div class="row between mt-lg">
      <button class="btn-danger btn-sm" onclick="deleteChannel()">Удалить канал</button>
      <button class="btn" onclick="saveChannel()">Сохранить</button>
    </div>`;
}

// ══ ADVANCED TAB ══════════════════════════════
function renderAdvanced() {
  const c = App._chan;
  $("tabbody").innerHTML = `
    <div class="card">
      <div class="card-title">Голос автора</div>
      <div class="seg" id="seg_voice">
        <button class="${(c.post_voice||"author")==="author"?"on":""}" onclick="pickOpt('post_voice','author','seg_voice')">От себя</button>
        <button class="${(c.post_voice||"author")==="expert"?"on":""}" onclick="pickOpt('post_voice','expert','seg_voice')">Эксперт</button>
        <button class="${(c.post_voice||"author")==="news"?"on":""}" onclick="pickOpt('post_voice','news','seg_voice')">Новости</button>
      </div>
      <div class="hint mt">
        <b>От себя</b> — «я», личный опыт и мнение &nbsp;·&nbsp;
        <b>Эксперт</b> — авторитетно, без «я» &nbsp;·&nbsp;
        <b>Новости</b> — сухие факты
      </div>
    </div>

    <div class="card">
      <div class="card-title">Формат поста</div>
      <div class="seg" id="seg_format" style="flex-wrap:wrap">
        <button class="${(c.post_format||"story")==="story"?"on":""}" onclick="pickOpt('post_format','story','seg_format')">История</button>
        <button class="${(c.post_format||"story")==="tips"?"on":""}" onclick="pickOpt('post_format','tips','seg_format')">Советы</button>
        <button class="${(c.post_format||"story")==="news"?"on":""}" onclick="pickOpt('post_format','news','seg_format')">Новость</button>
        <button class="${(c.post_format||"story")==="question"?"on":""}" onclick="pickOpt('post_format','question','seg_format')">Вопрос</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Эмодзи</div>
      <div class="seg" id="seg_emoji">
        <button class="${(c.emoji_style||"minimal")==="none"?"on":""}" onclick="pickOpt('emoji_style','none','seg_emoji')">Без эмодзи</button>
        <button class="${(c.emoji_style||"minimal")==="minimal"?"on":""}" onclick="pickOpt('emoji_style','minimal','seg_emoji')">1-2 штуки</button>
        <button class="${(c.emoji_style||"minimal")==="rich"?"on":""}" onclick="pickOpt('emoji_style','rich','seg_emoji')">Активно</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Призыв к действию</div>
      <div class="toggle-row">
        <div class="toggle-info">
          <b>Добавлять в конец каждого поста</b>
          <small>Подписаться, написать в лс, перейти по ссылке…</small>
        </div>
        <label class="switch"><input type="checkbox" id="sw_cta" ${c.cta_enabled?"checked":""} onchange="$('cta_field').classList.toggle('hidden',!this.checked)"><span class="slider"></span></label>
      </div>
      <div id="cta_field" class="${c.cta_enabled?"":"hidden"}" style="margin-top:12px">
        <label class="field"><span class="field-label">Текст призыва</span>
          <input id="f_cta" value="${esc(c.cta_text||"")}" placeholder="Подпишись чтобы не пропустить"></label>
      </div>
    </div>

    <div class="row between mt-lg">
      <div></div>
      <button class="btn" onclick="saveAdvanced()">Сохранить</button>
    </div>`;
}

// ══ SOURCES TAB ═══════════════════════════════
async function renderSources() {
  $("tabbody").innerHTML = `<div class="card">
    <div class="card-title">Источники информации</div>
    <div class="hint" style="margin:0 0 14px">Сайты или RSS которые ИИ просматривает перед написанием поста.</div>
    <div class="row">
      <input id="srcUrl" placeholder="https://example.com или RSS-лента">
      <button class="btn btn-sm" onclick="addSource()">Добавить</button>
    </div>
    <div id="srcList" style="margin-top:12px"></div>
  </div>`;
  await loadSources();
}

async function loadSources() {
  let list = [];
  try { list = await api("GET", "/channels/" + App._chan.id + "/sources"); } catch(_) {}
  const el = $("srcList"); if (!el) return;
  el.innerHTML = list.length
    ? list.map(s => `<div class="src-row">
        <span class="src-url">${esc(s.url)}</span>
        <button class="btn-danger btn-sm" onclick="delSource(${s.id})">Удалить</button>
      </div>`).join("")
    : `<p style="color:var(--text-faint);font-size:13px;padding:8px 0">Нет источников. ИИ ищет информацию сам.</p>`;
}

// ══ ACTIONS ═══════════════════════════════════
function pickLen(o) {
  App._chan.post_length = o;
  document.querySelectorAll("#seg_len button").forEach(b => b.classList.toggle("on", b.textContent===o));
}
function pickSched(k) {
  App._chan.schedule_kind = k;
  $("sched_interval").classList.toggle("hidden", k!=="interval");
  $("sched_daily").classList.toggle("hidden", k!=="daily");
  document.querySelectorAll("#seg_sched button").forEach(b =>
    b.classList.toggle("on", b.textContent===(k==="interval"?"Каждые N часов":"В заданное время")));
}
function pickOpt(field, val, segId) {
  App._chan[field] = val;
  document.querySelectorAll(`#${segId} button`).forEach(b => b.classList.remove("on"));
  event.target.classList.add("on");
}

async function saveChannel() {
  const times = ($("f_times")?$("f_times").value:"").split(",").map(s=>s.trim()).filter(Boolean);
  const payload = {
    title: ($("f_title")||{value:App._chan.title}).value.trim() || App._chan.title,
    tg_chat: ($("f_chat")||{value:""}).value.trim(),
    about: $("f_about") ? $("f_about").value : App._chan.about,
    style: $("f_style") ? $("f_style").value : App._chan.style,
    post_length: App._chan.post_length,
    schedule_kind: App._chan.schedule_kind,
    interval_hours: parseInt(($("f_interval")||{value:App._chan.interval_hours}).value),
    daily_times: times.length ? times : ["10:00"],
    use_web_search: $("sw_web") ? $("sw_web").checked : App._chan.use_web_search,
    auto_publish: $("sw_auto") ? $("sw_auto").checked : App._chan.auto_publish,
  };
  try {
    const updated = await api("PATCH", "/channels/" + App._chan.id, payload);
    App._chan = {...App._chan, ...updated};
    try { App._chan.daily_times = JSON.parse(App._chan.daily_times || "[]"); } catch(_) {}
    toast("Сохранено", "ok");
  } catch(e) { toast(e.message, "err"); }
}

async function saveAdvanced() {
  const payload = {
    post_voice: App._chan.post_voice || "author",
    post_format: App._chan.post_format || "story",
    emoji_style: App._chan.emoji_style || "minimal",
    cta_enabled: $("sw_cta") ? $("sw_cta").checked : false,
    cta_text: ($("f_cta")||{value:""}).value,
  };
  try {
    await api("PATCH", "/channels/" + App._chan.id, payload);
    App._chan = {...App._chan, ...payload};
    toast("Сохранено", "ok");
  } catch(e) { toast(e.message, "err"); }
}

async function verifyChannel() {
  const chat = ($("f_chat")||{value:""}).value.trim();
  if (!chat) return toast("Введите @username канала", "err");
  $("verBtn").innerHTML = '<span class="spinner"></span>';
  try {
    await api("PATCH", "/channels/" + App._chan.id, { tg_chat: chat });
    const r = await api("POST", "/channels/" + App._chan.id + "/verify");
    $("verMsg").textContent = r.message;
    $("verMsg").style.color = r.ok ? "var(--green)" : "var(--red)";
  } catch(e) { $("verMsg").textContent = e.message; $("verMsg").style.color = "var(--red)"; }
  $("verBtn").innerHTML = "Проверить подключение";
}

async function analyzeChannel() {
  const link = ($("f_analyze")||{value:""}).value.trim();
  if (!link) return toast("Вставьте ссылку", "err");
  const btn = $("anBtn"); if (btn) { btn.innerHTML = '<span class="spinner"></span>'; btn.disabled = true; }
  const result = $("analyze_result");
  try {
    const r = await api("POST", "/channels/" + App._chan.id + "/analyze", { link });
    App._chan.style_profile = r.profile;
    if (result) result.innerHTML = `<div class="hint" style="color:var(--green);margin-top:8px">
      ✓ Изучено постов: ${r.analyzed_posts}. Стиль сохранён.
    </div>`;
    toast("Стиль изучен", "ok");
  } catch(e) {
    if (result) result.innerHTML = `<div class="hint" style="color:var(--red);margin-top:8px">${esc(e.message)}</div>`;
  }
  if (btn) { btn.innerHTML = "Изучить"; btn.disabled = false; }
}

async function deleteChannel() {
  if (!confirm("Удалить канал и все его посты?")) return;
  try { await api("DELETE", "/channels/" + App._chan.id); toast("Удалено", "ok"); go("dashboard"); }
  catch(e) { toast(e.message, "err"); }
}

async function addSource() {
  const url = ($("srcUrl")||{value:""}).value.trim(); if (!url) return;
  try { await api("POST", "/channels/" + App._chan.id + "/sources", { url }); $("srcUrl").value = ""; loadSources(); }
  catch(e) { toast(e.message, "err"); }
}
async function delSource(id) {
  try { await api("DELETE", "/sources/" + id); loadSources(); } catch(e) { toast(e.message, "err"); }
}

async function savePost(id) {
  const el = $("pt_" + id); if (!el) return;
  try { await api("PATCH", "/posts/" + id, { text: el.value }); toast("Сохранено", "ok"); }
  catch(e) { toast(e.message, "err"); }
}
async function publishPost(id) {
  const ta = $("pt_" + id);
  if (ta) try { await api("PATCH", "/posts/" + id, { text: ta.value }); } catch(_) {}
  try { await api("POST", "/posts/" + id + "/publish"); toast("Опубликовано!", "ok"); renderQueue(); }
  catch(e) { toast(e.message, "err"); }
}
async function rejectPost(id) {
  try { await api("POST", "/posts/" + id + "/reject"); renderQueue(); } catch(e) { toast(e.message, "err"); }
}
async function deletePost(id) {
  try { await api("DELETE", "/posts/" + id); renderQueue(); } catch(e) { toast(e.message, "err"); }
}
async function schedulePrompt(id) {
  const ta = $("pt_" + id);
  if (ta) try { await api("PATCH", "/posts/" + id, { text: ta.value }); } catch(_) {}
  const def = new Date(Date.now() + 3600e3).toISOString().slice(0,16);
  const val = prompt("Дата и время публикации (UTC):\nМосква = UTC+3", def);
  if (!val) return;
  try { await api("POST", "/posts/" + id + "/schedule", { scheduled_at: val }); toast("Запланировано", "ok"); renderQueue(); }
  catch(e) { toast(e.message, "err"); }
}

async function generateNow() {
  const about = App._chan.about || "";
  if (!about.trim()) { toast("Сначала заполните тему канала в настройках", "err"); return; }
  const topic = ($("genTopic")||{value:""}).value.trim();
  const btn = $("genRunBtn");
  if (btn) btn.innerHTML = '<span class="spinner"></span>';

  let attempts = 0;
  while (attempts < 3) {
    try {
      const r = await api("POST", "/channels/" + App._chan.id + "/generate", topic ? { topic } : {});
      toast(`Готово! ${fmt(r.tokens_used)} токенов`, "ok");
      if ($("genPanel")) $("genPanel").classList.add("hidden");
      if ($("genTopic")) $("genTopic").value = "";
      App.tab = "queue";
      renderChannel();
      return;
    } catch(e) {
      const is529 = e.message.includes("529") || e.message.toLowerCase().includes("overload");
      attempts++;
      if (is529 && attempts < 3) {
        toast(`Серверы заняты, повтор через 15 сек… (${attempts}/3)`);
        await new Promise(r => setTimeout(r, 15000));
        if (btn) btn.innerHTML = '<span class="spinner"></span>';
      } else {
        toast(is529 ? "Серверы Anthropic перегружены. Попробуй через минуту." : e.message, "err");
        if (btn) btn.innerHTML = "Создать";
        return;
      }
    }
  }
}

// ══ BILLING ═══════════════════════════════════
async function renderBilling() {
  await refreshUser();
  const pkgs = App.cfg?.packages || [];

  const plans = [
    { id:"p1", name:"Старт",     price:"490 ₽/мес",  channels:1,  posts:90,   tag:"" },
    { id:"p2", name:"Про",       price:"990 ₽/мес",  channels:3,  posts:300,  tag:"popular" },
    { id:"p3", name:"Бизнес",    price:"2 490 ₽/мес",channels:10, posts:1500, tag:"" },
    { id:"p4", name:"Агентство", price:"4 990 ₽/мес",channels:0,  posts:5000, tag:"" },
  ];

  $("app").innerHTML = topbar("dashboard", "назад") + `<div class="wrap">
    <div class="page-head">
      <h1>Тарифы</h1>
      <p>Баланс: <b class="mono">${fmt(App.user?.token_balance||0)}</b> токенов</p>
    </div>

    ${!App.cfg?.yoomoney_enabled
      ? `<div class="card" style="border-color:var(--accent);background:var(--accent-soft);margin-bottom:16px">
          <p style="color:var(--accent-dark)">Приём платежей пока не настроен.</p>
        </div>` : ""}

    <div class="grid grid-2" style="margin-bottom:16px">
      ${plans.map(p => `
      <div class="price-card" style="position:relative;${p.tag==="popular"?"border-color:var(--accent)":""}">
        ${p.tag==="popular" ? `<div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;font-size:11px;font-weight:600;padding:2px 12px;border-radius:99px;white-space:nowrap">Популярный</div>` : ""}
        <div class="p-name">${p.name}</div>
        <div class="p-price" style="font-size:28px">${p.price}</div>
        <div class="p-tokens" style="line-height:1.7">
          📺 ${p.channels === 0 ? "Безлимит каналов" : `${p.channels} ${p.channels===1?"канал":p.channels<5?"канала":"каналов"}`}<br>
          ✦ ${fmt(p.posts)} постов в месяц<br>
          🤖 ИИ с веб-поиском
        </div>
        <button class="btn" style="width:100%;justify-content:center;margin-top:4px" onclick="buy('${p.id}')">Выбрать</button>
      </div>`).join("")}
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-title">🎁 Пригласи друга</div>
      <p style="font-size:14px;color:var(--text-dim);margin-bottom:12px">
        За каждого приглашённого — <b>+50 000 токенов</b> тебе и другу.
      </p>
      <div id="ref_block" class="text-faint">Загрузка…</div>
    </div>

    <div class="card">
      <div class="card-title">История платежей</div>
      <div id="payList" class="text-faint">Загрузка…</div>
    </div>
  </div>`;

  try {
    const me = await api("GET", "/me");
    const refUrl = `${window.location.origin}?ref=${me.ref_code||""}`;
    $("ref_block").innerHTML = `
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <input value="${esc(refUrl)}" readonly style="flex:1;font-family:monospace;font-size:12px">
        <button class="btn-outline btn-sm" onclick="navigator.clipboard.writeText('${esc(refUrl)}').then(()=>toast('Скопировано','ok'))">Копировать</button>
      </div>
      <div class="hint" style="margin-top:6px">Приглашений отправлено: <b>${me.referrals_count||0}</b></div>`;
  } catch(_) {}

  try {
    const ps = await api("GET", "/payments");
    $("payList").innerHTML = ps.length
      ? ps.map(p => `<div class="src-row">
          <span class="src-url">${new Date(p.created_at+"Z").toLocaleString("ru-RU")} · ${fmt(p.tokens)} ток.</span>
          <span class="chip ${p.status==="paid"?"chip-green":"chip-orange"}">${p.status==="paid"?"оплачено":"ожидает"}</span>
        </div>`).join("")
      : `<p style="font-size:13px;color:var(--text-faint)">Платежей пока не было.</p>`;
  } catch(_) {}
}

async function buy(pid) {
  try {
    const r = await api("POST", "/billing/buy", { package_id: pid });
    toast("Открываю оплату…", "ok");
    window.open(r.payment_url, "_blank");
  } catch(e) { toast(e.message, "err"); }
}

// ══ BOOT ══════════════════════════════════════
async function boot() {
  try { App.cfg = await api("GET", "/config"); } catch(_) { App.cfg = { packages: [] }; }

  // Если пришли по реферальной ссылке — запомним код
  const urlRef = new URLSearchParams(window.location.search).get("ref");
  if (urlRef) sessionStorage.setItem("ref_code", urlRef);

  if (!App.token) return renderAuth();
  try { App.user = await api("GET", "/me"); go("dashboard"); }
  catch(_) { logout(); }
}

// ══ GLOBALS ═══════════════════════════════════
window.go=go; window.logout=logout;
window.setTab=setTab; window.pickLen=pickLen; window.pickSched=pickSched; window.pickOpt=pickOpt;
window.saveChannel=saveChannel; window.saveAdvanced=saveAdvanced;
window.verifyChannel=verifyChannel; window.analyzeChannel=analyzeChannel;
window.deleteChannel=deleteChannel; window.openGenPanel=openGenPanel;
window.addSource=addSource; window.delSource=delSource; window.loadSources=loadSources;
window.savePost=savePost; window.publishPost=publishPost;
window.rejectPost=rejectPost; window.deletePost=deletePost;
window.schedulePrompt=schedulePrompt; window.generateNow=generateNow;
window.buy=buy; window.ncAnalyze=ncAnalyze; window.ncGenerate=ncGenerate; window.ncSelect=ncSelect;

boot();
