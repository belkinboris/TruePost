

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