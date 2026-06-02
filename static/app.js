// Автопост — полный SPA
const App = { token: localStorage.getItem("ap_token"), user: null, cfg: null, view: "dashboard", channelId: null, tab: "settings", _chan: null };
const $ = id => document.getElementById(id);
const esc = s => (s||"").replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => (n||0).toLocaleString("ru-RU");

function toast(msg, kind="") {
  document.querySelectorAll(".toast").forEach(t=>t.remove());
  const t = document.createElement("div");
  t.className = "toast " + kind; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 3000);
}

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (App.token) opts.headers["Authorization"] = "Bearer " + App.token;
  if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
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
  if (view === "channel") return renderChannel();
  if (view === "billing") return renderBilling();
}

// ── AUTH ──────────────────────────────────────
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
        <label class="field" style="margin-top:14px">
          <span class="field-label">Пароль</span>
          <input id="pw" type="password" placeholder="минимум 6 символов" autocomplete="current-password">
        </label>
        <button class="btn" style="width:100%;margin-top:18px;justify-content:center" id="authBtn">
          ${mode==="login"?"Войти":"Создать аккаунт"}</button>
        <div class="auth-switch">${mode==="login"
          ? `Нет аккаунта? <a id="sw">Зарегистрироваться →</a>`
          : `Уже есть аккаунт? <a id="sw">Войти</a>`}
        </div>
      </div>
    </div>
  </div>`;
  $("authBtn").onclick = async () => {
    const email=$("em").value.trim(), password=$("pw").value;
    if (!email||!password) return toast("Заполните email и пароль","err");
    try {
      const r = await api("POST", mode==="login"?"/login":"/register", {email,password});
      App.token = r.token; localStorage.setItem("ap_token", r.token);
      await boot();
    } catch(e) { toast(e.message,"err"); }
  };
  if ($("sw")) $("sw").onclick = ()=>renderAuth(mode==="login"?"register":"login");
  $("pw").onkeydown = e=>{ if(e.key==="Enter") $("authBtn").click(); };
}

// ── TOPBAR ────────────────────────────────────
function topbar() {
  const low = App.user && App.user.token_balance < 5000;
  return `<div class="topbar">
    <a class="brand" onclick="go('dashboard')">
      <span class="brand-name">Авто<span>пост</span></span>
    </a>
    <div class="topbar-right">
      <div class="token-pill ${low?"low":""}" onclick="go('billing')" title="Баланс токенов">
        <span class="dot"></span>
        <span class="amount">${fmt(App.user?.token_balance||0)}</span>
        <span class="label">токенов</span>
      </div>
      <button class="btn-ghost btn-sm" onclick="logout()">Выйти</button>
    </div>
  </div>`;
}

// ── DASHBOARD ─────────────────────────────────
async function renderDashboard() {
  await refreshUser();
  $("app").innerHTML = topbar() + `<div class="wrap">
    <div class="page-head">
      <h1>Твои каналы</h1>
      <p>Добавь канал, настрой тему и стиль — ИИ будет писать посты сам.</p>
    </div>
    <div class="grid grid-3" id="chans"><div class="text-faint">Загрузка…</div></div>
  </div>`;

  let chans = [];
  try { chans = await api("GET","/channels"); } catch(e) { toast(e.message,"err"); }

  const cards = chans.map(c => {
    const verified = c.verified
      ? `<span class="chip chip-green">● подключён</span>`
      : `<span class="chip chip-orange">● не проверен</span>`;
    const mode = c.auto_publish
      ? `<span class="chip chip-blue">автопилот</span>`
      : `<span class="chip chip-gray">с проверкой</span>`;
    const sched = c.schedule_kind==="interval" ? `каждые ${c.interval_hours}ч` : (c.daily_times||[]).join(", ");
    return `<div class="chan-card" onclick="go('channel',${c.id})">
      <h3>${esc(c.title)}</h3>
      <div class="chan-handle">${esc(c.tg_chat||"канал не указан")}</div>
      <div class="chan-about">${esc(c.about)||"<span class='text-faint'>тема не задана</span>"}</div>
      <div class="chan-foot">${verified}${mode}<span class="chip chip-gray">🕑 ${esc(sched)}</span></div>
    </div>`;
  }).join("");

  $("chans").innerHTML = cards + `<div class="add-card" onclick="newChannel()">
    <div class="plus">+</div><div style="font-size:14px;font-weight:500">Новый канал</div>
  </div>`;
}

async function newChannel() {
  try {
    const c = await api("POST","/channels",{title:"Новый канал"});
    App._chan = {...c, _saved:true};
    go("channel", c.id);
  } catch(e) { toast(e.message,"err"); }
}

// ── CHANNEL ───────────────────────────────────
async function renderChannel() {
  await refreshUser();
  let c;
  try { c = await api("GET","/channels/"+App.channelId); }
  catch(e) { toast(e.message,"err"); return go("dashboard"); }
  const wasSaved = App._chan && App._chan._saved;
  App._chan = {...c, _saved: wasSaved || !!c.id};

  try { c.daily_times = JSON.parse(c.daily_times||"[]"); } catch(_) { c.daily_times=[]; }
  App._chan.daily_times = c.daily_times;

  const canGen = App._chan._saved;

  $("app").innerHTML = topbar() + `<div class="wrap">
    <div class="back-link" onclick="go('dashboard')">← все каналы</div>
    <div class="page-head row between" style="flex-wrap:wrap;gap:12px">
      <div>
        <h1>${esc(c.title)}</h1>
        <p>${esc(c.tg_chat||"канал ещё не подключён")}</p>
      </div>
      ${canGen ? `<button class="btn" id="genBtn" onclick="openGenPanel()">✦ Сгенерировать пост</button>` : ""}
    </div>

    ${canGen ? `<div class="gen-panel hidden" id="genPanel">
      <div class="gen-title">Задайте тему поста (необязательно)</div>
      <div class="gen-row">
        <input id="genTopic" placeholder="Например: биткоин пробил $80k — что это значит для инвесторов">
        <button class="btn" onclick="generateNow()" id="genRunBtn">Создать пост</button>
      </div>
      <div class="hint" style="margin-top:8px">Оставьте пустым — ИИ сам выберет актуальную тему по настройкам канала</div>
    </div>` : ""}

    <div class="tabs">
      <button class="tab ${App.tab==="settings"?"active":""}" onclick="setTab('settings')">Настройки</button>
      <button class="tab ${App.tab==="advanced"?"active":""}" onclick="setTab('advanced')">Расширенные</button>
      <button class="tab ${App.tab==="sources"?"active":""}" onclick="setTab('sources')">Источники</button>
      <button class="tab ${App.tab==="drafts"?"active":""}" onclick="setTab('drafts')">Посты</button>
    </div>
    <div id="tabbody"></div>
  </div>`;

  renderTab();
}

function openGenPanel() {
  const p=$("genPanel");
  if (!p) return;
  p.classList.toggle("hidden");
  if (!p.classList.contains("hidden")) $("genTopic").focus();
}

function setTab(t) {
  App.tab=t;
  document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
  document.querySelectorAll(".tab").forEach(b=>{ if(b.textContent.trim()===({settings:"Настройки",advanced:"Расширенные",sources:"Источники",drafts:"Посты"}[t])) b.classList.add("active"); });
  renderTab();
}

function renderTab() {
  if (App.tab==="settings") renderSettings();
  else if (App.tab==="advanced") renderAdvanced();
  else if (App.tab==="sources") renderSources();
  else if (App.tab==="drafts") renderDrafts();
}

// ── SETTINGS TAB ──────────────────────────────
function renderSettings() {
  const c = App._chan;
  const lens = ["50-100 слов","100-200 слов","200-350 слов"];
  $("tabbody").innerHTML = `
    <div class="card">
      <div class="card-title">Подключение Telegram</div>
      <label class="field"><span class="field-label">Название канала (для тебя)</span>
        <input id="f_title" value="${esc(c.title)}"></label>
      <label class="field" style="margin-top:14px"><span class="field-label">@username или ID канала в Telegram</span>
        <input id="f_chat" value="${esc(c.tg_chat)}" placeholder="@my_channel"></label>
      <div class="hint">Добавь бота <b>@${esc(App.cfg?.bot_username||"…")}</b> как администратора канала с правом публикации, потом нажми «Проверить».</div>
      <div class="row mt">
        <button class="btn-outline btn-sm" onclick="verifyChannel()" id="verBtn">Проверить подключение</button>
        <span id="verMsg" class="text-faint" style="font-size:13px"></span>
      </div>
    </div>

    <div class="card">
      <div class="card-title">О чём канал</div>
      <label class="field"><span class="field-label">Тема канала</span>
        <textarea id="f_about" rows="3" placeholder="Опишите идею канала — о чём он, кто ваша аудитория, что им интересно">${esc(c.about)}</textarea></label>
      <div class="hint"><b>Примеры:</b><br>
        · <i>Крипта: новости, разбор сделок, инвестиционные идеи — для тех кто уже в теме</i><br>
        · <i>Канал про богатых людей — как живут, что покупают, какие сделки делают</i><br>
        · <i>Психология отношений — понятно о сложном, практические советы</i>
      </div>
      <label class="field" style="margin-top:16px"><span class="field-label">Стиль и тон</span>
        <textarea id="f_style" rows="2" placeholder="Как должен звучать канал, какое настроение создавать">${esc(c.style)}</textarea></label>
      <div class="hint"><b>Примеры:</b><br>
        · <i>Дерзко и по делу — как инсайдер, который знает больше других</i><br>
        · <i>Тепло и честно — как умный друг, без умничания</i><br>
        · <i>Атмосферно — детали, образы, читатель должен захотеть так жить</i>
      </div>

      <div style="margin-top:16px">
        <div class="field-label">Длина поста</div>
        <div class="seg" style="max-width:400px" id="seg_len">
          ${lens.map(o=>`<button class="${c.post_length===o?"on":""}" onclick="pickLen('${o}')">${o}</button>`).join("")}
        </div>
      </div>

      <div style="margin-top:16px">
        <div class="field-label">Писать в стиле существующего канала</div>
        <div class="hint" style="margin-top:0;margin-bottom:8px">Вставьте ссылку на публичный канал — ИИ изучит его посты и будет писать похоже</div>
        <div class="row">
          <input id="f_analyze" placeholder="https://t.me/example">
          <button class="btn-outline btn-sm" onclick="analyzeChannel()" id="anBtn" style="white-space:nowrap">Изучить стиль</button>
        </div>
        ${c.style_profile?`<div class="hint" style="color:var(--green);margin-top:8px">✓ Профиль стиля сохранён (${c.style_profile.length} симв.)</div>`:""}
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
            oninput="$('ivLbl').textContent=this.value" style="padding:4px 0;height:auto;box-shadow:none;border:none;background:none"></label>
      </div>
      <div id="sched_daily" class="${c.schedule_kind==="daily"?"":"hidden"}">
        <label class="field"><span class="field-label">Время публикаций (UTC, через запятую)</span>
          <input id="f_times" value="${esc((c.daily_times||[]).join(", "))}" placeholder="10:00, 18:00"></label>
        <div class="hint">Москва = UTC+3. Для 13:00 МСК введите 10:00.</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Автоматизация</div>
      <div class="toggle-row">
        <div class="toggle-info">
          <b>Публиковать без проверки</b>
          <small>Посты уходят в канал сразу. Иначе — ждут во вкладке «Посты».</small>
        </div>
        <label class="switch"><input type="checkbox" id="sw_auto" ${c.auto_publish?"checked":""}><span class="slider"></span></label>
      </div>
      <div class="toggle-row">
        <div class="toggle-info">
          <b>Искать новости в интернете</b>
          <small>ИИ сам найдёт свежую информацию по теме канала.</small>
        </div>
        <label class="switch"><input type="checkbox" id="sw_web" ${c.use_web_search?"checked":""}><span class="slider"></span></label>
      </div>
    </div>

    <div class="row between mt-lg">
      <button class="btn-danger btn-sm" onclick="deleteChannel()">Удалить канал</button>
      <button class="btn" onclick="saveChannel()" id="saveBtn">Сохранить настройки</button>
    </div>`;
}

// ── ADVANCED TAB ──────────────────────────────
function renderAdvanced() {
  const c = App._chan;
  $("tabbody").innerHTML = `
    <div class="card">
      <div class="card-title">Голос автора</div>
      <div class="hint" style="margin-top:0;margin-bottom:12px">От чьего лица пишутся посты</div>
      <div class="seg" id="seg_voice">
        <button class="${(c.post_voice||"author")==="author"?"on":""}" onclick="pickOpt('post_voice','author','seg_voice')">От себя</button>
        <button class="${(c.post_voice||"author")==="expert"?"on":""}" onclick="pickOpt('post_voice','expert','seg_voice')">Эксперт</button>
        <button class="${(c.post_voice||"author")==="news"?"on":""}" onclick="pickOpt('post_voice','news','seg_voice')">Новости</button>
      </div>
      <div class="hint" style="margin-top:10px">
        <b>От себя</b> — личный опыт, мнение, «я» и «мы»<br>
        <b>Эксперт</b> — авторитетно, с объяснением «почему», без личных историй<br>
        <b>Новости</b> — сухой стиль, только факты, никакого «я»
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
      <div class="hint" style="margin-top:10px">
        <b>История</b> — кейс или нарратив с началом и выводом<br>
        <b>Советы</b> — конкретные шаги, которые можно применить сегодня<br>
        <b>Новость</b> — что случилось, почему важно, что дальше<br>
        <b>Вопрос</b> — подводишь к теме и спрашиваешь мнение аудитории
      </div>
    </div>

    <div class="card">
      <div class="card-title">Эмодзи</div>
      <div class="seg" id="seg_emoji">
        <button class="${(c.emoji_style||"minimal")==="none"?"on":""}" onclick="pickOpt('emoji_style','none','seg_emoji')">Без эмодзи</button>
        <button class="${(c.emoji_style||"minimal")==="minimal"?"on":""}" onclick="pickOpt('emoji_style','minimal','seg_emoji')">Минимально</button>
        <button class="${(c.emoji_style||"minimal")==="rich"?"on":""}" onclick="pickOpt('emoji_style','rich','seg_emoji')">Активно</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Призыв к действию (CTA)</div>
      <div class="toggle-row">
        <div class="toggle-info">
          <b>Добавлять в конец каждого поста</b>
          <small>Подписаться, написать в лс, перейти по ссылке…</small>
        </div>
        <label class="switch"><input type="checkbox" id="sw_cta" ${c.cta_enabled?"checked":""} onchange="toggleCta()"><span class="slider"></span></label>
      </div>
      <div id="cta_field" class="${c.cta_enabled?"":"hidden"}" style="margin-top:14px">
        <label class="field"><span class="field-label">Текст призыва</span>
          <input id="f_cta" value="${esc(c.cta_text||"")}" placeholder="Подпишись чтобы не пропустить следующий пост"></label>
      </div>
    </div>

    <div class="row between mt-lg">
      <div></div>
      <button class="btn" onclick="saveAdvanced()">Сохранить</button>
    </div>`;
}

function toggleCta() {
  const on = $("sw_cta").checked;
  $("cta_field").classList.toggle("hidden", !on);
}

function pickOpt(field, val, segId) {
  App._chan[field] = val;
  document.querySelectorAll(`#${segId} button`).forEach(b=>b.classList.remove("on"));
  event.target.classList.add("on");
}

async function saveAdvanced() {
  const payload = {
    post_voice: App._chan.post_voice || "author",
    post_format: App._chan.post_format || "story",
    emoji_style: App._chan.emoji_style || "minimal",
    cta_enabled: $("sw_cta").checked,
    cta_text: ($("f_cta")||{value:""}).value,
  };
  try {
    await api("PATCH","/channels/"+App._chan.id, payload);
    App._chan = {...App._chan, ...payload, _saved:true};
    toast("Сохранено","ok");
  } catch(e) { toast(e.message,"err"); }
}

function pickLen(o) {
  App._chan.post_length=o;
  document.querySelectorAll("#seg_len button").forEach(b=>b.classList.toggle("on",b.textContent===o));
}
function pickSched(k) {
  App._chan.schedule_kind=k;
  $("sched_interval").classList.toggle("hidden",k!=="interval");
  $("sched_daily").classList.toggle("hidden",k!=="daily");
  document.querySelectorAll("#seg_sched button").forEach(b=>b.classList.toggle("on",b.textContent===(k==="interval"?"Каждые N часов":"В заданное время")));
}

async function saveChannel() {
  const times = ($("f_times")?$("f_times").value:"").split(",").map(s=>s.trim()).filter(Boolean);
  const payload = {
    title: $("f_title").value.trim()||"Без названия",
    tg_chat: ($("f_chat")||{value:""}).value.trim(),
    about: $("f_about").value,
    style: $("f_style").value,
    post_length: App._chan.post_length,
    schedule_kind: App._chan.schedule_kind,
    interval_hours: parseInt(($("f_interval")||{value:App._chan.interval_hours}).value),
    daily_times: times.length?times:["10:00"],
    use_web_search: $("sw_web").checked,
    auto_publish: $("sw_auto").checked,
  };
  try {
    const updated = await api("PATCH","/channels/"+App._chan.id, payload);
    App._chan = {...App._chan, ...updated, _saved:true};
    toast("Сохранено","ok");
    renderChannel();
  } catch(e) { toast(e.message,"err"); }
}

async function _silentSave() {
  if (!$("f_title")) return;
  try {
    const times = ($("f_times")?$("f_times").value:"").split(",").map(s=>s.trim()).filter(Boolean);
    const payload = {
      title: $("f_title").value.trim()||App._chan.title,
      about: $("f_about")?$("f_about").value:App._chan.about,
      style: $("f_style")?$("f_style").value:App._chan.style,
      post_length: App._chan.post_length,
      schedule_kind: App._chan.schedule_kind,
      interval_hours: parseInt(($("f_interval")||{value:App._chan.interval_hours}).value),
      daily_times: times.length?times:(App._chan.daily_times||["10:00"]),
      use_web_search: $("sw_web")?$("sw_web").checked:App._chan.use_web_search,
      auto_publish: $("sw_auto")?$("sw_auto").checked:App._chan.auto_publish,
    };
    await api("PATCH","/channels/"+App._chan.id, payload);
    App._chan = {...App._chan, ...payload};
  } catch(_) {}
}

async function verifyChannel() {
  const chat = ($("f_chat")||{value:""}).value.trim();
  if (!chat) return toast("Введите @username канала","err");
  $("verBtn").innerHTML='<span class="spinner"></span> проверяю…';
  try {
    await api("PATCH","/channels/"+App._chan.id,{tg_chat:chat});
    const r = await api("POST","/channels/"+App._chan.id+"/verify");
    $("verMsg").textContent = r.message;
    $("verMsg").style.color = r.ok?"var(--green)":"var(--red)";
  } catch(e) { $("verMsg").textContent=e.message; $("verMsg").style.color="var(--red)"; }
  $("verBtn").innerHTML="Проверить подключение";
}

async function analyzeChannel() {
  const link = $("f_analyze").value.trim();
  if (!link) return toast("Вставьте ссылку","err");
  $("anBtn").innerHTML='<span class="spinner"></span>';
  try {
    const r = await api("POST","/channels/"+App._chan.id+"/analyze",{link});
    toast(`Изучено постов: ${r.analyzed_posts}. Стиль сохранён.`,"ok");
    App._chan.style_profile = r.profile;
    renderChannel();
  } catch(e) { toast(e.message,"err"); }
  if ($("anBtn")) $("anBtn").innerHTML="Изучить стиль";
}

async function deleteChannel() {
  if (!confirm("Удалить канал и все его посты?")) return;
  try { await api("DELETE","/channels/"+App._chan.id); toast("Удалено","ok"); go("dashboard"); }
  catch(e) { toast(e.message,"err"); }
}

// ── SOURCES TAB ───────────────────────────────
async function renderSources() {
  $("tabbody").innerHTML=`<div class="card">
    <div class="card-title">Источники информации</div>
    <div class="hint" style="margin-top:0;margin-bottom:14px">
      Конкретные сайты или RSS, которые ИИ обязан просматривать перед написанием поста.
      Идеально для нишевых тем — например, конкретные ресурсы о сделках M&A или крипте.
    </div>
    <div class="row">
      <input id="srcUrl" placeholder="https://www.rbc.ru/crypto/ или RSS-лента">
      <button class="btn btn-sm" onclick="addSource()" style="white-space:nowrap">Добавить</button>
    </div>
    <div id="srcList" style="margin-top:12px"></div>
  </div>`;
  await loadSources();
}

async function loadSources() {
  let list=[];
  try { list = await api("GET","/channels/"+App._chan.id+"/sources"); } catch(_) {}
  const el=$("srcList");
  if (!el) return;
  el.innerHTML = list.length
    ? list.map(s=>`<div class="src-row"><span class="src-url">${esc(s.url)}</span>
        <button class="btn-danger btn-sm" onclick="delSource(${s.id})">Удалить</button></div>`).join("")
    : `<div class="empty" style="padding:24px"><p>Источников пока нет. Без них ИИ ищет информацию сам.</p></div>`;
}

async function addSource() {
  const url=($("srcUrl")||{value:""}).value.trim();
  if (!url) return;
  try { await api("POST","/channels/"+App._chan.id+"/sources",{url}); $("srcUrl").value=""; loadSources(); }
  catch(e) { toast(e.message,"err"); }
}
async function delSource(id) {
  try { await api("DELETE","/sources/"+id); loadSources(); } catch(e) { toast(e.message,"err"); }
}

// ── DRAFTS TAB ────────────────────────────────
async function renderDrafts() {
  $("tabbody").innerHTML=`<div id="postList"><div class="text-faint">Загрузка…</div></div>`;
  let posts=[];
  try { posts=await api("GET","/channels/"+App._chan.id+"/posts"); } catch(e) { toast(e.message,"err"); }

  if (!posts.length) {
    $("postList").innerHTML=`<div class="empty">
      <div class="empty-icon">✦</div>
      <h3>Постов пока нет</h3>
      <p>Нажми «Сгенерировать пост» наверху или подожди расписание.</p>
    </div>`;
    return;
  }

  const statusChip = {
    pending:`<span class="chip chip-orange">на проверке</span>`,
    scheduled:`<span class="chip chip-blue">запланирован</span>`,
    published:`<span class="chip chip-green">опубликован</span>`,
    rejected:`<span class="chip chip-gray">отклонён</span>`
  };

  $("postList").innerHTML = posts.map(p=>{
    const when = new Date(p.created_at+"Z").toLocaleString("ru-RU",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
    const sched = p.scheduled_at?`<span class="text-faint mono">⏰ ${new Date(p.scheduled_at+"Z").toLocaleString("ru-RU",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}</span>`:"";
    const editable = p.status!=="published";
    let actions="";
    if (p.status==="pending") {
      actions=`<button class="btn btn-green btn-sm" onclick="publishPost(${p.id})">✓ Опубликовать</button>
        <button class="btn-outline btn-sm" onclick="schedulePrompt(${p.id})">⏰ Запланировать</button>
        <button class="btn-danger btn-sm" onclick="rejectPost(${p.id})">Отклонить</button>`;
    } else if (p.status==="scheduled") {
      actions=`<button class="btn btn-green btn-sm" onclick="publishPost(${p.id})">✓ Опубликовать сейчас</button>
        <button class="btn-danger btn-sm" onclick="rejectPost(${p.id})">Снять</button>`;
    } else {
      actions=`<button class="btn-ghost btn-sm" onclick="deletePost(${p.id})">Удалить</button>`;
    }
    return `<div class="post-card">
      <div class="post-header">
        <div class="row" style="gap:8px">${statusChip[p.status]||""}<span class="text-faint mono">${when}</span>${sched}</div>
        <span class="text-faint mono">${fmt(p.tokens_used)} ток.</span>
      </div>
      <div class="tg-bubble">
        <div class="tg-ava">${esc((App._chan.title||"К")[0])}</div>
        <div style="flex:1">
          ${editable
            ? `<textarea id="pt_${p.id}" class="post-body" style="width:100%;min-height:100px">${esc(p.text)}</textarea>`
            : `<div class="post-body">${esc(p.text)}</div>`}
        </div>
      </div>
      <div class="post-actions">
        ${editable?`<button class="btn-ghost btn-sm" onclick="savePost(${p.id})">💾 Сохранить правки</button>`:""}
        ${actions}
      </div>
    </div>`;
  }).join("");
}

async function savePost(id) {
  const el=$("pt_"+id); if(!el) return;
  try { await api("PATCH","/posts/"+id,{text:el.value}); toast("Сохранено","ok"); }
  catch(e) { toast(e.message,"err"); }
}
async function publishPost(id) {
  const ta=$("pt_"+id);
  if(ta) try{await api("PATCH","/posts/"+id,{text:ta.value});}catch(_){}
  try { await api("POST","/posts/"+id+"/publish"); toast("Опубликовано!","ok"); renderDrafts(); }
  catch(e) { toast(e.message,"err"); }
}
async function rejectPost(id) {
  try { await api("POST","/posts/"+id+"/reject"); renderDrafts(); } catch(e){toast(e.message,"err");}
}
async function deletePost(id) {
  try { await api("DELETE","/posts/"+id); renderDrafts(); } catch(e){toast(e.message,"err");}
}
async function schedulePrompt(id) {
  const ta=$("pt_"+id);
  if(ta) try{await api("PATCH","/posts/"+id,{text:ta.value});}catch(_){}
  const def=new Date(Date.now()+3600e3).toISOString().slice(0,16);
  const val=prompt("Дата и время публикации (UTC):\nМосква UTC+3 → для 13:00 МСК введи 10:00",def);
  if(!val) return;
  try { await api("POST","/posts/"+id+"/schedule",{scheduled_at:val}); toast("Запланировано","ok"); renderDrafts(); }
  catch(e){toast(e.message,"err");}
}

// ── GENERATE ──────────────────────────────────
async function generateNow() {
  const aboutVal = ($("f_about")?$("f_about").value:App._chan.about||"").trim();
  if (!aboutVal) { toast("Сначала заполните поле «О чём канал»","err"); return; }

  const topic = ($("genTopic")||{value:""}).value.trim();
  const btn=$("genRunBtn");
  if(btn) btn.innerHTML='<span class="spinner"></span> создаю…';

  await _silentSave();

  let attempts=0;
  while(attempts<3) {
    try {
      const r = await api("POST","/channels/"+App._chan.id+"/generate", topic?{topic}:{});
      toast(`Готово! ${fmt(r.tokens_used)} токенов`,"ok");
      if($("genPanel")) $("genPanel").classList.add("hidden");
      if($("genTopic")) $("genTopic").value="";
      App.tab="drafts";
      renderChannel();
      return;
    } catch(e) {
      const is529 = e.message.includes("529")||e.message.toLowerCase().includes("overload");
      attempts++;
      if(is529&&attempts<3) {
        toast(`Серверы заняты, повтор через 15 сек… (${attempts}/3)`);
        await new Promise(r=>setTimeout(r,15000));
        if(btn) btn.innerHTML='<span class="spinner"></span> повтор…';
      } else {
        toast(is529?"Серверы Anthropic перегружены. Попробуй через минуту.":e.message,"err");
        if(btn) btn.innerHTML="Создать пост";
        return;
      }
    }
  }
}

// ── BILLING ───────────────────────────────────
async function renderBilling() {
  await refreshUser();
  const pkgs=App.cfg?.packages||[];
  $("app").innerHTML=topbar()+`<div class="wrap">
    <div class="back-link" onclick="go('dashboard')">← назад</div>
    <div class="page-head"><h1>Баланс и пополнение</h1>
      <p>Текущий баланс: <b class="mono">${fmt(App.user?.token_balance||0)}</b> токенов</p></div>
    ${!App.cfg?.yoomoney_enabled?`<div class="card" style="border-color:var(--accent);background:var(--accent-soft)"><p style="color:var(--accent-dark)">Приём платежей пока не настроен.</p></div>`:""}
    <div class="grid grid-4">${pkgs.map(p=>`
      <div class="price-card">
        <div class="p-name">${esc(p.title)}</div>
        <div class="p-price">${fmt(p.rub)} ₽</div>
        <div class="p-tokens">${fmt(p.tokens)} токенов</div>
        <button class="btn" style="width:100%;justify-content:center" onclick="buy('${p.id}')">Купить</button>
      </div>`).join("")}</div>
    <div class="card" style="margin-top:16px">
      <div class="card-title">История платежей</div>
      <div id="payList" class="text-faint">Загрузка…</div>
    </div>
  </div>`;
  try {
    const ps=await api("GET","/payments");
    $("payList").innerHTML=ps.length
      ? ps.map(p=>`<div class="src-row">
          <span class="src-url">${new Date(p.created_at+"Z").toLocaleString("ru-RU")} · пакет «${esc(p.package_id)}» · ${fmt(p.tokens)} ток.</span>
          <span class="chip ${p.status==="paid"?"chip-green":"chip-orange"}">${p.status==="paid"?"оплачено":"ожидает"}</span>
        </div>`).join("")
      : `<p>Платежей пока не было.</p>`;
  } catch(_){}
}

async function buy(pid) {
  try {
    const r=await api("POST","/billing/buy",{package_id:pid});
    toast("Открываю оплату…","ok");
    window.open(r.payment_url,"_blank");
  } catch(e){toast(e.message,"err");}
}

// ── BOOT ──────────────────────────────────────
async function boot() {
  try { App.cfg=await api("GET","/config"); } catch(_){ App.cfg={packages:[]}; }
  if (!App.token) return renderAuth();
  try { App.user=await api("GET","/me"); go("dashboard"); }
  catch(_){ logout(); }
}

window.go=go; window.logout=logout; window.newChannel=newChannel;
window.setTab=setTab; window.pickLen=pickLen; window.pickSched=pickSched;
window.pickOpt=pickOpt; window.saveChannel=saveChannel; window.saveAdvanced=saveAdvanced;
window.verifyChannel=verifyChannel; window.analyzeChannel=analyzeChannel;
window.deleteChannel=deleteChannel; window.toggleCta=toggleCta;
window.addSource=addSource; window.delSource=delSource;
window.savePost=savePost; window.publishPost=publishPost;
window.rejectPost=rejectPost; window.deletePost=deletePost; window.schedulePrompt=schedulePrompt;
window.generateNow=generateNow; window.openGenPanel=openGenPanel; window.buy=buy;

boot();
