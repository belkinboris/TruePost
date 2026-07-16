

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
  trackGoal("channel_created",{source:"onboarding",channel_id:chan.id});

  $("nc_results").classList.remove("hidden");
  $("nc_results").innerHTML=`
    <h2 style="font-family:'Instrument Serif',serif;font-size:22px;font-weight:400;margin-bottom:4px">Варианты постов</h2>
    <p style="color:var(--text-dim);font-size:13px;margin-bottom:16px">Генерирую три варианта — выбери понравившийся.</p>
    <div id="ob_posts"></div>
    <div id="ob_load">
      ${[0,1,2].map(i=>`<div style="background:var(--surface);border:1.5px solid var(--border-soft);border-radius:var(--radius);padding:20px;margin-bottom:14px;opacity:${1-i*0.2}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div style="width:60px;height:16px;background:var(--surface2);border-radius:6px"></div>
          <div style="width:80px;height:30px;background:var(--surface2);border-radius:8px"></div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;color:var(--text-faint);font-size:13px">
          <span class="spinner"></span> ${i===0?'Генерирую…':i===1?'Следующий вариант…':'Третий вариант…'}
        </div>
      </div>`).join("")}
    </div>`;

  btn.textContent="✓ Варианты готовы ниже ↓";btn.style.background="var(--green)";
  btn.onclick=()=>$("nc_results").scrollIntoView({behavior:"smooth"});

  const formats=[
    {key:"story",label:"История",desc:"Нарратив с выводом"},
    {key:"tips",label:"Советы",desc:"Конкретные шаги"},
    {key:"question",label:"Вопрос",desc:"Вовлечение"},
  ];
  let _ymOnboardPostGenerated=false;
  for(let i=0;i<formats.length;i++){
    const f=formats[i];
    try{
      const r=await api("POST",`/channels/${chan.id}/generate_format`,{post_format:f.key});
      App._onboardPosts.push({...f,text:r.text,post_id:r.post_id});
      if(!_ymOnboardPostGenerated){
        trackGoal("post_generated",{source:"onboarding",channel_id:chan.id});
        _ymOnboardPostGenerated=true;
      }
      // Убираем один скелетон по мере появления поста
      const loadEl=$("ob_load");
      if(loadEl){
        const firstSkeleton=loadEl.querySelector("div");
        if(firstSkeleton) firstSkeleton.remove();
      }
      const el=document.createElement("div");
      el.className="onboard-card";
      el.innerHTML=`<div class="onboard-header">
        <div>
          <span style="font-size:13px;font-weight:600;color:var(--accent)">${esc(f.label)}</span>
          <span style="font-size:12px;color:var(--text-faint);margin-left:8px">${esc(f.desc)}</span>
        </div>
        <button class="btn btn-sm" onclick="ncSelect(${i})">Выбрать →</button></div>
        <div style="margin-top:10px;font-size:14px;line-height:1.7;color:var(--text)">${renderTg(r.text)}</div>`;
      $("ob_posts").appendChild(el);
    }catch(e){
      App._onboardPosts.push({...f,text:null,error:e.message});
      // Убираем скелетон и показываем ошибку по этому варианту
      const loadEl=$("ob_load");
      if(loadEl){const fs=loadEl.querySelector("div");if(fs) fs.remove();}
      const errMsg=(e.message||"").toLowerCase();
      const human=errMsg.includes("токен")||errMsg.includes("limit")||errMsg.includes("закончил")
        ? "Посты закончились. Пополни баланс в разделе «Тарифы»."
        : errMsg.includes("529")||errMsg.includes("overload")
        ? "Серверы ИИ перегружены. Попробуй через минуту."
        : (e.message||"Не удалось сгенерировать");
      const el=document.createElement("div");
      el.className="onboard-card";
      el.style.borderColor="var(--red)";
      el.innerHTML=`<div style="font-size:13px;color:var(--red)">⚠️ ${esc(human)}</div>`;
      $("ob_posts").appendChild(el);
    }
  }
  const loadEnd=$("ob_load");if(loadEnd) loadEnd.innerHTML="";
  // Если ни один пост не сгенерировался — особое сообщение
  const okPosts=App._onboardPosts.filter(p=>p.post_id);
  if(!okPosts.length){
    $("ob_posts").insertAdjacentHTML("beforeend",`
      <div style="padding:16px;background:var(--accent-soft);border-radius:var(--radius);text-align:center">
        <div style="font-size:14px;color:var(--accent-dark);margin-bottom:10px">Не удалось создать посты. Проверь баланс в разделе «Тарифы».</div>
        <button class="btn" onclick="go('billing')">Перейти к тарифам →</button>
      </div>`);
    btn.disabled=false;btn.textContent="✦ Попробовать снова";
    btn.style.background="";btn.onclick=()=>ncGenerate();
    return;
  }
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
    trackGoal("onboarding_complete",{channel_id:App.channelId});
    toast("Канал настроен ✓","ok");go("channel",App.channelId);
  }catch(e){toast(e&&e.message?e.message:"Ошибка запроса","err");}
}

// CHANNEL
async function renderChannel(){
  await refreshUser();
  let c;
  try{c=await api("GET","/channels/"+App.channelId);}
  catch(e){toast(e&&e.message?e.message:"Ошибка запроса","err");return go("dashboard");}
  if(!$("app")) return; // DOM ещё не готов — прерываем
  try{c.daily_times=JSON.parse(c.daily_times||"[]");}catch(_){c.daily_times=[];}
  App._chan=c;
  const notConnected=!c.tg_chat?`<div style="background:var(--accent-soft);border:1px solid #e8d5bb;border-radius:12px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:var(--accent-dark)">
    📡 Канал не подключён к Telegram.
    <button class="btn-ghost btn-sm" onclick="App.tab='settings';renderChannel()" style="color:var(--accent);font-weight:600">Подключить →</button></div>`:"";
  $("app").innerHTML=topbar("dashboard","все каналы")+`<div class="wrap">
    ${notConnected}
    <div class="chan-header card" style="margin-bottom:16px">
      <div style="display:flex;flex-direction:column;gap:12px">
        <div>
          <h2 style="font-family:'Instrument Serif',serif;font-size:26px;font-weight:400">${esc(c.title)}</h2>
          <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap">
            ${c.verified?`<span class="chip chip-green">● подключён</span>`:`<span class="chip chip-orange">● не проверен</span>`}
            <span class="chip chip-gray">🕑 ${_intervalLabel(c.interval_hours||12)}</span>
            ${c.tg_chat?`<span class="chip chip-gray" style="font-family:monospace">${esc(c.tg_chat)}</span>`:""}
          </div>
          ${c.about?`<p style="font-size:13px;color:var(--text-dim);margin-top:8px;max-width:500px">${esc(c.about)}</p>`:""}
          ${c.enabled?`<p style="font-size:13px;color:var(--blue);margin-top:6px;font-weight:500">⏱ Следующая генерация ${_nextGenerationLabel(c)}</p>`:""}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm" onclick="openGenPanel()">✦ Создать пост</button>
          <button class="${c.enabled?'btn-outline btn-sm':'btn btn-sm'}" onclick="toggleChannelEnabled()"
            id="pause_btn">${c.enabled?'⏸ Пауза':'▶ Возобновить'}</button>
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
  renderTab();
}

function renderTimer(){} // убран — время публикации теперь на карточках постов

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

function renderPostCard(p, pubMs, channelEnabled){
  const editable=p.status==="pending"||p.status==="onboarding";
  const sched=p.status==="scheduled";
  const isPaused=channelEnabled===false;
  const isFailed=p.status==="failed"; // заготовка — backend пока не выставляет этот статус (см. ниже)

  // ── Один главный визуальный индикатор статуса ─────────────────────────
  // Важно (по новой точной спецификации): для scheduled синим показываем
  // ТОЛЬКО живой countdown, а дату/время — отдельной серой строкой ниже.
  // Раньше дата была частью того же синего pill — это неправильно по задаче.
  let statusPill="", subLine="";
  if(p.status==="published"){
    const ts=p.published_at?new Date(p.published_at+"Z").toLocaleString("ru-RU",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}):"";
    statusPill=`<div class="status-pill status-pill-green">Опубликован</div>`;
    if(ts) subLine=`<div class="status-subline">Опубликован ${ts}</div>`;
  } else if(isFailed){
    // Заготовка под статус "ошибка публикации" — backend сейчас не
    // устанавливает Post.status="failed" ни в одном сценарии (ошибки
    // публикации остаются в pending/scheduled с уведомлением через бота).
    // Индикатор готов к моменту когда такой статус появится.
    statusPill=`<div class="status-pill status-pill-red">Ошибка публикации</div>`;
    if(p.publish_error) subLine=`<div class="status-subline" style="color:var(--red)">${esc(p.publish_error)}</div>`;
  } else if(p.status==="rejected"){
    statusPill=`<div class="status-pill status-pill-gray">Удалён</div>`;
  } else if(isPaused){
    statusPill=`<div class="status-pill status-pill-gray">На паузе</div>`;
  } else if(sched && p.scheduled_at){
    const sd=new Date(p.scheduled_at+"Z");const diff=sd-Date.now();
    const h=Math.floor(diff/3600000),m=Math.floor((diff%3600000)/60000),sec=Math.floor((diff%60000)/1000);
    const countdown=diff>0?(h>0?`через ${h}ч ${m}м`:`через ${m}:${String(sec).padStart(2,"0")}`):"скоро";
    const ts=sd.toLocaleString("ru-RU",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
    statusPill=`<div class="status-pill status-pill-blue" id="countdown_${p.id}" data-target-ms="${sd.getTime()}">⏱ ${countdown}</div>`;
    subLine=`<div class="status-subline">Опубликуется ${ts}</div>`;
  } else if(editable){
    // КРИТИЧНО (фикс путаницы из задачи): pending-пост НИКОГДА не должен
    // показывать синий countdown публикации, даже если у канала включена
    // auto_publish. Синий countdown — это только для status="scheduled"
    // (пост явно поставлен в расписание через "Запланировать"). Раньше здесь
    // была ветка, которая путала "канал настроен на автопубликацию по
    // расписанию" с "этот конкретный пост скоро опубликуется" — это и
    // создавало конфликт "Ждёт подтверждения" + синий таймер одновременно.
    statusPill=`<div class="status-pill status-pill-yellow">Ждёт вашего подтверждения</div>`;
    const created=new Date(p.created_at+"Z").toLocaleString("ru-RU",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
    subLine=`<div class="status-subline">Создан ${created}</div>`;
  }

  // ── Кнопки: одна primary + один secondary, остальное в меню "..." ────
  const channelConnected = App._chan && App._chan.tg_chat && App._chan.verified;
  const publishDisabledAttr = channelConnected ? "" : `disabled title="Сначала подключите Telegram-канал"`;
  let primaryBtn="", secondaryBtn="", menuItems="";
  if(isFailed){
    primaryBtn=`<button class="btn btn-sm" onclick="toggleEdit(${p.id})" id="edit_${p.id}">Исправить</button>`;
    secondaryBtn=`<button class="btn-outline btn-sm" onclick="publishPost(${p.id})" ${publishDisabledAttr}>Повторить</button>`;
    menuItems=`<button class="menu-item menu-item-danger" onclick="closePostMenu(${p.id});deletePost(${p.id})">Удалить</button>`;
  } else if(editable){
    primaryBtn=`<button class="btn btn-green btn-sm" onclick="publishPost(${p.id})" ${publishDisabledAttr}>Опубликовать сейчас</button>`;
    secondaryBtn=`<button class="btn-ghost btn-sm" onclick="toggleEdit(${p.id})" id="edit_${p.id}">Изменить</button>`;
    menuItems=`
      <button class="menu-item" onclick="closePostMenu(${p.id});showPicker(${p.id})">⏰ Запланировать</button>
      <button class="menu-item menu-item-danger" onclick="closePostMenu(${p.id});rejectPost(${p.id})">Удалить</button>
      <button class="menu-item" onclick="closePostMenu(${p.id});regenPost(${p.id})" id="regen_${p.id}">↻ Сгенерировать заново</button>`;
  } else if(sched){
    primaryBtn=`<button class="btn-outline btn-sm" onclick="toggleEdit(${p.id})" id="edit_${p.id}">Изменить</button>`;
    secondaryBtn=`<button class="btn-ghost btn-sm" onclick="publishPost(${p.id})" ${publishDisabledAttr}>Опубликовать сейчас</button>`;
    menuItems=`
      <button class="menu-item" onclick="closePostMenu(${p.id});showPicker(${p.id})">📅 Перенести</button>
      <button class="menu-item menu-item-danger" onclick="closePostMenu(${p.id});rejectPost(${p.id})">Удалить</button>`;
  } else if(p.status==="published"){
    const chatLabel=(App._chan?.tg_chat||"").replace(/^https?:\/\/t\.me\//i,"").replace(/^@/,"");
    const tgUrl=p.tg_message_id&&chatLabel?`https://t.me/${chatLabel}/${p.tg_message_id}`:`https://t.me/${chatLabel}`;
    primaryBtn=`<button class="btn-outline btn-sm" onclick="window.open('${tgUrl}','_blank')">Открыть в Telegram</button>`;
    secondaryBtn=`<button class="btn-ghost btn-sm" onclick="regenPost(${p.id})">Создать похожий</button>`;
    menuItems=`<button class="menu-item menu-item-danger" onclick="closePostMenu(${p.id});deletePost(${p.id})">Удалить из списка</button>`;
  } else {
    menuItems=`<button class="menu-item menu-item-danger" onclick="closePostMenu(${p.id});deletePost(${p.id})">Удалить</button>`;
  }
  const menuBtn = menuItems ? `
    <div style="position:relative;margin-left:auto">
      <button class="btn-ghost btn-sm" onclick="togglePostMenu(${p.id})" style="padding:6px 10px">⋯</button>
      <div id="pmenu_${p.id}" class="post-menu hidden">${menuItems}</div>
    </div>` : "";

  return `<div class="post-card" id="pc_${p.id}">
    ${statusPill}
    ${subLine}
    <div id="ppreview_${p.id}" style="position:relative">
      <div id="pb_${p.id}" class="post-body post-preview-short" style="margin-top:8px">${renderTg(p.text)}</div>
      <button id="pexp_${p.id}" class="expand-btn" onclick="toggleExpand(${p.id})">Читать полностью ↓</button>
    </div>
    ${(editable||sched||isFailed)?`<textarea id="pt_${p.id}" class="post-body hidden" style="width:100%;min-height:120px;margin-top:8px">${esc(p.text)}</textarea>`:""}
    <div id="picker_${p.id}" class="hidden" style="margin-top:10px;padding:12px;background:var(--surface2);border-radius:10px;border:1px solid var(--border-soft)">
      <div class="field-label" style="margin-bottom:6px">Дата и время (UTC)</div>
      <div class="row" style="gap:8px">
        <input type="datetime-local" id="dt_${p.id}" style="flex:1">
        <button class="btn btn-sm" onclick="doSchedule(${p.id})">Запланировать</button>
        <button class="btn-ghost btn-sm" onclick="$('picker_${p.id}').classList.add('hidden')">✕</button>
      </div>
    </div>
    <div class="post-actions" style="margin-top:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      ${primaryBtn}${secondaryBtn}
      <button class="btn-ghost btn-sm hidden" id="save_${p.id}" onclick="savePost(${p.id})">💾 Сохранить</button>
      ${menuBtn}
    </div></div>`;
}

// Живой countdown с секундами для ближайшего scheduled/auto-publish поста
// (первая карточка с countdown_ — по построению ближайшая по времени, см.
// renderQueue). Остальные карточки обновляются раз в минуту через обычный
// re-render всей очереди — не перегружаем UI частыми перерисовками.
let _countdownTimer=null, _countdownTargetMs=null, _countdownPostId=null;

function startNearestCountdown(){
  if(_countdownTimer){clearInterval(_countdownTimer);_countdownTimer=null;}
  const el=document.querySelector('[id^="countdown_"]');
  if(!el) return;
  _countdownPostId=el.id.replace("countdown_","");
  _countdownTargetMs=parseInt(el.dataset.targetMs||"0",10);
  if(!_countdownTargetMs) return;

  _countdownTimer=setInterval(()=>{
    const liveEl=$(`countdown_${_countdownPostId}`);
    if(!liveEl){clearInterval(_countdownTimer);_countdownTimer=null;return;}
    const diff=_countdownTargetMs-Date.now();
    if(diff<=0){
      liveEl.textContent="⏱ скоро";
      clearInterval(_countdownTimer);_countdownTimer=null;
      // Время публикации подошло — обновляем всю очередь чтобы подхватить
      // реальный статус с backend (auto-publish тикает на сервере).
      setTimeout(()=>{ if(App.tab==="queue") renderQueue(); },3000);
      return;
    }
    const h=Math.floor(diff/3600000),m=Math.floor((diff%3600000)/60000),sec=Math.floor((diff%60000)/1000);
    liveEl.textContent=h>0?`⏱ через ${h}ч ${m}м`:`⏱ через ${m}:${String(sec).padStart(2,"0")}`;
  },1000);
}

function togglePostMenu(postId){
  // Закрываем все остальные открытые меню перед открытием текущего.
  document.querySelectorAll(".post-menu").forEach(el=>{
    if(el.id!==`pmenu_${postId}`) el.classList.add("hidden");
  });
  const el=$(`pmenu_${postId}`);
  if(el) el.classList.toggle("hidden");
}
function closePostMenu(postId){
  const el=$(`pmenu_${postId}`);
  if(el) el.classList.add("hidden");
}
document.addEventListener("click",e=>{
  if(!e.target.closest(".post-menu") && !e.target.closest('[onclick^="togglePostMenu"]')){
    document.querySelectorAll(".post-menu").forEach(el=>el.classList.add("hidden"));
  }
});

async function renderQueue(){
  $("tabbody").innerHTML=`<div id="postList"><div class="text-faint" style="padding:20px">Загрузка…</div></div>`;
  let posts=[];
  try{posts=await api("GET","/channels/"+App._chan.id+"/posts");}catch(e){}

  const pending=posts.filter(p=>p.status==="pending"||p.status==="onboarding"||p.status==="scheduled");
  const history=posts.filter(p=>p.status==="published"||p.status==="rejected");
  const c=App._chan;

  // Пояснительный блок про автопубликацию (task item D) — снимает путаницу
  // между "пост ждёт подтверждения" и "пост скоро опубликуется сам".
  const autoPublishInfo = c.auto_publish
    ? `<div class="card" style="background:var(--blue-bg);border:none;margin-bottom:14px;padding:14px 16px">
        <div style="font-size:13px;color:var(--blue);font-weight:600">Автопубликация включена</div>
        <div style="font-size:13px;color:var(--text-dim);margin-top:2px">Посты будут выходить по расписанию каждые ${_intervalLabel(c.interval_hours||12)}.</div>
        <button class="btn-ghost btn-sm" style="margin-top:6px;padding:4px 0;color:var(--blue)" onclick="setTab('settings');setTimeout(()=>{const el=document.getElementById('settings_automation_card');if(el) el.scrollIntoView({behavior:'smooth',block:'center'});},100)">Изменить</button>
      </div>`
    : `<div class="card" style="background:var(--accent-soft);border:none;margin-bottom:14px;padding:14px 16px">
        <div style="font-size:13px;color:var(--accent-dark);font-weight:600">Автопубликация выключена</div>
        <div style="font-size:13px;color:var(--text-dim);margin-top:2px">Посты ждут вашего подтверждения. Можно включить автопубликацию в настройках.</div>
        <button class="btn-ghost btn-sm" style="margin-top:6px;padding:4px 0;color:var(--accent-dark)" onclick="setTab('settings');setTimeout(()=>{const el=document.getElementById('settings_automation_card');if(el) el.scrollIntoView({behavior:'smooth',block:'center'});},100)">Открыть настройки</button>
      </div>`;

  let html=autoPublishInfo;
  if(!pending.length){
    const paused = c && !c.enabled;
    html+=paused
      ? `<div class="empty"><div class="empty-icon">⏸</div><h3>Канал на паузе</h3><p>При возобновлении автоматически сгенерируются 3 поста.</p></div>`
      : `<div class="empty"><div class="empty-icon">✦</div><h3>Очередь пуста</h3><p>Посты скоро появятся автоматически.</p></div>`;
  } else {
    html+=pending.map((p)=>{
      // КРИТИЧНО (фикс путаницы из задачи): pubMs передаём ТОЛЬКО для
      // реально запланированных постов (p.scheduled_at стоит явно через
      // "Запланировать"). Раньше здесь вычислялось спекулятивное время
      // публикации для ЛЮБОГО pending-поста на основе интервала канала —
      // это и создавало конфликт "Ждёт подтверждения" + синий таймер.
      // Pending-пост не имеет реального времени публикации, пока пользователь
      // явно не подтвердит или не запланирует его.
      const pubMs=p.scheduled_at?new Date(p.scheduled_at+"Z").getTime():null;
      return renderPostCard(p, pubMs, c.enabled);
    }).join("");
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
  startNearestCountdown();
}