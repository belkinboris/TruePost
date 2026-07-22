
function closePostMenu(postId){
  const el=$(`pmenu_${postId}`);
  if(el) el.classList.add("hidden");
}
document.addEventListener("click",e=>{
  if(!e.target.closest(".post-menu") && !e.target.closest('[onclick^="togglePostMenu"]')){
    document.querySelectorAll(".post-menu").forEach(el=>el.classList.add("hidden"));
  }
});

let _queueViewMode="list"; // "list" | "calendar" -- сбрасывается на "list" при каждом заходе на новый канал (см. renderChannel)

async function renderQueue(){
  $("tabbody").innerHTML=`<div id="postList"><div class="text-faint" style="padding:20px">Загрузка…</div></div>`;
  let posts=[];
  try{posts=await api("GET","/channels/"+App._chan.id+"/posts");}catch(e){}
  App._queuePosts=posts; // календарь и переключение вида работают без повторного запроса

  $("tabbody").innerHTML=`<div id="postList"></div>`;
  renderQueueBody();
}

function setQueueViewMode(mode){
  _queueViewMode=mode;
  renderQueueBody();
}

function renderQueueBody(){
  // Если где-то шёл отсчёт отмены публикации (см. publishPost/_pendingPublish
  // в app.part15.js) -- полная перерисовка сейчас уничтожит ту кнопку, но
  // таймер в памяти продолжил бы тикать невидимо и опубликовал бы пост без
  // единого предупреждения на экране. Уход с этой кнопки -- считаем неявной
  // отменой, безопаснее не публиковать, чем опубликовать незаметно.
  Object.keys(_pendingPublish).forEach(id=>{
    clearInterval(_pendingPublish[id].intervalId);
    clearTimeout(_pendingPublish[id].timeoutId);
    delete _pendingPublish[id];
  });
  const posts=App._queuePosts||[];
  const pending=posts.filter(p=>p.status==="pending"||p.status==="onboarding"||p.status==="scheduled");
  const history=posts.filter(p=>p.status==="published"||p.status==="rejected");
  const c=App._chan;

  // Пояснительный блок про автопубликацию (task item D) — снимает путаницу
  // между "пост ждёт подтверждения" и "пост скоро опубликуется сам".
  const softControlMin = App.cfg?.soft_control_minutes || 30;
  const autoPublishInfo = c.auto_publish
    ? `<div class="card" style="background:var(--blue-bg);border:none;margin-bottom:14px;padding:14px 16px">
        <div style="font-size:13px;color:var(--blue);font-weight:600">Автоматическая публикация</div>
        <div style="font-size:13px;color:var(--text-dim);margin-top:2px">Посты будут выходить по расписанию ${_intervalLabel(c.interval_hours||12)}.</div>
        <button class="btn-ghost btn-sm" style="margin-top:6px;padding:4px 0;color:var(--blue)" onclick="setTab('settings');setTimeout(()=>{const el=document.getElementById('settings_automation_card');if(el) el.scrollIntoView({behavior:'smooth',block:'center'});},100)">Изменить</button>
      </div>`
    : `<div class="card" style="background:var(--accent-soft);border:none;margin-bottom:14px;padding:14px 16px">
        <div style="font-size:13px;color:var(--accent-dark);font-weight:600">Публикация после подтверждения</div>
        <div style="font-size:13px;color:var(--text-dim);margin-top:2px">${App.user?.tg_chat_id
          ? `Новый пост присылаем вам в Telegram с кнопками. Опубликуется сам через ${softControlMin} мин, если не отреагируете.`
          : `Подтвердить или отклонить можно прямо здесь, в очереди. Опубликуется сам через ${softControlMin} мин, если не отреагируете. Подключите уведомления в Telegram, чтобы подтверждать с телефона, не заходя на сайт.`}</div>
        <button class="btn-ghost btn-sm" style="margin-top:6px;padding:4px 0;color:var(--accent-dark)" onclick="setTab('settings');setTimeout(()=>{const el=document.getElementById('settings_automation_card');if(el) el.scrollIntoView({behavior:'smooth',block:'center'});},100)">Открыть настройки</button>
      </div>`;

  const viewToggle=`<div style="display:flex;gap:8px;margin-bottom:14px">
    <button class="btn-sm ${_queueViewMode==="list"?"btn":"btn-outline"}" onclick="setQueueViewMode('list')">📋 Список</button>
    <button class="btn-sm ${_queueViewMode==="calendar"?"btn":"btn-outline"}" onclick="setQueueViewMode('calendar')">🗓 Календарь</button>
  </div>`;

  let html=autoPublishInfo+viewToggle;

  if(_queueViewMode==="calendar"){
    html+=renderQueueCalendar(posts);
    $("postList").innerHTML=html;
    return;
  }

  if(!pending.length){
    const paused = c && !c.enabled;
    // КРИТИЧНО (fix): для неподключённого канала tick() вообще не
    // генерирует посты (см. tasks.py: генерация идёт только для
    // channel.verified==True) -- "посты скоро появятся автоматически"
    // было прямой ложью в этом состоянии, ничего не появится, пока канал
    // не подключат, сколько бы ни ждали.
    const notConnected = c && !(c.tg_chat && c.verified);
    if(paused){
      html+=`<div class="empty"><div class="empty-icon">⏸</div><h3>Канал на паузе</h3><p>При возобновлении автоматически сгенерируются 3 поста.</p></div>`;
    } else if(notConnected){
      html+=`<div class="empty"><div class="empty-icon">📡</div><h3>Канал ещё не подключён</h3><p>Посты начнут генерироваться автоматически, как только подключите канал к Telegram.</p>
        <button class="btn btn-sm" style="margin-top:10px" onclick="setTab('settings')">Подключить →</button>
      </div>`;
    } else {
      html+=`<div class="empty"><div class="empty-icon">✦</div><h3>Очередь пуста</h3><p>Посты скоро появятся автоматически.</p></div>`;
    }
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

// ── КАЛЕНДАРЬ (task item: вид очереди по датам) ────────────────────────
// Показывает посты, у которых есть конкретная дата: опубликованные
// (published_at) и явно запланированные (scheduled_at, статус "scheduled").
// Посты в режиме "публикация после подтверждения" (pending) намеренно не
// показываются на календаре -- у них ещё нет фиксированной даты публикации,
// она зависит от того, когда/подтвердит ли пользователь пост (см. очередь
// в виде списка для них).
let _calMonth=null; // Date (1-е число месяца, локальное время) -- null = текущий месяц при первом открытии
let _calSelectedDate=null; // "YYYY-MM-DD" -- какой день сейчас раскрыт под календарём

function _dateKey(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function changeCalMonth(delta){
  const m=_calMonth||new Date();
  _calMonth=new Date(m.getFullYear(), m.getMonth()+delta, 1);
  _calSelectedDate=null;
  renderQueueBody();
}

function selectCalDate(key){
  _calSelectedDate=(_calSelectedDate===key)?null:key;
  renderQueueBody();
}

function renderQueueCalendar(posts){
  const monthDate=_calMonth||new Date();
  const year=monthDate.getFullYear(), month=monthDate.getMonth();

  const byDate={};
  posts.forEach(p=>{
    let d=null, kind=null;
    if(p.status==="published" && p.published_at){ d=new Date(p.published_at+"Z"); kind="published"; }
    else if(p.status==="scheduled" && p.scheduled_at){ d=new Date(p.scheduled_at+"Z"); kind="scheduled"; }
    if(!d) return;
    const key=_dateKey(d);
    (byDate[key]=byDate[key]||[]).push({...p, _calKind:kind, _calTime:d});
  });

  const firstOfMonth=new Date(year,month,1);
  const daysInMonth=new Date(year,month+1,0).getDate();
  // Понедельник = 0 (российская неделя)
  const leadingBlanks=(firstOfMonth.getDay()+6)%7;
  const todayKey=_dateKey(new Date());

  let cells="";
  for(let i=0;i<leadingBlanks;i++) cells+=`<div class="cal-cell cal-cell-empty"></div>`;
  for(let day=1;day<=daysInMonth;day++){
    const key=`${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    const items=(byDate[key]||[]).sort((a,b)=>a._calTime-b._calTime);
    const isToday=key===todayKey;
    const isSelected=key===_calSelectedDate;
    const dots=items.slice(0,3).map(it=>`<span class="cal-dot cal-dot-${it._calKind}"></span>`).join("");
    const more=items.length>3?`<span class="cal-more">+${items.length-3}</span>`:"";
    cells+=`<div class="cal-cell${isToday?" cal-cell-today":""}${isSelected?" cal-cell-selected":""}${items.length?" cal-cell-has":""}"
      ${items.length?`onclick="selectCalDate('${key}')"`:""}>
      <div class="cal-daynum">${day}</div>
      ${items.length?`<div class="cal-dots">${dots}${more}</div>`:""}
    </div>`;
  }

  const monthLabel=monthDate.toLocaleDateString("ru-RU",{month:"long",year:"numeric"});
  const weekHead=["Пн","Вт","Ср","Чт","Пт","Сб","Вс"].map(d=>`<div class="cal-cell cal-cell-head">${d}</div>`).join("");

  let selectedBlock="";
  if(_calSelectedDate && byDate[_calSelectedDate]){
    const dLabel=new Date(_calSelectedDate+"T00:00:00").toLocaleDateString("ru-RU",{day:"numeric",month:"long"});
    selectedBlock=`<div style="margin-top:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <h3 style="margin:0">${dLabel}</h3>
        <button class="btn-ghost btn-sm" onclick="selectCalDate('${_calSelectedDate}')">✕ Закрыть</button>
      </div>
      ${byDate[_calSelectedDate].map(p=>renderPostCard(p, p.scheduled_at?new Date(p.scheduled_at+"Z").getTime():null, App._chan.enabled)).join("")}
    </div>`;
  }

  return `<div class="cal-nav">
    <button class="btn-ghost btn-sm" onclick="changeCalMonth(-1)">‹</button>
    <div class="cal-month-label">${monthLabel}</div>
    <button class="btn-ghost btn-sm" onclick="changeCalMonth(1)">›</button>
  </div>
  <div class="cal-grid">${weekHead}${cells}</div>
  <div class="cal-legend"><span><span class="cal-dot cal-dot-published"></span> Опубликован</span><span><span class="cal-dot cal-dot-scheduled"></span> Запланирован</span></div>
  ${selectedBlock}`;
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
          ? `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;background:var(--green-bg);border-radius:10px;margin-bottom:6px;flex-wrap:nowrap;overflow:hidden">
               <span style="color:var(--green);font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">✓ Проверено · ${esc(c.tg_chat)}</span>
               <button class="btn-ghost btn-sm" onclick="showVerifyInput()" style="flex-shrink:0;font-size:12px">Изменить</button>
             </div>
             <div id="verifyInputBlock" class="hidden">
               <div class="row" style="gap:8px">
                 <input id="f_chat" value="${esc(c.tg_chat)}" placeholder="@my_channel" style="flex:1">
                 <button class="btn-outline btn-sm" onclick="verifyChannel()" id="verBtn" style="white-space:nowrap">Проверить</button>
               </div>
               <div class="hint">Добавь бота <b>@${esc(App.cfg?.bot_username||"…")}</b> администратором с правом публикации. <a href="/how-to" target="_blank" rel="noopener">Как это сделать →</a></div>
               <div id="verMsg" style="font-size:13px;margin-top:6px"></div>
             </div>`
          : `<div class="row" style="gap:8px">
               <input id="f_chat" value="${esc(c.tg_chat)}" placeholder="@my_channel" style="flex:1">
               <button class="btn-outline btn-sm" onclick="verifyChannel()" id="verBtn" style="white-space:nowrap">Проверить</button>
             </div>
             <div class="hint">Добавь бота <b>@${esc(App.cfg?.bot_username||"…")}</b> администратором с правом публикации. <a href="/how-to" target="_blank" rel="noopener">Как это сделать →</a></div>
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
    <div class="card" id="settings_automation_card">
      <div class="card-title">Автоматизация</div>
      <div class="toggle-row">
        <div class="toggle-info"><b>Публиковать без проверки</b><small>Если включено — новые посты выходят в канал автоматически по расписанию. Если выключено — каждый новый пост сначала можно подтвердить в очереди на сайте, а если подключены уведомления — ещё и в Telegram с кнопками «Опубликовать», «Отклонить», «Редактировать». Не отреагируете — опубликуется сам через ${App.cfg?.soft_control_minutes||30} мин.</small></div>
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
        <div class="toggle-info"><b>Пост опубликован</b><small>Уведомление после каждой публикации</small></div>
        <label class="switch"><input type="checkbox" id="sw_n2" ${App.user?.notify_published?"checked":""}><span class="slider"></span></label>
      </div>
      <div class="toggle-row">
        <div class="toggle-info"><b>Баланс заканчивается</b><small>Уведомим, когда постов почти не останется</small></div>
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