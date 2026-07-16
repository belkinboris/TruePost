window.onerror = function(msg, src, line, col, err) {
  document.body.innerHTML = '<div style="padding:20px;font-family:monospace;color:red">'
    + '<b>JS Error:</b><br>' + msg + '<br>Line: ' + line + '</div>';
  return false;
};
window.addEventListener('unhandledrejection', function(e) {
  document.body.innerHTML = '<div style="padding:20px;font-family:monospace;color:red">'
    + '<b>Promise Error:</b><br>' + (e.reason?.message || e.reason) + '</div>';
});

// Автопост SPA — полная версия
const App = {
  token: localStorage.getItem("ap_token"),
  user: null, cfg: null, view: "dashboard",
  channelId: null, tab: "queue", _chan: null,
  _onboardPosts: null, _consultHistory: [],
  // Флаг "пользователь осознанно пропустил онбординг" -- переживает перезагрузку.
  // Без этого renderDashboard() при chans.length===0 каждый раз возвращает на quick start.
  _onboardingSkipped: !!localStorage.getItem("ap_onboarding_skipped"),
};
const $ = id => document.getElementById(id);
const esc = s => (s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":'&#39;'}[c]));
const fmt = n => (n||0).toLocaleString("ru-RU");

function trackGoal(goal, params={}){
  try{
    if(window.ym && window.YM_COUNTER_ID){
      window.ym(window.YM_COUNTER_ID,"reachGoal",goal,params);
    }
  }catch(_){}
}

// ── CTA/Journey Diagnostics: захват lp_session + UTM из URL лендинга (Part 4) ──
const _sentLandingEvents = new Set(); // дедуп в рамках одной загрузки страницы

function captureLandingSession(){
  try{
    // 1. Telegram Mini App: ?startapp=lp_<id> приходит как start_param, не как обычный query-параметр
    const tg=window.Telegram?.WebApp;
    const startParam=tg?.initDataUnsafe?.start_param || new URLSearchParams(window.location.search).get("tgWebAppStartParam");
    if(startParam && startParam.startsWith("lp_")){
      const sessionId=startParam.slice(3);
      localStorage.setItem("ap_lp_session",sessionId);
      // Это открытие Mini App из лендинга, а не серверный /start у бота —
      // событие отражает именно это (см. diagnostic_notes на backend).
      logLandingEventWeb("bot_start_from_landing");
      logLandingEventWeb("web_register_opened");
      return;
    }

    // 2. Обычный веб-переход: /?lp_session=<id>&utm_...
    const params=new URLSearchParams(window.location.search);
    const lpSession=params.get("lp_session");
    if(lpSession){
      localStorage.setItem("ap_lp_session",lpSession);
      const utm={
        utm_source:params.get("utm_source")||"",
        utm_medium:params.get("utm_medium")||"",
        utm_campaign:params.get("utm_campaign")||"",
        utm_content:params.get("utm_content")||"",
      };
      if(utm.utm_source||utm.utm_medium||utm.utm_campaign||utm.utm_content){
        localStorage.setItem("ap_lp_utm",JSON.stringify(utm));
      }
      logLandingEventWeb("web_register_opened");
    }
  }catch(_){}
}

function logLandingEventWeb(eventName){
  try{
    const sessionId=localStorage.getItem("ap_lp_session");
    if(!sessionId) return; // не из лендинга — не логируем, не нужный шум

    // Дедуп: одно и то же (session_id, event) не отправляем повторно за время
    // жизни вкладки. Для событий которые логически должны случиться один раз
    // за сессию лендинга (web_register_opened, register_success) дедуп
    // дополнительно переживает full page reload через localStorage —
    // иначе повторный boot() после регистрации или ре-рендер страницы
    // отправляет событие ещё раз.
    const dedupKey=sessionId+":"+eventName;
    if(_sentLandingEvents.has(dedupKey)) return;
    const PERSISTENT_DEDUP_EVENTS=["web_register_opened","register_success","bot_start_from_landing"];
    if(PERSISTENT_DEDUP_EVENTS.includes(eventName)){
      const sentKey="ap_lp_sent_"+eventName+"_"+sessionId;
      if(localStorage.getItem(sentKey)) return;
      localStorage.setItem(sentKey,"1");
    }
    _sentLandingEvents.add(dedupKey);

    const utm=JSON.parse(localStorage.getItem("ap_lp_utm")||"{}");
    fetch("/api/landing-event",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        session_id:sessionId,
        event:eventName,
        url:window.location.href,
        utm_source:utm.utm_source||"",
        utm_medium:utm.utm_medium||"",
        utm_campaign:utm.utm_campaign||"",
        utm_content:utm.utm_content||"",
        user_agent:navigator.userAgent||"",
      }),
      keepalive:true,
    }).catch(()=>{});
  }catch(_){}
}

function logProductEvent(eventName, packageId){
  // Минимальная диагностика payment path (не для рекламной атрибуции —
  // для этого LandingEvent/Метрика). Требует токена, потому что эти события
  // происходят только после регистрации. Fire-and-forget — не блокирует
  // действие пользователя, не показывает ошибку при сбое.
  try{
    if(!App.token) return;
    fetch("/api/product-event",{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+App.token},
      body:JSON.stringify({event:eventName, package_id:packageId||""}),
      keepalive:true,
    }).catch(()=>{});
  }catch(_){}
}

function cleanPostText(text){
  if(!text) return "";
  let t=text.trim();
  // Режем thinking-блок до разделителя ---
  const dashIdx=t.indexOf("\n---");
  if(dashIdx>=0 && dashIdx<300){
    t=t.slice(dashIdx+4).replace(/^-+/,"").trim();
  }
  // Убираем первый абзац если это рассуждение ИИ
  const thinkRe=/^(Беру|Взял|Нашёл|Нашел|Выбрал|Использую|Из поиска|По результатам|Проверил|Вижу|Смотрю|Ищу|Изучил|Анализирую)\b/i;
  const paras=t.split(/\n\s*\n/);
  if(paras.length>1 && thinkRe.test(paras[0].trim())){
    t=paras.slice(1).join("\n\n").trim();
  }
  return t;
}

function renderTg(text) {
  if (!text) return "";
  return esc(cleanPostText(text))
    .replace(/&lt;b&gt;(.*?)&lt;\/b&gt;/gs,"<b>$1</b>")
    .replace(/&lt;i&gt;(.*?)&lt;\/i&gt;/gs,"<i>$1</i>")
    .replace(/\n/g,"<br>");
}

function toast(msg, kind="") {
  // Последний рубеж защиты (P0 fix): что бы ни передали в toast — никогда
  // не показываем [object Object] или другой нечитаемый JS-объект.
  if (typeof msg !== "string") {
    if (msg && typeof msg.message === "string") msg = msg.message;
    else msg = "Не удалось выполнить действие. Попробуйте ещё раз.";
  }
  document.querySelectorAll(".toast").forEach(t=>t.remove());
  const t=document.createElement("div");
  t.className="toast "+kind; t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),3200);
}

async function api(method, path, body) {
  const opts={method,headers:{}};
  const hadToken = !!App.token;
  if (App.token) opts.headers["Authorization"]="Bearer "+App.token;
  if (body!==undefined){opts.headers["Content-Type"]="application/json";opts.body=JSON.stringify(body);}
  const res=await fetch("/api"+path,opts);

  let data=null;
  try{data=await res.json();}catch(_){}

  if (res.status===401){
    // Debugging requirements (P0 task): логируем контекст 401 явно, чтобы
    // на реальных логах/консоли можно было увидеть что произошло, вместо
    // догадок. path/hadToken/server detail — минимум для диагностики.
    console.log(`[auth] 401 from ${method} ${path}, hadToken=${hadToken}, server_detail=${JSON.stringify(data&&data.detail)}`);

    // КРИТИЧНО (P0 fix): register/login НЕ отправляют токен и не должны
    // попадать под "сессия истекла" вообще — это другая категория ошибки
    // (например бэкенд недоступен, неверный путь, или временный сбой).
    // Раньше любой 401 от ЛЮБОГО запроса (включая саму регистрацию) сразу
    // звал logout() и показывал жёстко закодированный текст "Сессия истекла"
    // ДО того как тело ответа даже читалось — это не давало пользователю
    // увидеть реальную причину и блокировало первую попытку регистрации.
    if (path === "/register" || path === "/login") {
      throw new Error((data && data.detail) || "Не удалось войти. Попробуйте ещё раз.");
    }

    // Для остальных запросов 401 значит реально невалидный/истёкший токен —
    // здесь оправдан logout() и чистый переход на экран входа, а не dead-end.
    if (hadToken) {
      logout();
      throw new Error("Сессия истекла, войдите снова.");
    }

    // 401 без токена на защищённом эндпоинте — не должно происходить в
    // обычном UI-потоке (кнопки защищённых действий не доступны без логина),
    // но если как-то случилось — не зовём logout() на пустом месте.
    throw new Error((data && data.detail) || "Нужно войти в аккаунт.");
  }

  if(!res.ok){
    // КРИТИЧНО (P0 fix): data.detail от FastAPI не всегда строка. При 422
    // (ошибка валидации Pydantic) это список объектов вида
    // [{"loc":[...],"msg":"...","type":"..."}] — если такой объект попадает
    // в new Error() напрямую, его message превращается в нечитаемое
    // "[object Object]" в toast. Нормализуем здесь централизованно.
    let detail = data && data.detail;
    let msg = "Ошибка запроса";
    if (typeof detail === "string") {
      msg = detail;
    } else if (Array.isArray(detail) && detail.length) {
      // Pydantic validation error array — берём первое читаемое сообщение.
      msg = detail.map(d => (d && typeof d.msg === "string") ? d.msg : null).filter(Boolean).join("; ") || "Проверьте введённые данные.";
    } else if (detail && typeof detail === "object") {
      msg = detail.message || detail.msg || "Ошибка запроса";
    }
    throw new Error(msg);
  }
  return data;
}

function logout(){
  App.token=null;App.user=null;
  localStorage.removeItem("ap_token");
  renderAuth();
}

// Task B rules 2-3: защищённые действия должны проверять auth до запроса
// и показывать понятное сообщение, а не давать сырому 401 всплыть из api().
// Используется как первая строка в обработчиках кнопок "Все каналы",
// "Сгенерировать пост", "Подключить канал", "Опубликовать сейчас",
// "Открыть настройки" и т.п.
function requireAuth(){
  if(App.token) return true;
  toast("Сначала войдите или зарегистрируйтесь, чтобы продолжить.","err");
  renderAuth();
  return false;
}

async function refreshUser(){try{App.user=await api("GET","/me");}catch(_){}}

async function go(view,channelId){
  // Task B rule 2: все представления через go() — защищённые действия
  // залогиненного пользователя. Проверяем один раз здесь, не дублируя в
  // каждом отдельном обработчике (renderDashboard, renderQuickStart и т.д.).
  if(!requireAuth()) return;
  App.view=view;
  if(channelId!==undefined) App.channelId=channelId;
  if(view==="dashboard") return renderDashboard();
  if(view==="new_channel") return renderNewChannelRouter();
  if(view==="connect_channel") return renderConnectChannel();
  if(view==="channel") return renderChannel();
  if(view==="billing") return renderBilling();
}

async function renderNewChannelRouter(){
  // Task item 4: quick start — только для самого первого канала. Если у
  // пользователя уже есть хотя бы один канал, "Новый канал" должен вести
  // на полноценную форму с настройками, не на упрощённый онбординг.
  let chans=[];
  try{ chans = await api("GET","/channels"); }catch(_){}
  if(chans.length>0) return renderNewChannelSettings();
  return renderQuickStart();
}

// AUTH
function renderAuth(mode="login"){
  $("app").innerHTML=`<div class="auth-wrap"><div class="auth-box">
    <div class="auth-logo">Авто<span>пост</span></div>
    <div class="auth-sub">ИИ ведёт твой Telegram-канал на автопилоте</div>
    <div class="card">
      <label class="field"><span class="field-label">Email</span>
        <input id="em" type="email" placeholder="you@mail.ru" autocomplete="username"></label>
      <label class="field mt"><span class="field-label">Пароль</span>
        <input id="pw" type="password" placeholder="минимум 6 символов"></label>
      ${mode==="register"?`<label class="field mt"><span class="field-label">Реферальный код (необязательно)</span>
        <input id="ref" placeholder="код друга"></label>`:""}
      <button class="btn" style="width:100%;margin-top:18px;justify-content:center" id="authBtn">
        ${mode==="login"?"Войти":"Создать аккаунт"}</button>
      ${mode==="register"?`<div style="font-size:12px;color:var(--text-faint);text-align:center;margin-top:10px;line-height:1.5">
        Регистрируясь, вы принимаете <a href="/legal/offer" target="_blank">условия оферты</a>
        и <a href="/legal/privacy" target="_blank">политику конфиденциальности</a></div>`:""}
      <div class="auth-switch">${mode==="login"
        ?`Нет аккаунта? <a id="sw">Зарегистрироваться →</a>`
        :`Уже есть аккаунт? <a id="sw">Войти</a>`}</div>
    </div></div></div>`;
  $("authBtn").onclick=async()=>{
    const email=$("em").value.trim(),password=$("pw").value;
    if(!email||!password) return toast("Заполните email и пароль","err");
    const body={email,password};
    if(mode==="register"&&$("ref")&&$("ref").value.trim()) body.ref_code=$("ref").value.trim();
    if(mode==="register"){
      try{
        const lpSession=localStorage.getItem("ap_lp_session");
        if(lpSession){
          body.lp_session=lpSession;
          const utm=JSON.parse(localStorage.getItem("ap_lp_utm")||"{}");
          if(utm.utm_source) body.utm_source=utm.utm_source;
          if(utm.utm_medium) body.utm_medium=utm.utm_medium;
          if(utm.utm_campaign) body.utm_campaign=utm.utm_campaign;
          if(utm.utm_content) body.utm_content=utm.utm_content;
        }
      }catch(_){}
    }
    try{
      const isRegister = mode === "register";
      const r=await api("POST",isRegister?"/register":"/login",body);
      App.token=r.token;localStorage.setItem("ap_token",r.token);
      trackGoal(isRegister?"register_success":"login_success");
      // register_success в LandingEvent пишет backend /api/register
      // после реального создания пользователя — фронт не дублирует это событие.
      await boot();
    }catch(e){
      // КРИТИЧНО (Task A fix): явная, предсказуемая классификация ошибки —
      // не полагаемся на хрупкое совпадение подстрок типа "401" (могло
      // случайно сработать не на том сообщении). api() уже гарантирует, что
      // для /login и /register никогда не бросается "Сессия истекла" (это
      // исключено на уровне api() для этих двух путей) — здесь только
      // явные, ожидаемые варианты текста с backend и сети.
      const raw = (e && e.message) || "";
      let msg;
      if (raw.includes("Failed to fetch") || raw.includes("NetworkError") || raw.includes("network")) {
        msg = "Не удалось подключиться. Проверьте интернет и попробуйте ещё раз.";
      } else if (raw.includes("уже есть") || raw.toLowerCase().includes("already")) {
        msg = "Этот email уже зарегистрирован.";
      } else if (raw.includes("Неверный email или пароль")) {
        msg = "Неверный email или пароль.";
      } else if (raw.includes("6 символ")) {
        msg = "Пароль должен быть не менее 6 символов.";
      } else if (raw) {
        // Любой другой текст с backend — показываем как есть, не подменяем
        // на дженерик и тем более не на "сессия истекла".
        msg = raw;
      } else {
        msg = "Что-то пошло не так. Попробуйте ещё раз.";
      }
      toast(msg,"err");
    }
  };
  if($("sw")) $("sw").onclick=()=>renderAuth(mode==="login"?"register":"login");
  $("pw").onkeydown=e=>{if(e.key==="Enter") $("authBtn").click();};
}

// TOPBAR
function topbar(backView,backLabel){
  const back=backView?`<div class="back-row"><button class="back-link" onclick="go('${backView}')">← ${backLabel||"назад"}</button></div>`:"";
  // Task D fix: не показываем "токены" пользователю и не считаем точное
  // количество постов через жёсткое деление — это создавало неточный текст
  // вида "осталось ~1 пост" при старом малом лимите. После увеличения
  // бесплатной квоты до 200k порог пересчитан пропорционально (раньше был
  // 20000 при квоте ~111000, те же ~18% от квоты).
  const low=App.user&&App.user.token_balance<36000;
  if(low && !window._quotaWarningLogged){
    window._quotaWarningLogged=true; // раз за вкладку, не на каждый рендер topbar()
    logProductEvent("quota_warning_seen");
  }
  const lowBanner=low?`<div style="background:#fef3c7;border-bottom:1px solid #f59e0b;padding:8px 20px;font-size:13px;text-align:center;color:#92400e">
    ⚠️ Баланс заканчивается.
    <a onclick="go('billing')" style="color:#92400e;font-weight:600;cursor:pointer;text-decoration:underline">Пополнить →</a></div>`:"";
  return `<div class="topbar">
    <a class="brand" onclick="go('dashboard')"><span class="brand-name">Авто<span>пост</span></span></a>
    <div class="topbar-right">
      <div class="token-pill" onclick="go('billing')">
        <span class="dot" style="background:var(--accent)"></span>
        <span style="font-size:13px;font-weight:500;color:var(--text-dim)">Тарифы</span>
      </div>
      <button class="btn-ghost btn-sm" onclick="logout()">Выйти</button>
    </div></div>${lowBanner}${back}`;
}

function renderFooter(){
  return `<div style="margin-top:auto;text-align:center;padding:48px 16px 24px;font-size:12px;color:var(--text-faint);line-height:1.8">
    ИП Белкин Б.Б. · ИНН 771387918350 · ОГРНИП 324774600432188<br>
    <a href="/legal/offer" target="_blank" style="color:var(--text-faint)">Оферта</a> &nbsp;·&nbsp;
    <a href="/legal/privacy" target="_blank" style="color:var(--text-faint)">Конфиденциальность</a> &nbsp;·&nbsp;
    <a href="/legal/refund" target="_blank" style="color:var(--text-faint)">Возврат</a></div>`;
}

// DASHBOARD
function _intervalLabel(h){
  if(h<1) return `${Math.round(h*60)} мин`;
  if(h===1) return "каждый час";
  if(h<24) return `каждые ${h}ч`;
  return `каждые ${h/24|0}д`;
}
function _nextGenerationLabel(c){
  if(c.enabled===false) return "на паузе";
  // Время следующей ГЕНЕРАЦИИ (не публикации!) = последняя генерация + интервал,
  // но не в прошлом. Публикация — отдельное понятие, происходит либо по явному
  // подтверждению пользователя, либо для scheduled-постов (см. renderPostCard).
  const intervalMs=(c.interval_hours||12)*3600000;
  const now=Date.now();
  let next;
  if(c.last_generated_at){
    next=new Date(c.last_generated_at+"Z").getTime()+intervalMs;
    if(next<now) next=now+60000;
  } else {
    next=now+intervalMs;
  }
  const diff=next-now;
  const h=Math.floor(diff/3600000),m=Math.floor((diff%3600000)/60000);
  const ts=new Date(next).toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"});
  return h>0?`через ${h}ч ${m}м (в ${ts})`:`через ${m}м (в ${ts})`;
}

async function renderDashboard(){
  // Skeleton сразу, без ожидания данных (task item 4 acceptance criteria:
  // "dashboard shows skeleton/loader immediately, no blank screen").
  $("app").innerHTML=`<div class="wrap"><div class="text-faint" style="padding:40px;text-align:center">Загрузка…</div></div>`;

  const tUserStart = performance.now();
  await refreshUser();
  console.log(`[timing] refreshUser() в renderDashboard: ${(performance.now()-tUserStart).toFixed(0)}ms`);

  let chans=[];
  let channelsLoadFailed=false;
  const tChansStart = performance.now();
  try{
    chans=await api("GET","/channels");
  }catch(e){
    channelsLoadFailed=true;
    const msg=(e&&e.message)||"";
    const isAuthFailure = msg.includes("Сессия истекла") || msg.includes("Не авторизован") || msg.includes("Пользователь не найден");
    if(isAuthFailure){
      // КРИТИЧНО (Task B fix): api() уже вызвал logout() сам для этого
      // случая — здесь просто показываем экран входа и ВЫХОДИМ, не
      // продолжаем выполнение. Раньше этот catch проглатывал ошибку молча,
      // chans оставался пустым массивом, и код ниже интерпретировал это
      // как "новый пользователь без каналов" -> показывал quick start.
      // Реальная причина — истёкшая сессия, не отсутствие каналов. Это и
      // была причина "quick start появляется неожиданно" + "не авторизован
      // до hard reload": пользователь оказывался на quick start с мёртвым
      // токеном, и любое защищённое действие там падало с 401 заново.
      return renderAuth();
    }
    // Не auth-ошибка (сеть, временный сбой backend) — показываем тост,
    // но НЕ показываем quick start как будто пользователь новый.
    toast(msg||"Ошибка запроса","err");
  }
  console.log(`[timing] /channels: ${(performance.now()-tChansStart).toFixed(0)}ms, count=${chans.length}`);

  if(channelsLoadFailed){
    // Сеть/временный сбой — даём пользователю явный повтор, не выдаём
    // молчаливый quick start или пустой дашборд.
    $("app").innerHTML = `<div class="wrap" style="max-width:480px;text-align:center;margin-top:60px">
      <p style="color:var(--text-dim)">Не удалось загрузить список каналов.</p>
      <button class="btn" style="margin-top:12px" onclick="go('dashboard')">Попробовать снова</button>
    </div>`;
    return;
  }

  if(!chans.length){
    if(App._onboardingSkipped){
      // Пользователь явно нажал "Пропустить" — показываем пустой dashboard
      // с явным призывом создать канал, не зацикливаем обратно на quick start.
      $("app").innerHTML=topbar()+`<div class="wrap">
        <div class="page-head"><h1>Твои каналы</h1><p>Пока нет ни одного канала.</p></div>
        <div class="grid grid-3">
          <div class="add-card" onclick="go('new_channel')"><div class="plus">+</div>
            <div style="font-size:14px;font-weight:500">Новый канал</div></div>
        </div>
        <div id="dash_footer"></div></div>`;
      const df=$("dash_footer");if(df) df.innerHTML=renderFooter();
      return;
    }
    return renderQuickStart(); // новый пользователь — сразу к первому посту, без пустого дашборда
  }
  $("app").innerHTML=topbar()+`<div class="wrap">
    <div class="page-head"><h1>Твои каналы</h1><p>ИИ пишет посты сам — тебе только выбирать лучший.</p></div>
    <div class="grid grid-3" id="chans"><div class="text-faint">Загрузка…</div></div>
    <div id="dash_footer"></div></div>`;
  const df=$("dash_footer");if(df) df.innerHTML=renderFooter();
  $("chans").innerHTML=chans.map(c=>{
    const verified=c.verified?`<span class="chip chip-green">● подключён</span>`:`<span class="chip chip-orange">● не проверен</span>`;
    return `<div class="chan-card" onclick="go('channel',${c.id})">
      <h3>${esc(c.title)}</h3>
      <div class="chan-handle">${esc(c.tg_chat||"не подключён")}</div>
      <div class="chan-about">${esc(c.about)||"<span class='text-faint'>тема не задана</span>"}</div>
      <div class="chan-foot">${verified}
        <span class="chip chip-gray">🕑 ${_intervalLabel(c.interval_hours||12)}</span>
        <span class="chip chip-blue">⏱ ${_nextGenerationLabel(c)}</span>
      </div></div>`;
  }).join("")+`<div class="add-card" onclick="go('new_channel')"><div class="plus">+</div>
    <div style="font-size:14px;font-weight:500">Новый канал</div></div>`;
}

// ONBOARDING — переменные используются старой полной формой (renderNewChannel),
// доступной из вкладки "Расширенные" внутри уже созданного канала.
let _ncType="thematic";
let _ncVoice="author",_ncFormat="story",_ncEmoji="minimal",_ncCta=false,_ncCtaText="",_ncHz=12,_ncStyleProfile="";

// QUICK START — минимальный онбординг: тема -> первый пост, без подключения канала
function renderQuickStart(){
  trackGoal("quick_start_viewed");

  // КРИТИЧНО (P0 fix, task item 1): каждый новый quick start начинается с
  // полностью чистого состояния.
  App._qsRequestId = "qs" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  App.channelId = null;
  App._qsAbout = "";
  App._chan = null;

  // Экран выбора: что делать сначала?
  $("app").innerHTML=`<div class="wrap" style="max-width:560px">
    <button class="back-link" style="margin-top:12px" onclick="qsSkip()">Пропустить →</button>
    <div class="page-head" style="text-align:center;margin-top:8px">
      <h1 style="font-family:'Instrument Serif',serif;font-size:30px;font-weight:400">Что сделать сначала?</h1>
      <p style="color:var(--text-dim)">Выберите — с чего начнём</p>
    </div>
    <div style="display:flex;flex-direction:column;gap:12px;margin-top:24px">
      <button class="btn" style="width:100%;justify-content:center;padding:16px;font-size:16px"
        onclick="qsChooseGenerate()">Сгенерировать первый пост</button>
      <button onclick="qsChooseAnalyze()"
        style="width:100%;padding:16px;font-size:16px;border-radius:10px;border:1.5px solid var(--border);background:var(--surface);cursor:pointer;font-family:inherit;color:var(--text)">
        Проанализировать мой Telegram-канал
      </button>
    </div>
    <div style="text-align:center;margin-top:20px">
      <button class="btn-ghost btn-sm" style="color:var(--text-faint)" onclick="qsSkip()">Пропустить</button>
    </div>
  </div>`;
}

function qsChooseGenerate(){
  logProductEvent("onboarding_choice_selected", "generate_first_post");
  renderQuickStartGenerate();
}