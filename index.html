// ===========================================================
// PostBot — фронтенд (ванильный JS, без сборки)
// ===========================================================

const App = {
  token: localStorage.getItem("pb_token") || null,
  user: null,
  cfg: null,
  view: "dashboard",
  channelId: null,
  tab: "settings",
};

const $ = (id) => document.getElementById(id);
const esc = (s) => (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => (n || 0).toLocaleString("ru-RU");

function toast(msg, kind = "") {
  const t = document.createElement("div");
  t.className = "toast " + kind;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// ── API ───────────────────────────────────────────────────
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
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error((data && data.detail) || "Ошибка запроса");
  return data;
}

// ── AUTH ──────────────────────────────────────────────────
function logout() {
  App.token = null; App.user = null;
  localStorage.removeItem("pb_token");
  renderAuth();
}

function renderAuth(mode = "login") {
  $("app").innerHTML = `
    <div class="auth-screen"><div class="auth-box">
      <div class="logo-big">Post<b>Bot</b></div>
      <div class="sub">ИИ ведёт твой Telegram-канал на автопилоте</div>
      <div class="card">
        <label class="field"><span class="label">Email</span>
          <input id="email" type="email" placeholder="you@mail.ru" autocomplete="username"></label>
        <label class="field"><span class="label">Пароль</span>
          <input id="pass" type="password" placeholder="минимум 6 символов" autocomplete="current-password"></label>
        <button class="btn" style="width:100%" id="authBtn">
          ${mode === "login" ? "Войти" : "Создать аккаунт"}</button>
        <div class="auth-switch">
          ${mode === "login"
            ? `Нет аккаунта? <a id="toReg">Зарегистрироваться</a>`
            : `Уже есть аккаунт? <a id="toLogin">Войти</a>`}
        </div>
      </div>
    </div></div>`;

  $("authBtn").onclick = async () => {
    const email = $("email").value.trim();
    const password = $("pass").value;
    if (!email || !password) return toast("Заполните email и пароль", "err");
    try {
      const r = await api("POST", mode === "login" ? "/login" : "/register", { email, password });
      App.token = r.token;
      localStorage.setItem("pb_token", r.token);
      await boot();
    } catch (e) { toast(e.message, "err"); }
  };
  if ($("toReg")) $("toReg").onclick = () => renderAuth("register");
  if ($("toLogin")) $("toLogin").onclick = () => renderAuth("login");
  $("pass").onkeydown = (e) => { if (e.key === "Enter") $("authBtn").click(); };
}

// ── TOPBAR ────────────────────────────────────────────────
function topbar() {
  const low = App.user && App.user.token_balance < 5000;
  return `
  <div class="topbar">
    <div class="brand" style="cursor:pointer" onclick="go('dashboard')">
      <span class="logo">Post<b>Bot</b></span>
      <span class="tag">AI · TELEGRAM</span>
    </div>
    <div class="row">
      <div class="balance-pill ${low ? "low" : ""}" style="cursor:pointer" onclick="go('billing')" title="Баланс токенов">
        <span class="dot"></span>
        <span class="num">${fmt(App.user ? App.user.token_balance : 0)}</span>
        <span class="label" style="letter-spacing:.08em">токенов</span>
      </div>
      <button class="btn-ghost btn-sm" onclick="logout()">Выйти</button>
    </div>
  </div>`;
}

// ── ROUTER ────────────────────────────────────────────────
async function go(view, channelId) {
  App.view = view;
  if (channelId !== undefined) App.channelId = channelId;
  if (view === "dashboard") return renderDashboard();
  if (view === "channel") return renderChannel();
  if (view === "billing") return renderBilling();
}

async function refreshUser() {
  try { App.user = await api("GET", "/me"); } catch (_) {}
}

// ── DASHBOARD ─────────────────────────────────────────────
async function renderDashboard() {
  await refreshUser();
  $("app").innerHTML = topbar() + `<div class="wrap" id="w">
    <div class="page-head">
      <h1>Твои каналы</h1>
      <p>Создай канал, задай тему и стиль — ИИ начнёт готовить посты сам.</p>
    </div>
    <div class="grid grid-3" id="chans"><div class="faint">Загрузка…</div></div>
  </div>`;

  let chans = [];
  try { chans = await api("GET", "/channels"); } catch (e) { toast(e.message, "err"); }

  const cards = chans.map((c) => {
    const v = c.verified
      ? `<span class="chip chip-ok">● подключён</span>`
      : `<span class="chip chip-warn">● не проверен</span>`;
    const mode = c.auto_publish
      ? `<span class="chip chip-blue">авто-публикация</span>`
      : `<span class="chip chip-off">с проверкой</span>`;
    const sched = c.schedule_kind === "interval"
      ? `каждые ${c.interval_hours}ч`
      : (c.daily_times || []).join(", ");
    return `<div class="chan-card" onclick="go('channel', ${c.id})">
      <h3>${esc(c.title)}</h3>
      <div class="meta">${esc(c.tg_chat || "канал не указан")}</div>
      <div class="about">${esc(c.about) || "<span class='faint'>тема не задана</span>"}</div>
      <div class="foot">${v} ${mode} <span class="chip chip-off">🕑 ${esc(sched)}</span></div>
    </div>`;
  }).join("");

  $("chans").innerHTML = cards + `
    <div class="dashed-card" onclick="newChannel()">
      <div class="plus">+</div><div>Новый канал</div>
    </div>`;
}

async function newChannel() {
  try {
    const c = await api("POST", "/channels", { title: "Новый канал", about: "", style: "" });
    go("channel", c.id);
  } catch (e) { toast(e.message, "err"); }
}

// ── CHANNEL DETAIL ────────────────────────────────────────
async function renderChannel() {
  await refreshUser();
  let c;
  try { c = await api("GET", "/channels/" + App.channelId); }
  catch (e) { toast(e.message, "err"); return go("dashboard"); }
  App._chan = c;

  $("app").innerHTML = topbar() + `<div class="wrap">
    <div class="back" onclick="go('dashboard')">← все каналы</div>
    <div class="page-head row between">
      <div><h1>${esc(c.title)}</h1>
        <p>${esc(c.tg_chat || "канал ещё не подключён")}</p></div>
      <button class="btn" id="genBtn" onclick="generateNow()">✦ Сгенерировать пост</button>
    </div>
    <div class="tabs">
      <button class="tab ${App.tab==='settings'?'active':''}" onclick="setTab('settings')">Настройки</button>
      <button class="tab ${App.tab==='sources'?'active':''}" onclick="setTab('sources')">Источники</button>
      <button class="tab ${App.tab==='drafts'?'active':''}" onclick="setTab('drafts')">Посты</button>
    </div>
    <div id="tabbody"></div>
  </div>`;
  renderTab();
}

function setTab(t) { App.tab = t; renderTab(); document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active")); event.target.classList.add("active"); }

function renderTab() {
  if (App.tab === "settings") return renderSettings();
  if (App.tab === "sources") return renderSources();
  if (App.tab === "drafts") return renderDrafts();
}

// ---- Settings tab ----
function renderSettings() {
  const c = App._chan;
  const lenOpts = ["50-100 слов", "100-200 слов", "200-350 слов"];
  $("tabbody").innerHTML = `
    <div class="card">
      <div class="card-title">Подключение Telegram</div>
      <label class="field"><span class="label">Название (для тебя)</span>
        <input id="f_title" value="${esc(c.title)}"></label>
      <label class="field"><span class="label">Канал в Telegram — @username или ID</span>
        <input id="f_chat" value="${esc(c.tg_chat)}" placeholder="@my_ma_news"></label>
      <div class="hint">1) Добавь бота <b>@${esc(App.cfg.bot_username || "—")}</b> в канал администратором с правом публикации.
        2) Впиши сюда @username канала. 3) Нажми «Проверить».</div>
      <div class="row mt"><button class="btn-ghost btn-sm" onclick="verifyChannel()" id="verBtn">Проверить подключение</button>
        <span id="verMsg" class="faint" style="font-size:13px"></span></div>
    </div>

    <div class="card">
      <div class="card-title">О чём канал</div>
      <label class="field"><span class="label">Тема канала</span>
        <textarea id="f_about" placeholder="Например: новости и сделки M&A на российском рынке — крупные слияния, поглощения, продажи активов, с кратким разбором смысла сделки">${esc(c.about)}</textarea></label>
      <label class="field"><span class="label">Стиль и тон</span>
        <textarea id="f_style" placeholder="Например: деловой, лаконичный, без воды; каждый пост — суть сделки + почему это важно; допустимы 1-2 эмодзи">${esc(c.style)}</textarea></label>
      <label class="field"><span class="label">Длина поста</span>
        <div class="seg" id="seg_len">${lenOpts.map(o=>`<button class="${c.post_length===o?'on':''}" onclick="pickLen('${o}')">${o}</button>`).join("")}</div></label>

      <div class="card" style="background:var(--ink);margin-top:6px">
        <div class="card-title">Писать как существующий канал (необязательно)</div>
        <div class="hint" style="margin-top:0;margin-bottom:10px">Вставь ссылку на публичный канал — ИИ изучит его посты и будет писать в похожем стиле.</div>
        <div class="row"><input id="f_analyze" placeholder="https://t.me/example_channel">
          <button class="btn-ghost btn-sm" style="white-space:nowrap" onclick="analyzeChannel()" id="anBtn">Изучить стиль</button></div>
        ${c.style_profile ? `<div class="hint" style="margin-top:12px;color:var(--green)">✓ Профиль стиля сохранён (${c.style_profile.length} символов). Будет учитываться при генерации.</div>` : ""}
      </div>
    </div>

    <div class="card">
      <div class="card-title">Как часто публиковать</div>
      <label class="field"><span class="label">Режим расписания</span>
        <div class="seg">
          <button class="${c.schedule_kind==='interval'?'on':''}" onclick="pickSchedKind('interval')">Каждые N часов</button>
          <button class="${c.schedule_kind==='daily'?'on':''}" onclick="pickSchedKind('daily')">В заданное время</button>
        </div></label>
      <div id="sched_interval" class="${c.schedule_kind==='interval'?'':'hidden'}">
        <label class="field"><span class="label">Интервал, часов: <b id="ivLbl">${c.interval_hours}</b></span>
          <input id="f_interval" type="range" min="1" max="48" value="${c.interval_hours}" oninput="$('ivLbl').textContent=this.value"></label>
      </div>
      <div id="sched_daily" class="${c.schedule_kind==='daily'?'':'hidden'}">
        <label class="field"><span class="label">Время публикаций (через запятую, ЧЧ:ММ, по UTC)</span>
          <input id="f_times" value="${esc((c.daily_times||[]).join(', '))}" placeholder="10:00, 18:00"></label>
        <div class="hint">Время в UTC. Москва = UTC+3 → для 13:00 МСК укажи 10:00.</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Поведение ИИ</div>
      <div class="row between" style="margin-bottom:16px">
        <div><b>Искать новости в интернете</b><div class="hint" style="margin-top:2px">ИИ сам найдёт свежую информацию по теме</div></div>
        <div class="toggle ${c.use_web_search?'on':''}" id="t_web" onclick="toggle('t_web')"><div class="track"><div class="knob"></div></div></div>
      </div>
      <div class="row between">
        <div><b>Публиковать без проверки</b><div class="hint" style="margin-top:2px">Если выкл — посты ждут твоего подтверждения во вкладке «Посты»</div></div>
        <div class="toggle ${c.auto_publish?'on':''}" id="t_auto" onclick="toggle('t_auto')"><div class="track"><div class="knob"></div></div></div>
      </div>
    </div>

    <div class="row between mt-lg">
      <button class="btn-danger btn-sm" onclick="deleteChannel()">Удалить канал</button>
      <button class="btn" onclick="saveChannel()" id="saveBtn">Сохранить настройки</button>
    </div>`;
}

function pickLen(o){ App._chan.post_length=o; document.querySelectorAll("#seg_len button").forEach(b=>b.classList.toggle("on", b.textContent===o)); }
function pickSchedKind(k){ App._chan.schedule_kind=k; $("sched_interval").classList.toggle("hidden", k!=="interval"); $("sched_daily").classList.toggle("hidden", k!=="daily"); document.querySelectorAll("#tabbody .seg button").forEach(()=>{}); renderSettings(); }
function toggle(id){ const el=$(id); el.classList.toggle("on"); }

async function saveChannel() {
  const c = App._chan;
  const times = ($("f_times") ? $("f_times").value : "").split(",").map(s=>s.trim()).filter(Boolean);
  const payload = {
    title: $("f_title").value.trim() || "Без названия",
    tg_chat: $("f_chat").value.trim(),
    about: $("f_about").value,
    style: $("f_style").value,
    post_length: c.post_length,
    schedule_kind: c.schedule_kind,
    interval_hours: parseInt($("f_interval") ? $("f_interval").value : c.interval_hours),
    daily_times: times.length ? times : ["10:00"],
    use_web_search: $("t_web").classList.contains("on"),
    auto_publish: $("t_auto").classList.contains("on"),
  };
  try {
    await api("PATCH", "/channels/" + c.id, payload);
    toast("Сохранено", "ok");
    renderChannel();
  } catch (e) { toast(e.message, "err"); }
}

async function verifyChannel() {
  const chat = $("f_chat").value.trim();
  if (!chat) return toast("Сначала впишите @username канала", "err");
  $("verBtn").innerHTML = '<span class="spinner"></span> проверяю…';
  try {
    await api("PATCH", "/channels/" + App._chan.id, { tg_chat: chat });
    const r = await api("POST", "/channels/" + App._chan.id + "/verify");
    $("verMsg").textContent = r.message;
    $("verMsg").style.color = r.ok ? "var(--green)" : "var(--red)";
  } catch (e) { $("verMsg").textContent = e.message; $("verMsg").style.color = "var(--red)"; }
  $("verBtn").innerHTML = "Проверить подключение";
}

async function analyzeChannel() {
  const link = $("f_analyze").value.trim();
  if (!link) return toast("Вставьте ссылку на канал", "err");
  $("anBtn").innerHTML = '<span class="spinner"></span>';
  try {
    const r = await api("POST", "/channels/" + App._chan.id + "/analyze", { link });
    toast(`Изучено постов: ${r.analyzed_posts}. Стиль сохранён.`, "ok");
    renderChannel();
  } catch (e) { toast(e.message, "err"); $("anBtn").innerHTML = "Изучить стиль"; }
}

async function deleteChannel() {
  if (!confirm("Удалить канал и все его посты?")) return;
  try { await api("DELETE", "/channels/" + App._chan.id); toast("Удалено", "ok"); go("dashboard"); }
  catch (e) { toast(e.message, "err"); }
}

// ---- Sources tab ----
async function renderSources() {
  $("tabbody").innerHTML = `<div class="card">
    <div class="card-title">Источники информации</div>
    <div class="hint" style="margin-top:0;margin-bottom:14px">Сайты или RSS, которые ИИ обязан просматривать перед написанием поста.
      Подходит для нишевых тем — например, конкретные ресурсы о сделках M&A в России.</div>
    <div class="row"><input id="srcUrl" placeholder="https://www.interfax.ru/business/ или RSS-лента">
      <button class="btn btn-sm" style="white-space:nowrap" onclick="addSource()">Добавить</button></div>
    <div id="srcList" class="mt"></div>
  </div>`;
  await loadSources();
}

async function loadSources() {
  let list = [];
  try { list = await api("GET", "/channels/" + App._chan.id + "/sources"); } catch (e) {}
  $("srcList").innerHTML = list.length
    ? list.map(s => `<div class="src-row"><span class="url">${esc(s.url)}</span>
        <button class="btn-danger btn-sm" onclick="delSource(${s.id})">Удалить</button></div>`).join("")
    : `<div class="empty"><div class="big">Источников пока нет</div>
        <div class="faint">Без них ИИ опирается на веб-поиск и тему канала.</div></div>`;
}

async function addSource() {
  const url = $("srcUrl").value.trim();
  if (!url) return;
  try { await api("POST", "/channels/" + App._chan.id + "/sources", { url }); $("srcUrl").value=""; loadSources(); }
  catch (e) { toast(e.message, "err"); }
}
async function delSource(id) {
  try { await api("DELETE", "/sources/" + id); loadSources(); } catch (e) { toast(e.message, "err"); }
}

// ---- Drafts / posts tab ----
async function renderDrafts() {
  $("tabbody").innerHTML = `<div id="postList"><div class="faint">Загрузка…</div></div>`;
  let posts = [];
  try { posts = await api("GET", "/channels/" + App._chan.id + "/posts"); } catch (e) { toast(e.message, "err"); }

  if (!posts.length) {
    $("postList").innerHTML = `<div class="empty"><div class="big">Постов ещё нет</div>
      <div class="faint">Нажми «Сгенерировать пост» наверху или подожди расписание.</div></div>`;
    return;
  }
  const statusChip = { pending:`<span class="chip chip-warn">на проверке</span>`,
    scheduled:`<span class="chip chip-blue">запланирован</span>`,
    published:`<span class="chip chip-ok">опубликован</span>`,
    rejected:`<span class="chip chip-off">отклонён</span>` };

  $("postList").innerHTML = posts.map(p => {
    const when = new Date(p.created_at + "Z").toLocaleString("ru-RU", {day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
    const sched = p.scheduled_at ? `<span class="faint mono" style="font-size:11px">⏰ ${new Date(p.scheduled_at+"Z").toLocaleString("ru-RU",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}</span>` : "";
    const editable = p.status !== "published";
    let actions = "";
    if (p.status === "pending") {
      actions = `<button class="btn-green btn-sm" onclick="publishPost(${p.id})">✓ Опубликовать сейчас</button>
        <button class="btn-ghost btn-sm" onclick="schedulePrompt(${p.id})">⏰ Запланировать</button>
        <button class="btn-ghost btn-sm" onclick="regen(${p.id})">🔄 Заново</button>
        <button class="btn-danger btn-sm" onclick="rejectPost(${p.id})">Отклонить</button>`;
    } else if (p.status === "scheduled") {
      actions = `<button class="btn-green btn-sm" onclick="publishPost(${p.id})">✓ Опубликовать сейчас</button>
        <button class="btn-ghost btn-sm" onclick="rejectPost(${p.id})">Снять с расписания</button>`;
    } else {
      actions = `<button class="btn-danger btn-sm" onclick="deletePost(${p.id})">Удалить из списка</button>`;
    }
    return `<div class="post">
      <div class="ph"><div class="row" style="gap:10px">${statusChip[p.status]||""} <span class="faint mono" style="font-size:11px">${when}</span> ${sched}</div>
        <span class="faint mono" style="font-size:11px">${fmt(p.tokens_used)} ток.</span></div>
      <div class="tg-preview">
        <div class="tg-avatar">${esc((App._chan.title||"K")[0])}</div>
        <div style="flex:1">
          ${editable
            ? `<textarea id="pt_${p.id}" class="post-text" style="min-height:120px">${esc(p.text)}</textarea>`
            : `<div class="post-text">${esc(p.text)}</div>`}
        </div>
      </div>
      <div class="post-actions">
        ${editable ? `<button class="btn-ghost btn-sm" onclick="savePost(${p.id})">💾 Сохранить правки</button>` : ""}
        ${actions}
      </div>
    </div>`;
  }).join("");
}

async function savePost(id) {
  const text = $("pt_" + id).value;
  try { await api("PATCH", "/posts/" + id, { text }); toast("Сохранено", "ok"); }
  catch (e) { toast(e.message, "err"); }
}
async function publishPost(id) {
  const ta = $("pt_" + id);
  if (ta) { try { await api("PATCH", "/posts/" + id, { text: ta.value }); } catch(_){} }
  try { await api("POST", "/posts/" + id + "/publish"); toast("Опубликовано в Telegram", "ok"); renderDrafts(); }
  catch (e) { toast(e.message, "err"); }
}
async function rejectPost(id) {
  try { await api("POST", "/posts/" + id + "/reject"); renderDrafts(); } catch (e) { toast(e.message, "err"); }
}
async function deletePost(id) {
  try { await api("DELETE", "/posts/" + id); renderDrafts(); } catch (e) { toast(e.message, "err"); }
}
async function schedulePrompt(id) {
  const ta = $("pt_" + id);
  if (ta) { try { await api("PATCH", "/posts/" + id, { text: ta.value }); } catch(_){} }
  const def = new Date(Date.now() + 3600e3).toISOString().slice(0,16);
  const val = prompt("Когда опубликовать? (UTC, формат ГГГГ-ММ-ДДTЧЧ:ММ)\nМосква = UTC+3", def);
  if (!val) return;
  try { await api("POST", "/posts/" + id + "/schedule", { scheduled_at: val }); toast("Запланировано", "ok"); renderDrafts(); }
  catch (e) { toast(e.message, "err"); }
}
async function regen(id) {
  await rejectPost(id);
  await generateNow(true);
}

async function generateNow(silent) {
  const btn = $("genBtn");
  if (btn) btn.innerHTML = '<span class="spinner"></span> генерирую…';
  try {
    const r = await api("POST", "/channels/" + App._chan.id + "/generate");
    if (!silent) toast(`Готово! Списано ${fmt(r.tokens_used)} токенов`, "ok");
    App.tab = "drafts";
    renderChannel();
  } catch (e) { toast(e.message, "err"); if (btn) btn.innerHTML = "✦ Сгенерировать пост"; }
}

// ── BILLING ───────────────────────────────────────────────
async function renderBilling() {
  await refreshUser();
  const pkgs = App.cfg.packages || [];
  const cards = pkgs.map(p => `
    <div class="price-card">
      <div class="pname">${esc(p.title)}</div>
      <div class="prub">${fmt(p.rub)} ₽</div>
      <div class="ptok">${fmt(p.tokens)} токенов</div>
      <button class="btn" style="width:100%" onclick="buy('${p.id}')">Купить</button>
    </div>`).join("");

  $("app").innerHTML = topbar() + `<div class="wrap">
    <div class="back" onclick="go('dashboard')">← назад</div>
    <div class="page-head"><h1>Баланс и пополнение</h1>
      <p>Текущий баланс: <b class="mono">${fmt(App.user.token_balance)}</b> токенов.
      Токены тратятся на генерацию текста и анализ каналов.</p></div>
    ${App.cfg.yoomoney_enabled ? "" : `<div class="card" style="border-color:var(--red-bg);color:var(--red)">Приём платежей пока не настроен администратором (нет кошелька ЮMoney).</div>`}
    <div class="grid grid-4">${cards}</div>
    <div class="card mt-lg">
      <div class="card-title">История платежей</div>
      <div id="payList" class="faint">Загрузка…</div>
    </div>
  </div>`;

  try {
    const ps = await api("GET", "/payments");
    $("payList").innerHTML = ps.length
      ? ps.map(p => `<div class="src-row"><span class="url">${new Date(p.created_at+"Z").toLocaleString("ru-RU")} · ${esc(p.package_id)} · ${fmt(p.tokens)} ток.</span>
          <span class="chip ${p.status==='paid'?'chip-ok':'chip-warn'}">${p.status==='paid'?'оплачено':'ожидает'}</span></div>`).join("")
      : `<div class="faint">Платежей пока не было.</div>`;
  } catch (e) {}
}

async function buy(pid) {
  try {
    const r = await api("POST", "/billing/buy", { package_id: pid });
    toast("Открываю оплату ЮMoney…", "ok");
    window.open(r.payment_url, "_blank");
  } catch (e) { toast(e.message, "err"); }
}

// ── BOOT ──────────────────────────────────────────────────
async function boot() {
  try { App.cfg = await api("GET", "/config"); } catch (e) { App.cfg = { packages: [] }; }
  if (!App.token) return renderAuth();
  try {
    App.user = await api("GET", "/me");
    go("dashboard");
  } catch (e) { logout(); }
}

window.go = go; window.logout = logout; window.newChannel = newChannel;
window.setTab = setTab; window.toggle = toggle; window.pickLen = pickLen;
window.pickSchedKind = pickSchedKind; window.saveChannel = saveChannel;
window.verifyChannel = verifyChannel; window.analyzeChannel = analyzeChannel;
window.deleteChannel = deleteChannel; window.addSource = addSource; window.delSource = delSource;
window.savePost = savePost; window.publishPost = publishPost; window.rejectPost = rejectPost;
window.deletePost = deletePost; window.schedulePrompt = schedulePrompt; window.regen = regen;
window.generateNow = generateNow; window.buy = buy;

boot();
