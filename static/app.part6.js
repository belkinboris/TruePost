

// BILLING
async function renderBilling(){
  await refreshUser();
  logProductEvent("pricing_viewed");
  const plans=[
    {id:"p1",name:"Старт",price:"990 ₽/мес",channels:1,postsMin:30,postsMax:60},
    {id:"p2",name:"Про",price:"2 490 ₽/мес",channels:3,postsMin:75,postsMax:150,popular:true},
    {id:"p3",name:"Бизнес",price:"7 990 ₽/мес",channels:10,postsMin:250,postsMax:500},
    {id:"p4",name:"Агентство",price:"14 990 ₽/мес",channels:0,postsMin:500,postsMax:1000},
  ];
  $("app").innerHTML=topbar("dashboard","назад")+`<div class="wrap">
    <div class="page-head"><h1>Тарифы</h1>
      <p>Осталось <b>${Math.floor((App.user?.token_balance||0)/40000)}–${Math.floor((App.user?.token_balance||0)/20000)}</b> постов.<br>
      <span style="font-size:13px;color:var(--text-faint)">Диапазон зависит от сложности: пост с поиском свежих новостей расходует больше, простой — меньше.</span></p></div>
    ${(!App.cfg?.yookassa_enabled&&!App.cfg?.yoomoney_enabled)?`<div class="card" style="border-color:var(--accent);background:var(--accent-soft);margin-bottom:16px">
      <p style="color:var(--accent-dark)">Приём платежей настраивается.</p></div>`:""}
    <div class="grid grid-2" style="margin-bottom:16px">
      ${plans.map(p=>`<div class="price-card" style="position:relative;${p.popular?"border-color:var(--accent)":""}">
        ${p.popular?`<div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;font-size:11px;font-weight:600;padding:2px 12px;border-radius:99px;white-space:nowrap">Популярный</div>`:""}
        <div class="p-name">${p.name}</div>
        <div class="p-price" style="font-size:24px">${p.price}</div>
        <div class="p-tokens" style="line-height:1.8">
          📺 ${p.channels===0?"Без лимита каналов":`${p.channels} ${p.channels===1?"канал":"канала"}`}<br>
          ✦ ${p.postsMin}–${p.postsMax} постов/мес</div>
        <button class="btn" style="width:100%;justify-content:center;margin-top:8px" onclick="buy('${p.id}')">Выбрать</button>
      </div>`).join("")}
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="card-title">🎁 Реферальная программа</div>
      <p style="font-size:14px;color:var(--text-dim);margin-bottom:12px">Пригласите друга — каждому из вас придёт примерно 6–10 бесплатных постов (200 000 токенов).</p>
      <div id="ref_block" class="text-faint">Загрузка…</div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <button onclick="togglePayHistory()" id="pay_hist_btn"
        style="background:none;border:none;cursor:pointer;font-size:14px;font-weight:600;color:var(--text);display:flex;align-items:center;gap:6px;width:100%;padding:0 0 12px">
        📋 История платежей <span id="pay_hist_arrow" style="font-size:12px;color:var(--text-faint)">▶</span>
      </button>
      <div id="payList" class="hidden text-faint"></div>
    </div>
    <div style="text-align:center;margin-top:16px;padding-bottom:8px">
      <button class="btn-danger btn-sm" onclick="deleteAccount()" style="font-size:12px;opacity:.6">Удалить аккаунт</button>
    </div>
    ${renderFooter()}</div>`;
  try{
    const me=await api("GET","/me");const code=me.ref_code||"";
    $("ref_block").innerHTML=`
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
        <div style="font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:600;letter-spacing:.1em;background:var(--surface2);border:1px solid var(--border-soft);border-radius:10px;padding:10px 18px;flex:1;text-align:center">${esc(code)}</div>
        <button class="btn-outline btn-sm" onclick="navigator.clipboard.writeText('${esc(code)}').then(()=>toast('Скопировано','ok'))">Копировать</button>
      </div>
      <div style="font-size:13px;color:var(--text-dim);background:var(--surface2);border-radius:10px;padding:12px 14px;line-height:1.7">
        1. Открой <a href="https://t.me/maintrpost_bot" target="_blank" style="color:var(--accent)">@maintrpost_bot</a><br>
        2. «Открыть АвтоПост» → Зарегистрироваться<br>
        3. Ввести реферальный код: <b>${esc(code)}</b>
      </div>
      <div class="hint" style="margin-top:8px">Приглашений: <b>${me.referrals_count||0}</b></div>`;
  }catch(_){}
  // История платежей загружается лениво при раскрытии
  window._loadPayHistory = async function(){
    try{
      const ps=await api("GET","/payments");
      ps.forEach(p=>{
        if(p.status==="paid"){
          const key="ym_paid_"+(p.id||p.label||p.created_at);
          if(!localStorage.getItem(key)){
            trackGoal("payment_success",{package_id:p.package_id||"",tokens:p.tokens||0,rub:p.rub||0});
            localStorage.setItem(key,"1");
          }
        }
      });
      $("payList").innerHTML=ps.length
        ?ps.map(p=>`<div class="src-row">
            <span class="src-url">${new Date(p.created_at+"Z").toLocaleString("ru-RU")} · ${fmt(p.tokens)} ток.</span>
            <span class="chip ${p.status==="paid"?"chip-green":"chip-orange"}">${p.status==="paid"?"оплачено":"ожидает"}</span>
          </div>`).join("")
        :`<p style="font-size:13px;color:var(--text-faint)">Платежей пока не было.</p>`;
    }catch(_){}
  };
}

function togglePayHistory(){
  const list=$("payList"),arrow=$("pay_hist_arrow");
  if(!list) return;
  const hidden=list.classList.contains("hidden");
  list.classList.toggle("hidden",!hidden);
  if(arrow) arrow.textContent=hidden?"▼":"▶";
  if(hidden && window._loadPayHistory) window._loadPayHistory();
}

async function buy(pid){
  logProductEvent("payment_cta_clicked", pid);
  try{
    const r = await api("POST", "/billing/buy", {package_id: pid});
    trackGoal("payment_started",{package_id:pid});
    if(!r.payment_url){
      logProductEvent("payment_failed", pid);
      toast("Не удалось получить ссылку на оплату","err");
      return;
    }
    // Telegram Mini App — используем встроенный метод
    if(window.Telegram?.WebApp?.openLink){
      window.Telegram.WebApp.openLink(r.payment_url);
    } else {
      window.location.href = r.payment_url;
    }
  } catch(e){
    logProductEvent("payment_failed", pid);
    toast(e&&e.message?e.message:"Ошибка запроса","err");
  }
}
async function deleteAccount(){
  if(!confirm("Удалить аккаунт?\n\nЭто удалит все каналы, посты и данные.")) return;
  if(prompt("Введите DELETE:")!=="DELETE") return toast("Отменено");
  try{await api("DELETE","/me");toast("Удалено","ok");logout();}catch(e){toast(e&&e.message?e.message:"Ошибка запроса","err");}
}

// COOKIE + KEYBOARD
async function verifyTgUsername(){
  const username=($("f_tg_username")||{value:""}).value.trim();
  if(!username) return toast("Введи @username","err");
  const btn=$("tg_check_btn"),msg=$("tg_check_msg");
  btn.innerHTML='<span class="spinner"></span>';btn.disabled=true;
  try{
    const r=await api("POST","/me/verify_tg",{username});
    msg.textContent=r.message;
    msg.style.color=r.ok?"var(--green)":"var(--red)";
    if(r.ok) App.user.tg_username=username;
  }catch(e){msg.textContent=e.message;msg.style.color="var(--red)";}
  btn.innerHTML="Проверить";btn.disabled=false;
}

async function toggleChannelEnabled(){
  const c=App._chan;
  const newVal=!c.enabled;
  try{
    await api("PATCH","/channels/"+c.id,{enabled:newVal});
    App._chan.enabled=newVal;
    if(newVal) App._chan.last_generated_at=new Date().toISOString(); // таймер с нуля
    const btn=$("pause_btn");
    if(btn){btn.textContent=newVal?"⏸ Пауза":"▶ Возобновить";btn.className=newVal?"btn-outline btn-sm":"btn btn-sm";}
    if(App.tab==="queue") renderQueue();
    toast(newVal?"Канал запущен — генерируем посты…":"Публикация приостановлена","ok");
  }catch(e){toast(e&&e.message?e.message:"Ошибка","err");}
}

function showPicker(id){
  const p=$("picker_"+id);if(!p) return;p.classList.remove("hidden");
  const dt=$("dt_"+id);if(dt) dt.value=new Date(Date.now()+3600000).toISOString().slice(0,16);
}
async function doSchedule(id){
  const dt=$("dt_"+id);if(!dt||!dt.value) return toast("Выберите дату","err");
  try{await api("POST","/posts/"+id+"/schedule",{scheduled_at:dt.value});toast("Запланировано ✓","ok");renderQueue();}
  catch(e){toast(e&&e.message?e.message:"Ошибка","err");}
}
function toggleEdit(id){
  const ta=$("pt_"+id),pw=$("ppreview_"+id),sb=$("save_"+id);if(!ta) return;
  const hidden=ta.classList.contains("hidden");
  ta.classList.toggle("hidden",!hidden);
  if(pw) pw.classList.toggle("hidden",hidden);
  if(sb) sb.classList.toggle("hidden",!hidden);
}
async function savePost(id){
  const el=$("pt_"+id);if(!el) return;
  try{await api("PATCH","/posts/"+id,{text:el.value});toast("Сохранено ✓","ok");renderQueue();}
  catch(e){toast(e&&e.message?e.message:"Ошибка","err");}
}
async function publishPost(id){
  if(!requireAuth()) return;
  // P0 fix (third issue): если канал не подключён к Telegram, не пытаемся
  // публиковать вообще — показываем понятное сообщение вместо того чтобы
  // дать запросу дойти до Telegram API и упасть с технической ошибкой.
  const chan = App._chan;
  if (chan && (!chan.tg_chat || !chan.verified)) {
    toast("Сначала подключите Telegram-канал, потом можно будет опубликовать пост.", "err");
    return;
  }

  const ta=$("pt_"+id);
  if(ta&&!ta.classList.contains("hidden")) try{await api("PATCH","/posts/"+id,{text:ta.value});}catch(_){}

  const card=$("pc_"+id);
  const btn=card?card.querySelector(`[onclick="publishPost(${id})"]`):null;
  if(btn){btn.innerHTML='<span class="spinner"></span> Публикуем…';btn.disabled=true;}

  const TIMEOUT_MS=18000;
  const {timedOut, error} = await withTimeout(api("POST","/posts/"+id+"/publish"), TIMEOUT_MS, "timeout");

  if(timedOut){
    if(btn) btn.innerHTML='<span class="spinner"></span> Проверяем статус…';
    const {confirmed}=await pollPostStatus(id);
    if(confirmed){toast("Опубликовано ✓","ok");renderQueue();return;}
    toast("Не удалось подтвердить публикацию. Проверьте канал или попробуйте ещё раз.","err");
    if(btn){btn.innerHTML="Опубликовать сейчас";btn.disabled=false;}
    return;
  }
  if(error){
    toast((error&&error.message)||"Не удалось опубликовать пост. Попробуйте ещё раз.","err");
    if(btn){btn.innerHTML="Опубликовать сейчас";btn.disabled=false;}
    return;
  }
  toast("Опубликовано ✓","ok");renderQueue();
}
async function rejectPost(id){
  try{await api("POST","/posts/"+id+"/reject");renderQueue();}
  catch(e){toast(e&&e.message?e.message:"Ошибка","err");}
}
async function deletePost(id){
  try{await api("DELETE","/posts/"+id);renderQueue();}
  catch(e){toast(e&&e.message?e.message:"Ошибка","err");}
}
async function regenPost(id){
  const btn=$("regen_"+id);if(btn){btn.innerHTML='<span class="spinner"></span>';btn.disabled=true;}
  try{
    await api("POST","/posts/"+id+"/reject");
    const r=await api("POST","/channels/"+App._chan.id+"/generate");
    toast("Готово ✓","ok");renderQueue();
  }catch(e){toast(e&&e.message?e.message:"Ошибка","err");if(btn){btn.innerHTML="↻ Заново";btn.disabled=false;}}
}

async function openTgConnect(){
  // Гарантируем что user загружен
  if(!App.user || !App.user.id){
    try{ App.user = await api("GET","/me"); }catch(e){}
  }
  const uid = App.user?.id;
  if(!uid){
    // Нет токена — пользователь не авторизован (например Mini App без localStorage)
    const twa = window.Telegram?.WebApp;
    if(twa && typeof twa.showAlert==='function'){
      twa.showAlert("Войдите в аккаунт на сайте autopost.projectsozdatel.ru, а затем откройте уведомления снова.");
    } else {
      toast("Не удалось определить аккаунт. Попробуйте войти заново.","err");
    }
    return;
  }
  const bot = App.cfg?.bot_username || "trpst_bot";
  const url = "https://t.me/" + bot + "?start=u" + uid;
  const twa = window.Telegram?.WebApp;
  if(twa?.openLink){
    twa.openLink(url);
  } else if(twa?.openTelegramLink){
    twa.openTelegramLink(url);
  } else {
    window.open(url,"_blank");
  }
}

function pickChannelType(type){
  App._chan.channel_type=type;
  const ta=$("adv_type_thematic"),tn=$("adv_type_news"),tl=$("adv_sched_title");
  if(ta) ta.style.border=type==="thematic"?"2px solid var(--accent)":"2px solid var(--border-soft)";
  if(ta) ta.style.background=type==="thematic"?"var(--accent-soft)":"";
  if(tn) tn.style.border=type==="news"?"2px solid var(--accent)":"2px solid var(--border-soft)";
  if(tn) tn.style.background=type==="news"?"var(--accent-soft)":"";
  if(tl) tl.textContent=type==="news"?"Проверять новости каждые":"Расписание";
}

function initCookieBanner(){
  if(localStorage.getItem("cookie_ok")) return;
  const b=document.createElement("div");
  b.style.cssText="position:fixed;bottom:0;left:0;right:0;background:#1a1815;color:#e9e6df;font-size:13px;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;gap:16px;z-index:9999;";
  b.innerHTML=`<span>Мы используем cookies. <a href="/legal/privacy" target="_blank" style="color:#d8b15e">Подробнее</a></span>
    <button onclick="this.parentElement.remove();localStorage.setItem('cookie_ok','1')"
      style="background:#d8b15e;color:#1a1404;border:none;border-radius:6px;padding:6px 14px;cursor:pointer;font-size:13px;font-weight:500">Понятно</button>`;
  document.body.appendChild(b);
}
function initKeyboardDismiss(){
  document.addEventListener("touchstart",function(e){
    const a=document.activeElement;
    if(a&&(a.tagName==="INPUT"||a.tagName==="TEXTAREA"))
      if(!e.target.closest("input,textarea,button,select,a")) a.blur();
  },{passive:true});
}

// BOOT
// ── Telegram SDK: асинхронная, не блокирующая загрузка (P0 fix) ──────
// Раньше SDK подключался блокирующим <script> тегом в index.html ДО
// app.js — при медленном/недоступном telegram.org это держало весь boot
// до 15-20 секунд. Теперь SDK грузится программно, параллельно с
// остальной загрузкой приложения, с явным таймаутом, и НИКОГДА не
// блокирует boot()/auth/quick start/channel list (task items 1-3, 6, 8).
const TELEGRAM_SDK_TIMEOUT_MS = 1800;
let _telegramSdkPromise = null;

function loadTelegramSdkAsync(){
  if(_telegramSdkPromise) return _telegramSdkPromise;
  try{ performance.mark('telegram_sdk_started'); }catch(_){}
  console.log('[timing] telegram_sdk_started');

  _telegramSdkPromise = new Promise((resolve)=>{
    // Уже загружен (например повторный вызов после первого успеха).
    if(window.Telegram?.WebApp){
      resolve(true);
      return;
    }
    let settled=false;
    const finish=(ok)=>{
      if(settled) return;
      settled=true;
      resolve(ok);
    };

    const timer=setTimeout(()=>{
      try{ performance.mark('telegram_sdk_failed_or_timeout'); }catch(_){}
      console.log(`[timing] telegram_sdk_failed_or_timeout (>${TELEGRAM_SDK_TIMEOUT_MS}ms)`);
      finish(false);
    }, TELEGRAM_SDK_TIMEOUT_MS);

    const script=document.createElement('script');
    script.src='https://telegram.org/js/telegram-web-app.js';
    script.async=true;
    script.onload=()=>{
      clearTimeout(timer);
      try{ performance.mark('telegram_sdk_loaded'); }catch(_){}
      console.log('[timing] telegram_sdk_loaded');
      finish(true);
    };
    script.onerror=()=>{
      clearTimeout(timer);
      try{ performance.mark('telegram_sdk_failed_or_timeout'); }catch(_){}
      console.log('[timing] telegram_sdk_failed_or_timeout (onerror)');
      finish(false);
    };
    document.head.appendChild(script);
  });

  return _telegramSdkPromise;
}

function initTelegram(){
  // Guarded (task item 4-5): если SDK недоступен — тихо работаем как
  // обычное браузерное приложение, никогда не падаем и не блокируем boot.
  const tg=window.Telegram?.WebApp;
  if(!tg) return;
  try{
    if(typeof tg.ready==='function') tg.ready();
    if(typeof tg.expand==='function') tg.expand();           // на весь экран
    if(typeof tg.setHeaderColor==='function') tg.setHeaderColor("#f5f1ea");
    if(typeof tg.setBackgroundColor==='function') tg.setBackgroundColor("#f5f1ea");
    if(typeof tg.disableVerticalSwipes==='function') tg.disableVerticalSwipes(); // не закрывать свайпом случайно
  }catch(_){}
}

// Запускаем загрузку SDK не дожидаясь её — если успеет загрузиться,
// initTelegram() вызовется повторно и безопасно доинициализирует
// Telegram-специфичные фичи. Если не успеет/упадёт — приложение уже
// полностью работает в обычном web-режиме, ничего не теряет.
function initTelegramAsync(){
  loadTelegramSdkAsync().then((ok)=>{
    if(ok) initTelegram();
  });
}

async function boot(){
  // Timing instrumentation (task item 4 + 7): измеряем каждый этап загрузки.
  try{ performance.mark('app_js_started'); }catch(_){}
  try{ performance.mark('boot_started'); }catch(_){}
  const t0 = performance.now();
  console.log(`[timing] boot() start, since navigation: ${t0.toFixed(0)}ms`);

  // КРИТИЧНО (P0 fix): Telegram SDK теперь грузится асинхронно и НЕ
  // блокирует ничего ниже — init запускается в фоне, boot() идёт дальше
  // не дожидаясь её. Раньше SDK был синхронным <script> тегом в HTML
  // ДО app.js, что при недоступности telegram.org держало весь boot до
  // 15-20 секунд (см. acceptance tests B/C в задаче).
  initTelegramAsync();
  initTelegram(); // если SDK уже был закэширован браузером — сработает сразу, без вреда если его ещё нет

  captureLandingSession();

  // КРИТИЧНО (BUG-003 fix): /config больше НЕ блокирует первый экран.
  // App.cfg используется только с ?. и фолбэками (bot_username, флаги
  // оплаты) — для первого рендера он не нужен. Раньше boot ждал ответа
  // /config до показа ЧЕГО-ЛИБО, и при холодном старте Railway (контейнер
  // спит после простоя, пробуждение 10-20 сек) пользователь всё это время
  // видел «Загрузка…». Теперь конфиг грузится в фоне, а экран появляется
  // сразу.
  App.cfg = App.cfg || {packages:[]};
  const tConfigStart = performance.now();
  api("GET","/config").then(cfg=>{
    App.cfg=cfg;
    console.log(`[timing] /config (background): ${(performance.now()-tConfigStart).toFixed(0)}ms`);
  }).catch(_=>{});

  initCookieBanner();initKeyboardDismiss();
  if(!App.token){
    console.log(`[timing] boot() total (no token, -> renderAuth): ${(performance.now()-t0).toFixed(0)}ms`);
    renderAuth();
    try{ performance.mark('first_screen_visible'); performance.mark('boot_complete'); }catch(_){}
    console.log('[timing] first_screen_visible (renderAuth)');
    return;
  }

  // BUG-003: пока /me грузится (при холодном старте Railway это может быть
  // 10-20 сек), показываем живой скелет вместо статичного «Загрузка…» из
  // index.html -- пользователь видит, что приложение работает, а не зависло.
  $("app").innerHTML=`<div class="wrap" style="max-width:560px;margin-top:60px;text-align:center">
    <div style="font-size:28px;margin-bottom:12px">✦</div>
    <p style="color:var(--text-dim)">Загружаем ваши каналы…</p>
    <p style="color:var(--text-faint);font-size:13px;margin-top:8px">Первый запуск после паузы может занять до полуминуты.</p>
  </div>`;

  try{ performance.mark('me_request_started'); }catch(_){}
  const tMeStart = performance.now();
  try{
    App.user=await api("GET","/me");
    try{ performance.mark('me_request_finished'); }catch(_){}
    console.log(`[timing] /me: ${(performance.now()-tMeStart).toFixed(0)}ms`);

    // payment_returned: пользователь вернулся со страницы оплаты. Это НЕ
    // означает успешную оплату — просто фиксирует факт возврата, чтобы
    // отличить "ушёл оплачивать и не вернулся" от "вернулся, но не оплатил".
    try{
      const params=new URLSearchParams(window.location.search);
      if(params.get("paid")){
        logProductEvent("payment_returned");
        params.delete("paid");
        const newUrl=window.location.pathname+(params.toString()?"?"+params.toString():"");
        window.history.replaceState({},"",newUrl);
      }
    }catch(_){}

    try{ performance.mark('channels_request_started'); }catch(_){}
    const tRouteStart = performance.now();
    await go("dashboard");
    try{ performance.mark('channels_request_finished'); }catch(_){}
    console.log(`[timing] go('dashboard') incl. /channels + render: ${(performance.now()-tRouteStart).toFixed(0)}ms`);

    try{ performance.mark('first_screen_visible'); }catch(_){}
    console.log('[timing] first_screen_visible (dashboard)');
  }catch(e){
    console.log(`[timing] /me failed after ${(performance.now()-tMeStart).toFixed(0)}ms: ${e&&e.message}`);
    // КРИТИЧНО (P0 fix, acceptance test C/D): logout() должен срабатывать
    // ТОЛЬКО при реальной невалидности сессии (401 -- api() уже сам вызвал
    // logout() в этом случае, внутри себя). Раньше ЛЮБАЯ ошибка /me —
    // включая временный сбой сети, таймаут, или backend ещё не поднялся
    // после деплоя/restart — тоже звала logout(), что СТИРАЛО валидный
    // токен пользователя. Это и есть прямая причина "hard refresh ломает
    // вход" и "после деплоя зарегистрироваться/войти не получается":
    // временная недоступность backend интерпретировалась как "сессия
    // истекла" и убивала токен, который на самом деле был совершенно рабочим.
    const isAuthFailure = e && e.message && (
      e.message.includes("Сессия истекла") ||
      e.message.includes("Не авторизован") ||
      e.message.includes("Пользователь не найден")
    );
    if (isAuthFailure) {
      // api() уже вызвал logout() сам для этого случая — здесь просто
      // показываем экран входа, не дублируем logout() второй раз.
      renderAuth();
    } else {
      // Временная проблема (сеть, cold start backend после деплоя) — токен
      // НЕ трогаем. Показываем мягкую ошибку с возможностью повторить,
      // вместо того чтобы выкинуть пользователя на экран регистрации.
      toast("Не удалось загрузить данные. Проверьте соединение и обновите страницу.", "err");
      $("app").innerHTML = `<div class="wrap" style="max-width:480px;text-align:center;margin-top:60px">
        <p style="color:var(--text-dim)">Не удалось подключиться к серверу.</p>
        <button class="btn" style="margin-top:12px" onclick="boot()">Попробовать снова</button>
      </div>`;
    }
    try{ performance.mark('first_screen_visible'); }catch(_){}
    console.log('[timing] first_screen_visible (error fallback)');
  }
  try{ performance.mark('boot_complete'); }catch(_){}
  console.log(`[timing] boot() total: ${(performance.now()-t0).toFixed(0)}ms`);
}

// GLOBALS
window.go=go;window.logout=logout;window.setTab=setTab;
window.pickLen=pickLen;window.pickOpt=pickOpt;window.pickAdv=pickAdv;
window.saveChannel=saveChannel;window.saveAdvanced=saveAdvanced;
window.showVerifyInput=showVerifyInput;window.verifyChannel=verifyChannel;window.analyzeChannel=analyzeChannel;
window.deleteChannel=deleteChannel;window.openGenPanel=openGenPanel;window.generateNow=generateNow;
window.addSource=addSource;window.delSource=delSource;
window.toggleHistory=toggleHistory;window.toggleExpand=toggleExpand;window.showPicker=showPicker;window.doSchedule=doSchedule;
window.toggleEdit=toggleEdit;window.savePost=savePost;window.publishPost=publishPost;
window.rejectPost=rejectPost;window.deletePost=deletePost;window.regenPost=regenPost;
window.testPost=testPost;window.buy=buy;window.togglePayHistory=togglePayHistory;window.deleteAccount=deleteAccount;
window.ncPickType=ncPickType;window.pickChannelType=pickChannelType;window.openTgConnect=openTgConnect;window.toggleChannelEnabled=toggleChannelEnabled;window.verifyTgUsername=verifyTgUsername;window.ncVerify=ncVerify;window.ncAnalyze=ncAnalyze;window.ncGenerate=ncGenerate;
window.ncSelect=ncSelect;window.ncP=ncP;window.ncHz=ncHz;window.ncSkipVerify=ncSkipVerify;window.ncShowVerify=ncShowVerify;
window.sendConsult=sendConsult;window.addSuggestedRule=addSuggestedRule;
window.addRule=addRule;window.deleteRule=deleteRule;window.trackGoal=trackGoal;

// Ждём загрузки DOM перед запуском
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
