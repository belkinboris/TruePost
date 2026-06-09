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
};
const $ = id => document.getElementById(id);
const esc = s => (s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":'&#39;'}[c]));
const fmt = n => (n||0).toLocaleString("ru-RU");

function renderTg(text) {
  if (!text) return "";
  return esc(text)
    .replace(/&lt;b&gt;(.*?)&lt;\/b&gt;/gs,"<b>$1</b>")
    .replace(/&lt;i&gt;(.*?)&lt;\/i&gt;/gs,"<i>$1</i>")
    .replace(/\n/g,"<br>");
}

function toast(msg, kind="") {
  document.querySelectorAll(".toast").forEach(t=>t.remove());
  const t=document.createElement("div");
  t.className="toast "+kind; t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),3200);
}

async function api(method, path, body) {
  const opts={method,headers:{}};
  if (App.token) opts.headers["Authorization"]="Bearer "+App.token;
  if (body!==undefined){opts.headers["Content-Type"]="application/json";opts.body=JSON.stringify(body);}
  const res=await fetch("/api"+path,opts);
  if (res.status===401){logout();throw new Error("Сессия истекла");}
  let data=null;
  try{data=await res.json();}catch(_){}
  if(!res.ok) throw new Error((data&&data.detail)||"Ошибка запроса");
  return data;
}

function logout(){
  App.token=null;App.user=null;
  localStorage.removeItem("ap_token");
  renderAuth();
}

async function refreshUser(){try{App.user=await api("GET","/me");}catch(_){}}

async function go(view,channelId){
  App.view=view;
  if(channelId!==undefined) App.channelId=channelId;
  if(view==="dashboard") return renderDashboard();
  if(view==="new_channel") return renderNewChannel();
  if(view==="channel") return renderChannel();
  if(view==="billing") return renderBilling();
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
    try{
      const r=await api("POST",mode==="login"?"/login":"/register",body);
      App.token=r.token;localStorage.setItem("ap_token",r.token);await boot();
    }catch(e){
      let msg=e.message||"Что-то пошло не так";
      if(msg.includes("уже есть")) msg="Этот email уже зарегистрирован.";
      else if(msg.includes("Неверный")||msg.includes("401")) msg="Неверный email или пароль.";
      else if(msg.includes("6 символ")) msg="Пароль должен быть не менее 6 символов.";
      else if(msg.includes("Failed to fetch")) msg="Нет соединения с сервером.";
      toast(msg,"err");
    }
  };
  if($("sw")) $("sw").onclick=()=>renderAuth(mode==="login"?"register":"login");
  $("pw").onkeydown=e=>{if(e.key==="Enter") $("authBtn").click();};
}

// TOPBAR
function topbar(backView,backLabel){
  const back=backView?`<div class="back-row"><button class="back-link" onclick="go('${backView}')">← ${backLabel||"назад"}</button></div>`:"";
  const low=App.user&&App.user.token_balance<20000;
  const lowBanner=low?`<div style="background:#fef3c7;border-bottom:1px solid #f59e0b;padding:8px 20px;font-size:13px;text-align:center;color:#92400e">
    ⚠️ Токены заканчиваются — осталось ~1 пост.
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
  return `<div style="text-align:center;padding:32px 16px 16px;font-size:12px;color:var(--text-faint);line-height:1.8">
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
function _nextTimeLabel(c){
  if(!c.last_generated_at) return "скоро";
  const last=new Date(c.last_generated_at+"Z");
  const next=new Date(last.getTime()+(c.interval_hours||12)*3600000);
  const diff=next-Date.now();
  if(diff<=0) return "скоро";
  const h=Math.floor(diff/3600000),m=Math.floor((diff%3600000)/60000);
  const ts=next.toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"});
  return h>0?`через ${h}ч ${m}м (в ${ts})`:`через ${m}м (в ${ts})`;
}

async function renderDashboard(){
  await refreshUser();
  $("app").innerHTML=topbar()+`<div class="wrap">
    <div class="page-head"><h1>Твои каналы</h1><p>ИИ пишет посты сам — тебе только выбирать лучший.</p></div>
    <div class="grid grid-3" id="chans"><div class="text-faint">Загрузка…</div></div>
    <div id="dash_footer"></div></div>`;
  const df=$("dash_footer");if(df) df.innerHTML=renderFooter();
  let chans=[];
  try{chans=await api("GET","/channels");}catch(e){toast(e&&e.message?e.message:"Ошибка запроса","err");}
  if(!chans.length){
    $("chans").innerHTML=`<div class="add-card" onclick="go('new_channel')" style="grid-column:1/-1;max-width:320px">
      <div class="plus">+</div><div style="font-weight:500">Добавить первый канал</div>
      <div style="font-size:13px;color:var(--text-faint);margin-top:4px">Займёт 2 минуты</div></div>`;
    return;
  }
  $("chans").innerHTML=chans.map(c=>{
    const verified=c.verified?`<span class="chip chip-green">● подключён</span>`:`<span class="chip chip-orange">● не проверен</span>`;
    return `<div class="chan-card" onclick="go('channel',${c.id})">
      <h3>${esc(c.title)}</h3>
      <div class="chan-handle">${esc(c.tg_chat||"не подключён")}</div>
      <div class="chan-about">${esc(c.about)||"<span class='text-faint'>тема не задана</span>"}</div>
      <div class="chan-foot">${verified}
        <span class="chip chip-gray">🕑 ${_intervalLabel(c.interval_hours||12)}</span>
        <span class="chip chip-blue">⏱ ${_nextTimeLabel(c)}</span>
      </div></div>`;
  }).join("")+`<div class="add-card" onclick="go('new_channel')"><div class="plus">+</div>
    <div style="font-size:14px;font-weight:500">Новый канал</div></div>`;
}

// ONBOARDING
let _ncType="thematic";
let _ncVoice="author",_ncFormat="story",_ncEmoji="minimal",_ncCta=false,_ncCtaText="",_ncHz=12,_ncStyleProfile="";

function renderNewChannel(){
  _ncVoice="author";_ncFormat="story";_ncEmoji="minimal";_ncCta=false;_ncCtaText="";_ncHz=12;_ncStyleProfile="";
  $("app").innerHTML=topbar("dashboard","все каналы")+`<div class="wrap" style="max-width:680px">
    <div class="page-head"><h1>Новый канал</h1>
      <p>Расскажи о канале — ИИ покажет три варианта постов на выбор.</p></div>
    <div class="card">
      <label class="field"><span class="field-label">Название (для тебя)</span>
        <input id="nc_title" placeholder="Например: Крипта без воды" maxlength="80"></label>

      <label class="field mt"><span class="field-label">@username канала или ссылка t.me/</span>
        <div id="nc_verify_block">
          <div class="row" style="gap:8px">
            <input id="nc_chat" placeholder="@my_channel или https://t.me/channel" style="flex:1">
            <button class="btn-outline btn-sm" onclick="ncVerify()" id="nc_vbtn" style="white-space:nowrap">Проверить</button>
          </div>
          <div class="hint">1. Добавь бота <b>@${esc(App.cfg?.bot_username||"…")}</b> администратором.<br>2. Вставь @username. 3. Нажми «Проверить».</div>
          <div id="nc_vmsg" style="font-size:13px;margin-top:6px"></div>
          <button class="btn-ghost btn-sm" onclick="ncSkipVerify()"
            style="margin-top:6px;font-size:12px;color:var(--text-faint)">Подключить позже →</button>
        </div>
        <div id="nc_verify_skipped" class="hidden" style="font-size:13px;color:var(--text-faint);padding:8px 0">
          ✓ Пропущено — подключите канал позже в настройках.
          <button class="btn-ghost btn-sm" onclick="ncShowVerify()" style="font-size:12px;margin-left:4px">Подключить сейчас</button>
        </div>
      </label>

      <label class="field mt"><span class="field-label">О чём канал</span>
        <textarea id="nc_about" rows="3" placeholder="Опиши идею — о чём, для кого, что интересно аудитории"></textarea></label>
      <div class="hint"><b>Примеры:</b><br>
        · <i>Крипта: новости, разбор монет, инвестиционные идеи</i><br>
        · <i>M&A в России: кто купил кого и зачем, простым языком</i><br>
        · <i>Психология отношений — понятно о сложном</i></div>

      <label class="field mt"><span class="field-label">Стиль и тон</span>
        <textarea id="nc_style" rows="2" placeholder="Как должен звучать канал"></textarea></label>
      <div class="hint"><b>Примеры:</b><br>
        · <i>Дерзко и по делу, как инсайдер</i><br>
        · <i>Тепло и честно, как умный друг</i></div>

      <div class="divider"></div>

      <div style="margin-bottom:14px">
        <div class="field-label" style="margin-bottom:8px">Голос автора</div>
        <div class="seg" id="nc_vs">
          <button class="on" onclick="ncP('voice','author','nc_vs',this)">От себя</button>
          <button onclick="ncP('voice','expert','nc_vs',this)">Эксперт</button>
          <button onclick="ncP('voice','news','nc_vs',this)">Новости</button>
        </div>
      </div>
      <div style="margin-bottom:14px">
        <div class="field-label" style="margin-bottom:8px">Формат поста</div>
        <div class="seg" id="nc_fs" style="flex-wrap:wrap">
          <button class="on" onclick="ncP('format','story','nc_fs',this)">История</button>
          <button onclick="ncP('format','tips','nc_fs',this)">Советы</button>
          <button onclick="ncP('format','news','nc_fs',this)">Новость</button>
          <button onclick="ncP('format','question','nc_fs',this)">Вопрос</button>
        </div>
      </div>
      <div style="margin-bottom:14px">
        <div class="field-label" style="margin-bottom:8px">Эмодзи</div>
        <div class="seg" id="nc_es">
          <button onclick="ncP('emoji','none','nc_es',this)">Без эмодзи</button>
          <button class="on" onclick="ncP('emoji','minimal','nc_es',this)">1-2 штуки</button>
          <button onclick="ncP('emoji','rich','nc_es',this)">Активно</button>
        </div>
      </div>
      <div class="toggle-row" style="border:none;padding-top:0;margin-bottom:4px">
        <div class="toggle-info"><b>Призыв к действию</b><small>В конце каждого поста</small></div>
        <label class="switch"><input type="checkbox" id="nc_cta_sw"
          onchange="_ncCta=this.checked;$('nc_cta_i').classList.toggle('hidden',!this.checked)">
          <span class="slider"></span></label>
      </div>
      <input id="nc_cta_i" class="hidden" placeholder="Текст призыва" oninput="_ncCtaText=this.value" style="margin-bottom:12px">

      <div class="divider"></div>

      <div style="margin-bottom:12px">
        <div class="field-label" style="margin-bottom:4px">Скопировать стиль с канала (необязательно)</div>
        <div class="row" style="gap:8px">
          <input id="nc_ref" placeholder="https://t.me/example">
          <button class="btn-outline btn-sm" onclick="ncAnalyze()" id="nc_an" style="white-space:nowrap">Изучить</button>
        </div>
        <div id="nc_sp" class="hidden" style="margin-top:8px;padding:10px;background:var(--surface2);border-radius:10px;font-size:13px;color:var(--text-dim);white-space:pre-wrap"></div>
      </div>

      <div style="margin-bottom:20px">
        <div class="field-label" style="margin-bottom:8px">Тип канала</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px" id="nc_type_sel">
          <div class="type-card on" id="nc_type_thematic" onclick="ncPickType('thematic')"
            style="border:2px solid var(--accent);border-radius:12px;padding:14px;cursor:pointer;background:var(--accent-soft)">
            <div style="font-size:18px;margin-bottom:6px">✍️</div>
            <div style="font-weight:600;font-size:14px;margin-bottom:4px">Тематический</div>
            <div style="font-size:12px;color:var(--text-dim);line-height:1.4">Пишет по расписанию — психология, крипта-аналитика, лайфстайл</div>
          </div>
          <div class="type-card" id="nc_type_news" onclick="ncPickType('news')"
            style="border:2px solid var(--border-soft);border-radius:12px;padding:14px;cursor:pointer">
            <div style="font-size:18px;margin-bottom:6px">📡</div>
            <div style="font-weight:600;font-size:14px;margin-bottom:4px">Новостной</div>
            <div style="font-size:12px;color:var(--text-dim);line-height:1.4">Публикует только когда вышла новость — M&A, политика, крипто-новости</div>
          </div>
        </div>
        <div id="nc_type_hint" style="font-size:12px;color:var(--text-faint);margin-top:8px">
          Тематический: публикует по расписанию всегда. Токены за каждый пост.
        </div>
      </div>

      <div>
        <div class="field-label" style="margin-bottom:8px" id="nc_freq_label">Частота публикаций</div>
        <div class="seg" id="nc_hzs" style="flex-wrap:wrap">
          <button onclick="ncHz(0.25,this)">15 мин</button>
          <button onclick="ncHz(0.5,this)">30 мин</button>
          <button onclick="ncHz(1,this)">1ч</button>
          <button onclick="ncHz(3,this)">3ч</button>
          <button onclick="ncHz(6,this)">6ч</button>
          <button class="on" onclick="ncHz(12,this)">12ч</button>
          <button onclick="ncHz(24,this)">24ч</button>
          <button onclick="ncHz(48,this)">48ч</button>
        </div>
      </div>
      <div class="toggle-row" style="margin-top:12px">
        <div class="toggle-info"><b>Искать новости в интернете</b></div>
        <label class="switch"><input type="checkbox" id="nc_web" checked><span class="slider"></span></label>
      </div>
    </div>

    <button class="btn" style="width:100%;justify-content:center;margin-top:16px;padding:14px"
      onclick="ncGenerate()" id="nc_genbtn">✦ Сгенерировать три варианта поста</button>
    <div id="nc_results" class="hidden" style="margin-top:24px"></div>
  </div>`;
}

function ncPickType(type){
  _ncType=type;
  const thematic=$("nc_type_thematic"),news=$("nc_type_news"),hint=$("nc_type_hint"),label=$("nc_freq_label");
  if(type==="thematic"){
    if(thematic){thematic.style.border="2px solid var(--accent)";thematic.style.background="var(--accent-soft)";}
    if(news){news.style.border="2px solid var(--border-soft)";news.style.background="";}
    if(hint) hint.textContent="Тематический: публикует по расписанию всегда. Токены за каждый пост.";
    if(label) label.textContent="Частота публикаций";
  } else {
    if(news){news.style.border="2px solid var(--accent)";news.style.background="var(--accent-soft)";}
    if(thematic){thematic.style.border="2px solid var(--border-soft)";thematic.style.background="";}
    if(hint) hint.textContent="Новостной: проверяет новости по расписанию. Токены только при публикации.";
    if(label) label.textContent="Проверять новости каждые";
  }
}

function ncP(type,val,seg,btn){
  if(type==="voice") _ncVoice=val;
  if(type==="format") _ncFormat=val;
  if(type==="emoji") _ncEmoji=val;
  document.querySelectorAll(`#${seg} button`).forEach(b=>b.classList.remove("on"));
  btn.classList.add("on");
}
function ncHz(val,btn){
  _ncHz=val;
  document.querySelectorAll("#nc_hzs button").forEach(b=>b.classList.remove("on"));
  btn.classList.add("on");
}

function ncSkipVerify(){
  const block=$("nc_verify_block"),skipped=$("nc_verify_skipped");
  if(block) block.classList.add("hidden");
  if(skipped) skipped.classList.remove("hidden");
}
function ncShowVerify(){
  const block=$("nc_verify_block"),skipped=$("nc_verify_skipped");
  if(block) block.classList.remove("hidden");
  if(skipped) skipped.classList.add("hidden");
}

async function ncVerify(){
  const chat=($("nc_chat")||{value:""}).value.trim();
  if(!chat) return;
  const btn=$("nc_vbtn"),msg=$("nc_vmsg");
  btn.innerHTML='<span class="spinner"></span>';btn.disabled=true;
  try{
    const r=await api("POST","/verify_channel_only",{tg_chat:chat});
    msg.textContent=r.message;msg.style.color=r.ok?"var(--green)":"var(--red)";
  }catch(e){msg.textContent=e.message;msg.style.color="var(--red)";}
  btn.innerHTML="Проверить";btn.disabled=false;
}

async function ncAnalyze(){
  const link=($("nc_ref")||{value:""}).value.trim();if(!link) return;
  const btn=$("nc_an");btn.innerHTML='<span class="spinner"></span>';btn.disabled=true;
  try{
    const r=await api("POST","/analyze_style_only",{link});
    _ncStyleProfile=r.profile||"";
    $("nc_sp").textContent=_ncStyleProfile.replace(/#{1,3} /g,"").replace(/\*\*/g,"");
    $("nc_sp").classList.remove("hidden");
    toast("Стиль изучен","ok");
  }catch(e){toast(e&&e.message?e.message:"Ошибка запроса","err");}
  btn.innerHTML="Изучить";btn.disabled=false;
}

async function ncGenerate(){
  const title=($("nc_title").value||"").trim()||"Новый канал";
  const about=($("nc_about").value||"").trim();
  const style=($("nc_style").value||"").trim();
  if(!about) return toast("Опишите тему канала","err");
  const btn=$("nc_genbtn");
  btn.innerHTML='<span class="spinner"></span> Создаю канал…';btn.disabled=true;
  let chan;
  try{
    chan=await api("POST","/channels",{
      title,about,style,
      channel_type:_ncType,
      tg_chat:($("nc_chat")||{value:""}).value.trim(),
      interval_hours:_ncHz,
      use_web_search:($("nc_web")||{checked:true}).checked,
      style_profile:_ncStyleProfile,
      post_voice:_ncVoice,post_format:_ncFormat,
      emoji_style:_ncEmoji,cta_enabled:_ncCta,cta_text:_ncCtaText,
    });
  }catch(e){toast(e&&e.message?e.message:"Ошибка запроса","err");btn.innerHTML="✦ Сгенерировать три варианта поста";btn.disabled=false;return;}
  App.channelId=chan.id;App._onboardPosts=[];

  $("nc_results").classList.remove("hidden");
  $("nc_results").innerHTML=`
    <h2 style="font-family:'Instrument Serif',serif;font-size:22px;font-weight:400;margin-bottom:4px">Варианты постов</h2>
    <p style="color:var(--text-dim);font-size:13px;margin-bottom:16px">Посты появляются по мере готовности. Выбери понравившийся.</p>
    <div id="ob_posts"></div>
    <div id="ob_load" style="color:var(--text-faint);font-size:13px;padding:12px 0"><span class="spinner"></span> Генерирую…</div>`;

  btn.textContent="✓ Варианты готовы ниже ↓";btn.style.background="var(--green)";
  btn.onclick=()=>$("nc_results").scrollIntoView({behavior:"smooth"});

  const formats=[
    {key:"story",label:"История",desc:"Нарратив с выводом"},
    {key:"tips",label:"Советы",desc:"Конкретные шаги"},
    {key:"question",label:"Вопрос",desc:"Вовлечение"},
  ];
  for(let i=0;i<formats.length;i++){
    const f=formats[i];
    try{
      const r=await api("POST",`/channels/${chan.id}/generate_format`,{post_format:f.key});
      App._onboardPosts.push({...f,text:r.text,post_id:r.post_id});
      const el=document.createElement("div");
      el.className="onboard-card";
      el.innerHTML=`<div class="onboard-header">
        <div><span class="chip chip-blue">${esc(f.label)}</span>
          <span style="font-size:12px;color:var(--text-faint);margin-left:8px">${esc(f.desc)}</span></div>
        <button class="btn btn-sm" onclick="ncSelect(${i})">Выбрать →</button></div>
        <div style="margin-top:10px;font-size:14px;line-height:1.7;color:var(--text)">${renderTg(r.text)}</div>`;
      $("ob_posts").appendChild(el);
    }catch(e){App._onboardPosts.push({...f,text:null,error:e.message});}
  }
  $("ob_load").innerHTML="";
  $("ob_posts").insertAdjacentHTML("beforeend",`
    <div style="margin-top:20px;padding:16px;background:var(--accent-soft);border-radius:var(--radius);border:1px solid #e8d5bb">
      <div style="font-size:14px;font-weight:600;color:var(--accent-dark);margin-bottom:6px">Не понравился ни один?</div>
      <div style="font-size:13px;color:var(--text-dim);margin-bottom:10px">В расширенных настройках можно уточнить стиль через диалог с ИИ-консультантом.</div>
      <button class="btn" style="width:100%;justify-content:center"
        onclick="go('channel',${chan.id});setTimeout(()=>setTab('advanced'),400)">
        Настроить с помощью ИИ →</button>
    </div>`);
  setTimeout(()=>$("nc_results").scrollIntoView({behavior:"smooth"}),100);
  btn.disabled=false;
}

async function ncSelect(idx){
  const picked=App._onboardPosts[idx];if(!picked||!picked.post_id) return;
  try{
    for(let i=0;i<App._onboardPosts.length;i++){
      if(i!==idx&&App._onboardPosts[i].post_id)
        await api("POST",`/posts/${App._onboardPosts[i].post_id}/reject`).catch(()=>{});
    }
    await api("PATCH",`/channels/${App.channelId}`,{onboarded:true});
    toast("Канал настроен ✓","ok");go("channel",App.channelId);
  }catch(e){toast(e&&e.message?e.message:"Ошибка запроса","err");}
}

// CHANNEL
async function renderChannel(){
  await refreshUser();
  let c;
  try{c=await api("GET","/channels/"+App.channelId);}
  catch(e){toast(e&&e.message?e.message:"Ошибка запроса","err");return go("dashboard");}
  try{c.daily_times=JSON.parse(c.daily_times||"[]");}catch(_){c.daily_times=[];}
  App._chan=c;
  const notConnected=!c.tg_chat?`<div style="background:var(--accent-soft);border:1px solid #e8d5bb;border-radius:12px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:var(--accent-dark)">
    📡 Канал не подключён к Telegram.
    <button class="btn-ghost btn-sm" onclick="App.tab='settings';renderChannel()" style="color:var(--accent);font-weight:600">Подключить →</button></div>`:"";
  $("app").innerHTML=topbar("dashboard","все каналы")+`<div class="wrap">
    ${notConnected}
    <div class="chan-header card" style="margin-bottom:16px">
      <div class="row between" style="flex-wrap:wrap;gap:12px">
        <div>
          <h2 style="font-family:'Instrument Serif',serif;font-size:26px;font-weight:400">${esc(c.title)}</h2>
          <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap">
            ${c.verified?`<span class="chip chip-green">● подключён</span>`:`<span class="chip chip-orange">● не проверен</span>`}
            <span class="chip chip-gray">🕑 ${_intervalLabel(c.interval_hours||12)}</span>
            ${c.tg_chat?`<span class="chip chip-gray" style="font-family:monospace">${esc(c.tg_chat)}</span>`:""}
          </div>
          ${c.about?`<p style="font-size:13px;color:var(--text-dim);margin-top:8px;max-width:500px">${esc(c.about)}</p>`:""}
        </div>
        <div style="text-align:center">
          <div id="timer_block"></div>
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;justify-content:center">
            <button class="btn btn-sm" onclick="openGenPanel()">✦ Создать пост</button>
            <button class="${c.enabled?'btn-outline btn-sm':'btn btn-sm'}" onclick="toggleChannelEnabled()"
              id="pause_btn">${c.enabled?'⏸ Пауза':'▶ Возобновить'}</button>
          </div>
        </div>
      </div>
    </div>
    <div class="gen-panel hidden" id="genPanel">
      <div class="gen-title">Задайте тему поста (необязательно)</div>
      <div class="gen-row">
        <input id="genTopic" placeholder="Например: новая крупная сделка в России">
        <button class="btn" onclick="generateNow()" id="genRunBtn">Создать</button>
      </div>
      <div class="hint" style="margin-top:6px">Оставьте пустым — ИИ выберет тему сам</div>
    </div>
    <div class="tabs">
      <button class="tab ${App.tab==="queue"?"active":""}" onclick="setTab('queue')">Очередь</button>
      <button class="tab ${App.tab==="settings"?"active":""}" onclick="setTab('settings')">Настройки</button>
      <button class="tab ${App.tab==="advanced"?"active":""}" onclick="setTab('advanced')">Расширенные</button>
    </div>
    <div id="tabbody"></div>
  </div>`;
  renderTimer();renderTab();
}

function renderTimer(){
  const block=$("timer_block");if(!block||!App._chan) return;
  const c=App._chan;
  if(!c.enabled){
    block.innerHTML=`<div style="font-size:12px;color:var(--text-faint);font-style:italic">⏸ Канал на паузе</div>`;
    return;
  }
  if(!c.last_generated_at){block.innerHTML=`<div style="font-size:12px;color:var(--text-faint)">Авто-генерация включена</div>`;return;}
  const last=new Date(c.last_generated_at+"Z");
  const nextMs=last.getTime()+(c.interval_hours||12)*3600000;
  const diff=nextMs-Date.now();
  if(diff<=0){block.innerHTML=`<div style="font-size:12px;color:var(--green)">⏱ Генерация скоро</div>`;return;}
  const h=Math.floor(diff/3600000),m=Math.floor((diff%3600000)/60000),s=Math.floor((diff%60000)/1000);
  const ts=new Date(nextMs).toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"});
  block.innerHTML=`<div style="text-align:center">
    <div style="font-size:11px;color:var(--text-faint);margin-bottom:2px">следующий пост через</div>
    <div style="font-family:'JetBrains Mono',monospace;font-size:20px;font-weight:500;color:var(--accent);letter-spacing:.05em">
      ${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}</div>
    <div style="font-size:11px;color:var(--text-faint)">в ${ts}</div>
  </div>`;
  setTimeout(renderTimer,1000);
}

function openGenPanel(){const p=$("genPanel");if(!p) return;p.classList.toggle("hidden");if(!p.classList.contains("hidden")) $("genTopic").focus();}

function setTab(t){
  App.tab=t;
  document.querySelectorAll(".tab").forEach(b=>{
    const map={queue:"Очередь",settings:"Настройки",advanced:"Расширенные"};
    b.classList.toggle("active",b.textContent.trim()===map[t]);
  });
  renderTab();
}
function renderTab(){
  if(App.tab==="queue") renderQueue();
  else if(App.tab==="settings") renderSettings();
  else if(App.tab==="advanced") renderAdvanced();
}

// QUEUE
function toggleHistory(){
  const list=$("history_list"),arrow=$("history_arrow");
  if(!list) return;
  const hidden=list.classList.contains("hidden");
  list.classList.toggle("hidden",!hidden);
  if(arrow) arrow.textContent=hidden?"▼":"▶";
}

function toggleExpand(id){
  const pb=$("pb_"+id),btn=$("pexp_"+id);if(!pb||!btn) return;
  const short=pb.classList.contains("post-preview-short");
  pb.classList.toggle("post-preview-short",!short);
  btn.textContent=short?"Свернуть ↑":"Читать полностью ↓";
}

function renderPostCard(p){
  const when=new Date(p.created_at+"Z").toLocaleString("ru-RU",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
  const editable=p.status==="pending"||p.status==="onboarding";
  const sched=p.status==="scheduled";
  const sc={
    pending:`<span class="chip chip-orange">на проверке</span>`,
    scheduled:`<span class="chip chip-blue">запланирован</span>`,
    published:`<span class="chip chip-green">опубликован</span>`,
    rejected:`<span class="chip chip-gray">удалён</span>`,
    onboarding:`<span class="chip chip-blue">онбординг</span>`,
  };
  let schedInfo="";
  if(sched&&p.scheduled_at){
    const sd=new Date(p.scheduled_at+"Z");const diff=sd-Date.now();
    const h=Math.floor(diff/3600000),m=Math.floor((diff%3600000)/60000);
    const ts=sd.toLocaleString("ru-RU",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
    schedInfo=`<div style="font-size:12px;color:var(--blue);margin-top:6px">⏰ ${diff>0?(h>0?h+"ч ":"")+m+"м":"скоро"} — в ${ts}</div>`;
  }
  let actions="";
  if(editable) actions=`
    <button class="btn btn-green btn-sm" onclick="publishPost(${p.id})">✓ Опубликовать сейчас</button>
    <button class="btn-outline btn-sm" onclick="showPicker(${p.id})">⏰ Запланировать</button>
    <button class="btn-outline btn-sm" onclick="regenPost(${p.id})" id="regen_${p.id}">↻ Заново</button>
    <button class="btn-danger btn-sm" onclick="rejectPost(${p.id})">Удалить</button>`;
  else if(sched) actions=`
    <button class="btn btn-green btn-sm" onclick="publishPost(${p.id})">✓ Сейчас</button>
    <button class="btn-danger btn-sm" onclick="rejectPost(${p.id})">Снять</button>`;
  else actions=`<button class="btn-ghost btn-sm" onclick="deletePost(${p.id})">Удалить</button>`;

  return `<div class="post-card" id="pc_${p.id}">
    <div class="post-header">
      <div class="row" style="gap:8px;flex-wrap:wrap">${sc[p.status]||""}
        <span class="text-faint mono" style="font-size:11px">${when}</span></div>
      <span class="text-faint mono" style="font-size:11px">${fmt(p.tokens_used)} ток.</span>
    </div>
    ${schedInfo}
    <div id="ppreview_${p.id}" style="position:relative">
      <div id="pb_${p.id}" class="post-body post-preview-short" style="margin-top:8px">${renderTg(p.text)}</div>
      <button id="pexp_${p.id}" class="expand-btn" onclick="toggleExpand(${p.id})">Читать полностью ↓</button>
    </div>
    ${editable?`<textarea id="pt_${p.id}" class="post-body hidden" style="width:100%;min-height:120px;margin-top:8px">${esc(p.text)}</textarea>`:""}
    <div id="picker_${p.id}" class="hidden" style="margin-top:10px;padding:12px;background:var(--surface2);border-radius:10px;border:1px solid var(--border-soft)">
      <div class="field-label" style="margin-bottom:6px">Дата и время (UTC)</div>
      <div class="row" style="gap:8px">
        <input type="datetime-local" id="dt_${p.id}" style="flex:1">
        <button class="btn btn-sm" onclick="doSchedule(${p.id})">Запланировать</button>
        <button class="btn-ghost btn-sm" onclick="$('picker_${p.id}').classList.add('hidden')">✕</button>
      </div>
    </div>
    <div class="post-actions" style="margin-top:10px">
      ${editable?`<button class="btn-ghost btn-sm" onclick="toggleEdit(${p.id})" id="edit_${p.id}">✏️ Редактировать</button>
        <button class="btn-ghost btn-sm hidden" id="save_${p.id}" onclick="savePost(${p.id})">💾 Сохранить</button>`:""}
      ${actions}
    </div></div>`;
}

async function renderQueue(){
  $("tabbody").innerHTML=`<div id="postList"><div class="text-faint" style="padding:20px">Загрузка…</div></div>`;
  let posts=[];
  try{posts=await api("GET","/channels/"+App._chan.id+"/posts");}catch(e){}

  const pending=posts.filter(p=>p.status==="pending"||p.status==="onboarding"||p.status==="scheduled");
  const history=posts.filter(p=>p.status==="published"||p.status==="rejected");

  let html="";
  if(!pending.length){
    const paused = App._chan && !App._chan.enabled;
    html+=paused
      ? `<div class="empty"><div class="empty-icon">⏸</div><h3>Канал на паузе</h3><p>При возобновлении автоматически сгенерируются 3 поста.</p></div>`
      : `<div class="empty"><div class="empty-icon">✦</div><h3>Очередь пуста</h3><p>Посты скоро появятся автоматически.</p></div>`;
  } else {
    html+=pending.map(p=>renderPostCard(p)).join("");
  }
  if(history.length){
    html+=`<div style="margin-top:20px">
      <button onclick="toggleHistory()" id="history_btn"
        style="background:none;border:none;cursor:pointer;font-size:13px;color:var(--text-faint);font-weight:500;padding:8px 0;display:flex;align-items:center;gap:6px">
        📁 История публикаций (${history.length}) <span id="history_arrow">▶</span>
      </button>
      <div id="history_list" class="hidden">${history.map(p=>renderPostCard(p)).join("")}</div>
    </div>`;
  }
  $("postList").innerHTML=html;
}


// SETTINGS
function renderSettings(){
  const c=App._chan;
  const lens=["50-100 слов","100-200 слов","200-350 слов"];
  $("tabbody").innerHTML=`
    <div class="card">
      <div class="card-title">Telegram</div>
      <label class="field"><span class="field-label">Название</span>
        <input id="f_title" value="${esc(c.title)}"></label>
      <label class="field mt"><span class="field-label">@username, ссылка t.me/ или ID</span>
        ${c.verified
          ? `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--green-bg);border-radius:10px;margin-bottom:6px">
               <span style="color:var(--green);font-weight:600">✓ Проверено</span>
               <span style="font-family:monospace;font-size:13px;color:var(--text-dim)">${esc(c.tg_chat)}</span>
               <button class="btn-ghost btn-sm" onclick="showVerifyInput()" style="margin-left:auto;font-size:12px">Изменить</button>
             </div>
             <div id="verifyInputBlock" class="hidden">
               <div class="row" style="gap:8px">
                 <input id="f_chat" value="${esc(c.tg_chat)}" placeholder="@my_channel" style="flex:1">
                 <button class="btn-outline btn-sm" onclick="verifyChannel()" id="verBtn" style="white-space:nowrap">Проверить</button>
               </div>
               <div class="hint">Добавь бота <b>@${esc(App.cfg?.bot_username||"…")}</b> администратором с правом публикации.</div>
               <div id="verMsg" style="font-size:13px;margin-top:6px"></div>
             </div>`
          : `<div class="row" style="gap:8px">
               <input id="f_chat" value="${esc(c.tg_chat)}" placeholder="@my_channel" style="flex:1">
               <button class="btn-outline btn-sm" onclick="verifyChannel()" id="verBtn" style="white-space:nowrap">Проверить</button>
             </div>
             <div class="hint">Добавь бота <b>@${esc(App.cfg?.bot_username||"…")}</b> администратором с правом публикации.</div>
             <div id="verMsg" style="font-size:13px;margin-top:6px"></div>`
        }
      </label>
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
          ${lens.map(o=>`<button class="${c.post_length===o?"on":""}" onclick="pickLen('${o}')">${o}</button>`).join("")}
        </div>
      </div>
      <div style="margin-top:16px">
        <div class="field-label" style="margin-bottom:6px">Скопировать стиль с канала</div>
        <div class="row" style="gap:8px">
          <input id="f_analyze" placeholder="https://t.me/example" style="flex:1">
          <button class="btn-outline btn-sm" onclick="analyzeChannel()" id="anBtn" style="white-space:nowrap">Изучить</button>
        </div>
        <div id="analyze_result"></div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Автоматизация</div>
      <div class="toggle-row">
        <div class="toggle-info"><b>Публиковать без проверки</b><small>Посты уходят сразу.</small></div>
        <label class="switch"><input type="checkbox" id="sw_auto" ${c.auto_publish?"checked":""}><span class="slider"></span></label>
      </div>
      <div class="toggle-row">
        <div class="toggle-info"><b>Искать новости в интернете</b></div>
        <label class="switch"><input type="checkbox" id="sw_web" ${c.use_web_search?"checked":""}><span class="slider"></span></label>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Уведомления в Telegram</div>
      <div style="margin-bottom:14px" id="tg_notif_block">
        ${App.user?.tg_chat_id
          ? '<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--green-bg);border-radius:10px;font-size:14px;color:var(--green)">✅ Подключено — уведомления активны</div>'
          : '<div style="font-size:13px;color:var(--text-dim);margin-bottom:10px;line-height:1.6">Нажми кнопку — бот пришлёт приветствие и начнёт отправлять уведомления.</div>'
            + '<button class="btn" onclick="openTgConnect()" style="display:inline-flex;margin-bottom:4px">💬 Подключить уведомления →</button>'
            + '<div class="hint" style="margin-top:8px">Откроется бот — нажми Start</div>'
        }
      </div>
      <div class="toggle-row">
        <div class="toggle-info"><b>Новый пост сгенерирован</b></div>
        <label class="switch"><input type="checkbox" id="sw_n1" ${App.user?.notify_new_post?"checked":""}><span class="slider"></span></label>
      </div>
      <div class="toggle-row">
        <div class="toggle-info"><b>Пост опубликован</b></div>
        <label class="switch"><input type="checkbox" id="sw_n2" ${App.user?.notify_published?"checked":""}><span class="slider"></span></label>
      </div>
      <div class="toggle-row">
        <div class="toggle-info"><b>Токены заканчиваются</b><small>~1 пост остался</small></div>
        <label class="switch"><input type="checkbox" id="sw_n3" ${App.user?.notify_low_tokens!==false?"checked":""}><span class="slider"></span></label>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Протестировать</div>
      <p style="font-size:13px;color:var(--text-dim);margin-bottom:12px">Сгенерировать тестовый пост с текущими настройками.</p>
      <button class="btn-outline" onclick="testPost()" id="testBtn">▷ Создать тестовый пост</button>
      <div id="test_result" style="margin-top:12px"></div>
    </div>
    <div class="row between mt-lg">
      <button class="btn-danger btn-sm" onclick="deleteChannel()">Удалить канал</button>
      <button class="btn" onclick="saveChannel()">Сохранить</button>
    </div>`;
}

async function testPost(){
  const btn=$("testBtn");btn.innerHTML='<span class="spinner"></span>';btn.disabled=true;
  await _silentSave();
  try{
    const r=await api("POST","/channels/"+App._chan.id+"/generate",{});
    const posts=await api("GET","/channels/"+App._chan.id+"/posts");
    const p=posts.find(x=>x.id===r.post_id)||{text:"",tokens_used:0,id:r.post_id};
    $("test_result").innerHTML=`<div class="card" style="background:var(--surface2)">
      <div style="font-size:11px;color:var(--text-faint);margin-bottom:8px">${fmt(r.tokens_used)} токенов</div>
      <div class="post-body">${renderTg(p.text)}</div>
      <div class="post-actions" style="margin-top:10px">
        <button class="btn btn-green btn-sm" onclick="publishPost(${p.id})">✓ Опубликовать</button>
        <button class="btn-danger btn-sm" onclick="rejectPost(${p.id})">Удалить</button>
      </div></div>`;
  }catch(e){toast(e&&e.message?e.message:"Ошибка запроса","err");}
  btn.innerHTML="▷ Создать тестовый пост";btn.disabled=false;
}

// ADVANCED
let _advInterval=null;
async function renderAdvanced(){
  const c=App._chan;
  let rules=[],sources=[];
  try{rules=await api("GET","/channels/"+c.id+"/rules");}catch(_){}
  try{sources=await api("GET","/channels/"+c.id+"/sources");}catch(_){}
  App._consultHistory=[];_advInterval=null;

  $("tabbody").innerHTML=`
    <div class="card">
      <div class="card-title">Голос и формат</div>
      <div style="margin-bottom:14px">
        <div class="field-label" style="margin-bottom:8px">Голос автора</div>
        <div class="seg" id="seg_voice">
          <button class="${(c.post_voice||"author")==="author"?"on":""}" onclick="pickOpt('post_voice','author','seg_voice')">От себя</button>
          <button class="${(c.post_voice||"author")==="expert"?"on":""}" onclick="pickOpt('post_voice','expert','seg_voice')">Эксперт</button>
          <button class="${(c.post_voice||"author")==="news"?"on":""}" onclick="pickOpt('post_voice','news','seg_voice')">Новости</button>
        </div>
      </div>
      <div style="margin-bottom:14px">
        <div class="field-label" style="margin-bottom:8px">Формат</div>
        <div class="seg" id="seg_format" style="flex-wrap:wrap">
          <button class="${(c.post_format||"story")==="story"?"on":""}" onclick="pickOpt('post_format','story','seg_format')">История</button>
          <button class="${(c.post_format||"story")==="tips"?"on":""}" onclick="pickOpt('post_format','tips','seg_format')">Советы</button>
          <button class="${(c.post_format||"story")==="news"?"on":""}" onclick="pickOpt('post_format','news','seg_format')">Новость</button>
          <button class="${(c.post_format||"story")==="question"?"on":""}" onclick="pickOpt('post_format','question','seg_format')">Вопрос</button>
        </div>
      </div>
      <div style="margin-bottom:14px">
        <div class="field-label" style="margin-bottom:8px">Эмодзи</div>
        <div class="seg" id="seg_emoji">
          <button class="${(c.emoji_style||"minimal")==="none"?"on":""}" onclick="pickOpt('emoji_style','none','seg_emoji')">Без</button>
          <button class="${(c.emoji_style||"minimal")==="minimal"?"on":""}" onclick="pickOpt('emoji_style','minimal','seg_emoji')">1-2 штуки</button>
          <button class="${(c.emoji_style||"minimal")==="rich"?"on":""}" onclick="pickOpt('emoji_style','rich','seg_emoji')">Активно</button>
        </div>
      </div>
      <div class="toggle-row" style="border:none">
        <div class="toggle-info"><b>Призыв к действию</b><small>В конце каждого поста</small></div>
        <label class="switch"><input type="checkbox" id="sw_cta" ${c.cta_enabled?"checked":""}
          onchange="$('cta_f').classList.toggle('hidden',!this.checked)"><span class="slider"></span></label>
      </div>
      <div id="cta_f" class="${c.cta_enabled?"":"hidden"}" style="margin-top:8px">
        <input id="f_cta" value="${esc(c.cta_text||"")}" placeholder="Подпишись чтобы не пропустить"></div>
    </div>

    <div class="card">
      <div class="card-title">Тип канала</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:4px">
        <div onclick="pickChannelType('thematic')" id="adv_type_thematic"
          style="border:2px solid ${(c.channel_type||'thematic')==='thematic'?'var(--accent)':'var(--border-soft)'};
          background:${(c.channel_type||'thematic')==='thematic'?'var(--accent-soft)':''};
          border-radius:12px;padding:12px;cursor:pointer">
          <div style="font-weight:600;font-size:13px;margin-bottom:2px">✍️ Тематический</div>
          <div style="font-size:11px;color:var(--text-dim)">Публикует по расписанию</div>
        </div>
        <div onclick="pickChannelType('news')" id="adv_type_news"
          style="border:2px solid ${(c.channel_type||'thematic')==='news'?'var(--accent)':'var(--border-soft)'};
          background:${(c.channel_type||'thematic')==='news'?'var(--accent-soft)':''};
          border-radius:12px;padding:12px;cursor:pointer">
          <div style="font-weight:600;font-size:13px;margin-bottom:2px">📡 Новостной</div>
          <div style="font-size:11px;color:var(--text-dim)">Только при наличии новостей</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title" id="adv_sched_title">${(c.channel_type||'thematic')==='news'?'Проверять новости каждые':'Расписание'}</div>
      <div style="margin-bottom:12px">
        <div class="field-label" style="margin-bottom:8px">Интервал</div>
        <div class="seg" id="seg_int" style="flex-wrap:wrap">
          ${[0.25,0.5,1,3,6,12,24,48].map(h=>{
            const lbl=h<1?`${h*60|0}м`:h<24?`${h}ч`:`${h/24|0}д`;
            return `<button class="${(c.interval_hours||12)==h?"on":""}" onclick="pickAdv(${h},this)">${lbl}</button>`;
          }).join("")}
        </div>
      </div>
      <label class="field">
        <span class="field-label">Разброс ±<span id="jlbl">${c.interval_jitter_minutes||0}</span> мин</span>
        <input type="range" id="f_jitter" min="0" max="120" value="${c.interval_jitter_minutes||0}"
          oninput="$('jlbl').textContent=this.value"
          style="padding:4px 0;height:auto;box-shadow:none;border:none;background:none">
        <div class="hint">Добавляет случайное отклонение — посты выходят в разное время, выглядит естественнее.</div>
      </label>
      <div style="margin-top:14px">
        <div class="field-label" style="margin-bottom:8px">Окно публикации (UTC)</div>
        <div class="row" style="gap:10px">
          <div style="flex:1"><div style="font-size:11px;color:var(--text-faint);margin-bottom:4px">С</div>
            <input id="f_ws" placeholder="09:00" value="${c.publish_window_start||""}"></div>
          <div style="flex:1"><div style="font-size:11px;color:var(--text-faint);margin-bottom:4px">До</div>
            <input id="f_we" placeholder="22:00" value="${c.publish_window_end||""}"></div>
        </div>
        <div class="hint">Посты публикуются только в это время. Москва = UTC+3.</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Правила стиля</div>
      <div class="hint" style="margin-top:0;margin-bottom:12px">ИИ соблюдает эти правила при каждой генерации.</div>
      <div id="rules_list">
        ${rules.length?rules.map(r=>`<div class="src-row" id="rule_${r.id}">
          <span style="font-size:13px;color:var(--text-dim)">✦ ${esc(r.rule_text)}</span>
          <button class="btn-danger btn-sm" onclick="deleteRule(${r.id})">Удалить</button>
        </div>`).join(""):`<p style="font-size:13px;color:var(--text-faint)">Правил пока нет.</p>`}
      </div>
      <div class="row" style="margin-top:10px;gap:8px">
        <input id="new_rule" placeholder="Например: не использовать длинное тире" style="flex:1">
        <button class="btn btn-sm" onclick="addRule()">Добавить</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">ИИ-консультант</div>
      <div class="hint" style="margin-top:0;margin-bottom:12px">
        Объясни как хочешь чтобы писались посты — ИИ задаст вопросы и предложит конкретные правила.
      </div>
      <div id="consult_msgs" style="max-height:260px;overflow-y:auto;margin-bottom:10px;display:flex;flex-direction:column;gap:8px"></div>
      <div class="row" style="gap:8px">
        <input id="consult_in" placeholder="Например: не хочу длинное тире и старые новости" style="flex:1"
          onkeydown="if(event.key==='Enter') sendConsult()">
        <button class="btn btn-sm" onclick="sendConsult()" id="consult_btn">→</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Источники информации</div>
      <div class="hint" style="margin-top:0;margin-bottom:12px">Сайты или RSS которые ИИ просматривает перед написанием.</div>
      <div class="row" style="gap:8px">
        <input id="srcUrl" placeholder="https://example.com" style="flex:1">
        <button class="btn btn-sm" onclick="addSource()">Добавить</button>
      </div>
      <div id="srcList" style="margin-top:10px">
        ${sources.length?sources.map(s=>`<div class="src-row">
          <span class="src-url">${esc(s.url)}</span>
          <button class="btn-danger btn-sm" onclick="delSource(${s.id})">Удалить</button>
        </div>`).join(""):`<p style="font-size:13px;color:var(--text-faint)">Нет источников — ИИ ищет сам.</p>`}
      </div>
    </div>

    <div class="row between mt-lg"><div></div>
      <button class="btn" onclick="saveAdvanced()">Сохранить</button></div>`;
}

function pickAdv(h,btn){
  _advInterval=h;
  document.querySelectorAll("#seg_int button").forEach(b=>b.classList.remove("on"));
  btn.classList.add("on");
}

async function sendConsult(){
  const input=$("consult_in");const msg=(input?.value||"").trim();if(!msg) return;
  input.value="";
  const msgs=$("consult_msgs");
  msgs.insertAdjacentHTML("beforeend",`<div style="align-self:flex-end;background:var(--accent-soft);border-radius:12px 12px 4px 12px;padding:10px 14px;max-width:85%;font-size:14px">${esc(msg)}</div>`);
  const btn=$("consult_btn");btn.innerHTML='<span class="spinner"></span>';btn.disabled=true;
  App._consultHistory.push({role:"user",content:msg});
  try{
    const r=await api("POST","/channels/"+App._chan.id+"/consult",{message:msg,history:App._consultHistory.slice(-6)});
    App._consultHistory.push({role:"assistant",content:r.response});
    msgs.insertAdjacentHTML("beforeend",`<div style="align-self:flex-start;background:var(--surface2);border-radius:12px 12px 12px 4px;padding:10px 14px;max-width:85%;font-size:14px">
      ${esc(r.response)}
      ${r.suggested_rule ? (()=>{
        const rid="sr_"+Date.now();
        window["_sr_"+rid]=r.suggested_rule;
        return '<div style="margin-top:10px;padding:8px 12px;background:var(--green-bg);border-radius:8px;font-size:13px">'
          +'<b>Предлагаю правило:</b> '+esc(r.suggested_rule)+'<br>'
          +'<button class="btn btn-sm" style="margin-top:6px;background:var(--green);color:#fff" '
          +'onclick="addSuggestedRule(window[\'_sr_'+rid+'\'])">Добавить правило</button></div>';
      })() : ""}
    </div>`);
    msgs.scrollTop=msgs.scrollHeight;
  }catch(e){toast(e&&e.message?e.message:"Ошибка запроса","err");}
  btn.innerHTML="→";btn.disabled=false;
}

async function addSuggestedRule(text){
  try{await api("POST","/channels/"+App._chan.id+"/rules",{rule_text:text});toast("Правило добавлено ✓","ok");renderAdvanced();}
  catch(e){toast(e&&e.message?e.message:"Ошибка запроса","err");}
}
async function addRule(){
  const text=($("new_rule")||{value:""}).value.trim();if(!text) return;
  try{await api("POST","/channels/"+App._chan.id+"/rules",{rule_text:text});$("new_rule").value="";renderAdvanced();}
  catch(e){toast(e&&e.message?e.message:"Ошибка запроса","err");}
}
async function deleteRule(id){
  try{await api("DELETE","/rules/"+id);renderAdvanced();}catch(e){toast(e&&e.message?e.message:"Ошибка запроса","err");}
}
async function addSource(){
  const url=($("srcUrl")||{value:""}).value.trim();if(!url) return;
  try{await api("POST","/channels/"+App._chan.id+"/sources",{url});$("srcUrl").value="";renderAdvanced();}
  catch(e){toast(e&&e.message?e.message:"Ошибка запроса","err");}
}
async function delSource(id){
  try{await api("DELETE","/sources/"+id);renderAdvanced();}catch(e){toast(e&&e.message?e.message:"Ошибка запроса","err");}
}

// SHARED ACTIONS
function pickLen(o){
  App._chan.post_length=o;
  document.querySelectorAll("#seg_len button").forEach(b=>b.classList.toggle("on",b.textContent===o));
}
function pickOpt(field,val,segId){
  App._chan[field]=val;
  document.querySelectorAll(`#${segId} button`).forEach(b=>b.classList.remove("on"));
  event.target.classList.add("on");
}
async function _silentSave(){
  if(!$("f_title")) return;
  try{await api("PATCH","/channels/"+App._chan.id,{
    title:($("f_title")||{value:App._chan.title}).value.trim(),
    about:$("f_about")?$("f_about").value:App._chan.about,
    style:$("f_style")?$("f_style").value:App._chan.style,
    post_length:App._chan.post_length,
    use_web_search:$("sw_web")?$("sw_web").checked:App._chan.use_web_search,
    auto_publish:$("sw_auto")?$("sw_auto").checked:App._chan.auto_publish,
  });}catch(_){}
}
async function saveChannel(){
  const newChat=($("f_chat")||{value:App._chan.tg_chat||""}).value.trim();
  const chatChanged=newChat!==(App._chan.tg_chat||"");
  const payload={
    title:($("f_title")||{value:App._chan.title}).value.trim(),
    about:$("f_about")?$("f_about").value:App._chan.about,
    style:$("f_style")?$("f_style").value:App._chan.style,
    post_length:App._chan.post_length,
    use_web_search:$("sw_web")?$("sw_web").checked:App._chan.use_web_search,
    auto_publish:$("sw_auto")?$("sw_auto").checked:App._chan.auto_publish,
  };
  if(chatChanged) payload.tg_chat=newChat;
  const notif={
    notify_new_post:$("sw_n1")?$("sw_n1").checked:false,
    notify_published:$("sw_n2")?$("sw_n2").checked:false,
    notify_low_tokens:$("sw_n3")?$("sw_n3").checked:true,
  };
  try{
    await api("PATCH","/channels/"+App._chan.id,payload);
    await api("PATCH","/me",notif);
    toast("Сохранено ✓","ok");renderChannel();
  }catch(e){toast(e&&e.message?e.message:"Ошибка запроса","err");}
}
async function saveAdvanced(){
  const ih=_advInterval!=null?_advInterval:(App._chan.interval_hours||12);
  const payload={
    channel_type:App._chan.channel_type||"thematic",
    post_voice:App._chan.post_voice||"author",
    post_format:App._chan.post_format||"story",
    emoji_style:App._chan.emoji_style||"minimal",
    cta_enabled:$("sw_cta")?$("sw_cta").checked:false,
    cta_text:($("f_cta")||{value:""}).value,
    interval_hours:parseFloat(ih),
    interval_jitter_minutes:parseInt(($("f_jitter")||{value:0}).value)||0,
    publish_window_start:($("f_ws")||{value:""}).value,
    publish_window_end:($("f_we")||{value:""}).value,
  };
  try{
    await api("PATCH","/channels/"+App._chan.id,payload);
    App._chan={...App._chan,...payload};
    _advInterval=null;
    toast("Сохранено ✓","ok");
  }catch(e){
    const msg=e&&e.message?e.message:typeof e==="string"?e:"Ошибка сохранения";
    toast(msg,"err");
  }
}
function showVerifyInput(){
  const block=$("verifyInputBlock");if(block) block.classList.remove("hidden");
}

async function verifyChannel(){
  const chat=($("f_chat")||{value:""}).value.trim();if(!chat) return toast("Введите @username или ссылку","err");
  const btn=$("verBtn");if(btn) btn.innerHTML='<span class="spinner"></span>';
  try{
    await api("PATCH","/channels/"+App._chan.id,{tg_chat:chat});
    const r=await api("POST","/channels/"+App._chan.id+"/verify");
    if(r.ok){
      App._chan.tg_chat=chat;App._chan.verified=true;
      toast("Канал проверен ✓","ok");
      renderSettings(); // перерисуем — покажет статус «Проверено»
    } else {
      const msg=$("verMsg");if(msg){msg.textContent=r.message;msg.style.color="var(--red)";}
      if(btn) btn.innerHTML="Проверить";
    }
  }catch(e){
    const msg=$("verMsg");if(msg){msg.textContent=e.message;msg.style.color="var(--red)";}
    if(btn) btn.innerHTML="Проверить";
  }
}
async function analyzeChannel(){
  const link=($("f_analyze")||{value:""}).value.trim();if(!link) return;
  const btn=$("anBtn");btn.innerHTML='<span class="spinner"></span>';btn.disabled=true;
  try{
    const r=await api("POST","/channels/"+App._chan.id+"/analyze",{link});
    App._chan.style_profile=r.profile;
    const el=$("analyze_result");
    if(el) el.innerHTML=`<div class="hint" style="color:var(--green);margin-top:6px">✓ Изучено постов: ${r.analyzed_posts}. Стиль сохранён.</div>`;
    toast("Стиль изучен ✓","ok");
  }catch(e){const el=$("analyze_result");if(el) el.innerHTML=`<div class="hint" style="color:var(--red);margin-top:6px">${esc(e.message)}</div>`;}
  btn.innerHTML="Изучить";btn.disabled=false;
}
async function deleteChannel(){
  if(!confirm("Удалить канал и все посты?")) return;
  try{await api("DELETE","/channels/"+App._chan.id);toast("Удалено","ok");go("dashboard");}
  catch(e){toast(e&&e.message?e.message:"Ошибка запроса","err");}
}
async function generateNow(){
  const about=App._chan.about||"";if(!about.trim()) return toast("Заполните тему канала","err");
  const topic=($("genTopic")||{value:""}).value.trim();
  const btn=$("genRunBtn");if(btn) btn.innerHTML='<span class="spinner"></span>';
  await _silentSave();
  let attempts=0;
  while(attempts<3){
    try{
      const r=await api("POST","/channels/"+App._chan.id+"/generate",topic?{topic}:{});
      toast(`Готово! ${fmt(r.tokens_used)} токенов`,"ok");
      if($("genPanel")) $("genPanel").classList.add("hidden");
      if($("genTopic")) $("genTopic").value="";
      App.tab="queue";renderChannel();return;
    }catch(e){
      const is529=e.message.includes("529")||e.message.toLowerCase().includes("overload");
      attempts++;
      if(is529&&attempts<3){toast(`Серверы заняты, повтор через 15с… (${attempts}/3)`);await new Promise(r=>setTimeout(r,15000));}
      else{toast(is529?"Серверы перегружены. Попробуй позже.":e.message,"err");if(btn) btn.innerHTML="Создать";return;}
    }
  }
}

// BILLING
async function renderBilling(){
  await refreshUser();
  const plans=[
    {id:"p1",name:"Старт",price:"490 ₽/мес",channels:1,posts:90},
    {id:"p2",name:"Про",price:"990 ₽/мес",channels:3,posts:300,popular:true},
    {id:"p3",name:"Бизнес",price:"2 490 ₽/мес",channels:10,posts:1500},
    {id:"p4",name:"Агентство",price:"4 990 ₽/мес",channels:0,posts:5000},
  ];
  $("app").innerHTML=topbar("dashboard","назад")+`<div class="wrap">
    <div class="page-head"><h1>Тарифы</h1>
      <p>Баланс: <b class="mono">${fmt(App.user?.token_balance||0)}</b> токенов · ≈${Math.floor((App.user?.token_balance||0)/5000)} постов</p></div>
    ${(!App.cfg?.yookassa_enabled&&!App.cfg?.yoomoney_enabled)?`<div class="card" style="border-color:var(--accent);background:var(--accent-soft);margin-bottom:16px">
      <p style="color:var(--accent-dark)">Приём платежей настраивается.</p></div>`:""}
    <div class="grid grid-2" style="margin-bottom:16px">
      ${plans.map(p=>`<div class="price-card" style="position:relative;${p.popular?"border-color:var(--accent)":""}">
        ${p.popular?`<div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;font-size:11px;font-weight:600;padding:2px 12px;border-radius:99px;white-space:nowrap">Популярный</div>`:""}
        <div class="p-name">${p.name}</div>
        <div class="p-price" style="font-size:24px">${p.price}</div>
        <div class="p-tokens" style="line-height:1.8">
          📺 ${p.channels===0?"Без лимита каналов":`${p.channels} ${p.channels===1?"канал":"канала"}`}<br>
          ✦ ${fmt(p.posts)} постов/мес</div>
        <button class="btn" style="width:100%;justify-content:center;margin-top:8px" onclick="buy('${p.id}')">Выбрать</button>
      </div>`).join("")}
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="card-title">🎁 Реферальная программа</div>
      <p style="font-size:14px;color:var(--text-dim);margin-bottom:12px">За каждого приглашённого — <b>+50 000 токенов</b> тебе и другу.</p>
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
  try{
    const r = await api("POST", "/billing/buy", {package_id: pid});
    if(!r.payment_url){ toast("Не удалось получить ссылку на оплату","err"); return; }
    // Telegram Mini App — используем встроенный метод
    if(window.Telegram?.WebApp?.openLink){
      window.Telegram.WebApp.openLink(r.payment_url);
    } else {
      window.location.href = r.payment_url;
    }
  } catch(e){
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
    if(newVal) App._chan.last_generated_at=null; // сброс таймера при возобновлении
    const btn=$("pause_btn");
    if(btn){btn.textContent=newVal?"⏸ Пауза":"▶ Возобновить";btn.className=newVal?"btn-outline btn-sm":"btn btn-sm";}
    renderTimer();
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
  const ta=$("pt_"+id);
  if(ta&&!ta.classList.contains("hidden")) try{await api("PATCH","/posts/"+id,{text:ta.value});}catch(_){}
  try{await api("POST","/posts/"+id+"/publish");toast("Опубликовано ✓","ok");renderQueue();}
  catch(e){toast(e&&e.message?e.message:"Ошибка","err");}
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
    toast("Перегенерировано — "+fmt(r.tokens_used)+" токенов","ok");renderQueue();
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
    if(twa){
      twa.showAlert("Войдите в аккаунт на сайте autopost26.up.railway.app, а затем откройте уведомления снова.");
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
async function boot(){
  try{App.cfg=await api("GET","/config");}catch(_){App.cfg={packages:[]};}
  initCookieBanner();initKeyboardDismiss();
  if(!App.token) return renderAuth();
  try{App.user=await api("GET","/me");go("dashboard");}catch(_){logout();}
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
window.addRule=addRule;window.deleteRule=deleteRule;

// Ждём загрузки DOM перед запуском
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
