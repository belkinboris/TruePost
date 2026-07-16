

async function ccVerify(){
  if(!requireAuth()) return;
  const chatRaw=($("cc_chat")||{value:""}).value.trim();
  if(!chatRaw) return toast("Введите @username или ссылку на канал","err");
  const btn=$("cc_verify_btn"),msg=$("cc_msg");
  btn.innerHTML='<span class="spinner"></span> Проверяем канал…';btn.disabled=true;
  if(msg){msg.textContent="";}

  trackGoal("channel_verify_started",{channel_id:App.channelId,channel_input_raw:chatRaw});

  const TIMEOUT_MS=18000;
  const TIMEOUT_MSG="Операция занимает больше времени обычного. Попробуйте ещё раз или вернитесь позже.";

  const {timedOut, result, error} = await withTimeout((async()=>{
    await api("PATCH","/channels/"+App.channelId,{tg_chat:chatRaw});
    return await api("POST","/channels/"+App.channelId+"/verify");
  })(), TIMEOUT_MS, TIMEOUT_MSG);

  if(timedOut){
    trackGoal("publish_button_loading_timeout",{channel_id:App.channelId,stage:"verify"});
    if(msg){msg.textContent=TIMEOUT_MSG;msg.style.color="var(--accent-dark)";}
    btn.innerHTML="Проверить подключение";btn.disabled=false;
    return;
  }
  if(error){
    trackGoal("channel_verify_failed",{channel_id:App.channelId,reason:"exception"});
    if(msg){msg.textContent=error.message||"Не удалось проверить канал";msg.style.color="var(--red)";}
    btn.innerHTML="Проверить подключение";btn.disabled=false;
    return;
  }

  const r=result;
  if(r.ok){
    // activation_2: канал успешно подключён. ВАЖНО: подключение канала и
    // публикация поста — два разных шага (см. задачу), здесь НЕ публикуем
    // автоматически. Показываем экран подтверждения, решение — на пользователе.
    trackGoal("channel_connected",{channel_id:App.channelId});
    trackGoal("channel_verify_success",{channel_id:App.channelId});
    logLandingEventWeb("channel_connected");
    renderPublishConfirm(App.channelId, chatRaw);
  } else {
    trackGoal("channel_verify_failed",{channel_id:App.channelId,reason:r.message});
    if(msg){msg.textContent=r.message;msg.style.color="var(--red)";}
    btn.innerHTML="Проверить подключение";btn.disabled=false;
  }
}

// Step 5: экран подтверждения публикации — отдельный явный шаг, не
// автоматическое следствие успешной верификации (ключевой инвариант задачи:
// "Подключение канала ≠ публикация поста").
async function renderPublishConfirm(channelId, tgChat){
  let posts=[];
  try{posts=await api("GET",`/channels/${channelId}/posts`);}catch(e){}
  const pending=(posts||[]).find(p=>p.status==="pending"||p.status==="onboarding");

  trackGoal("publish_confirm_screen_shown",{channel_id:channelId});

  if(!$("app")) return;
  $("app").innerHTML=`<div class="wrap" style="max-width:560px">
    <div class="page-head" style="text-align:center;margin-top:24px">
      <div style="font-size:36px;margin-bottom:6px">✅</div>
      <h1 style="font-family:'Instrument Serif',serif;font-size:26px;font-weight:400">Канал подключён</h1>
      <p style="color:var(--text-dim)">Первый пост готов. Опубликовать его сейчас?</p>
    </div>
    ${pending?`<div class="card" style="font-size:14px;line-height:1.6;max-height:200px;overflow:hidden;position:relative">
      ${renderTg(pending.text)}
      <div style="position:absolute;bottom:0;left:0;right:0;height:50px;background:linear-gradient(transparent,var(--surface))"></div>
    </div>`:`<div class="hint">Постов в очереди нет — можно создать новый из карточки канала.</div>`}

    <button class="btn" style="width:100%;justify-content:center;margin-top:16px;padding:14px"
      onclick="ccConfirmPublish(${channelId},${pending?pending.id:"null"},'${esc(tgChat)}')"
      id="cpc_publish_btn" ${pending?"":"disabled"}>Опубликовать сейчас</button>

    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn-outline btn-sm" style="flex:1" onclick="go('channel',${channelId})">Оставить на проверке</button>
      <button class="btn-outline btn-sm" style="flex:1" onclick="ccGoSchedule(${channelId},${pending?pending.id:"null"})" ${pending?"":"disabled"}>Запланировать</button>
    </div>
  </div>`;
}

function ccGoSchedule(channelId, postId){
  // "Запланировать" — ведём в карточку канала, там уже есть полноценный
  // datetime-picker для постов (showPicker/doSchedule). Не дублируем здесь.
  go("channel", channelId);
  if(postId) setTimeout(()=>{ if(typeof showPicker==="function") showPicker(postId); },300);
}

// Опрашивает статус поста с коротким интервалом до подтверждения публикации
// или до истечения maxWaitMs. Используется после ложного timeout публикации,
// чтобы не показывать ошибку если Telegram-сторона на самом деле уже успешна
// (P0 fix item 1).
async function pollPostStatus(postId, maxWaitMs=20000, intervalMs=2000){
  const deadline=Date.now()+maxWaitMs;
  while(Date.now()<deadline){
    try{
      const status=await api("GET",`/posts/${postId}/status`);
      if(status.status==="published") return {confirmed:true, status};
    }catch(e){
      // Сетевая ошибка при опросе статуса — пробуем ещё раз, не сдаёмся сразу.
    }
    await new Promise(r=>setTimeout(r,intervalMs));
  }
  return {confirmed:false, status:null};
}

async function ccConfirmPublish(channelId, postId, tgChat){
  if(!requireAuth()) return;
  if(!postId) return;
  const btn=$("cpc_publish_btn");
  btn.innerHTML='<span class="spinner"></span> Публикуем…';btn.disabled=true;

  trackGoal("first_post_publish_started",{
    channel_id:channelId, post_id:postId,
    was_publish_explicitly_confirmed:true,
    auto_publish_without_review:App._chan?.auto_publish||false,
  });

  const TIMEOUT_MS=18000;
  const TIMEOUT_MSG="Публикация занимает больше времени обычного. Проверяем статус. Не нажимайте повторно, чтобы не создать дубль.";

  const {timedOut, error} = await withTimeout(
    api("POST",`/posts/${postId}/publish`), TIMEOUT_MS, TIMEOUT_MSG
  );

  if(timedOut){
    // КРИТИЧНО (P0 fix): не показываем ошибку сразу. HTTP-запрос мог
    // зависнуть на фронте (медленная сеть, мобильное соединение), при этом
    // backend мог успешно опубликовать пост в Telegram ДО таймаута. Сначала
    // проверяем реальный статус, и только если он не подтвердился —
    // показываем ошибку. Кнопка остаётся disabled всё это время, чтобы
    // исключить повторный клик и дублирующую публикацию.
    trackGoal("publish_button_loading_timeout",{channel_id:channelId,post_id:postId,stage:"publish"});
    btn.innerHTML='<span class="spinner"></span> Проверяем статус публикации…';
    const {confirmed}=await pollPostStatus(postId);
    if(confirmed){
      trackGoal("first_post_publish_success",{channel_id:channelId,post_id:postId,reconciled_after_timeout:true});
      trackGoal("first_post_published",{channel_id:channelId});
      logLandingEventWeb("first_post_published");
      await renderPublishSuccess(channelId, tgChat, postId);
      return;
    }
    trackGoal("first_post_publish_failed",{channel_id:channelId,post_id:postId,reason:"timeout_unconfirmed"});
    toast("Не удалось подтвердить публикацию. Проверьте канал или попробуйте ещё раз.","err");
    btn.innerHTML="Опубликовать сейчас";btn.disabled=false;
    return;
  }
  if(error){
    trackGoal("first_post_publish_failed",{channel_id:channelId,post_id:postId,reason:error.message});
    toast(error.message||"Не удалось опубликовать пост","err");
    btn.innerHTML="Опубликовать сейчас";btn.disabled=false;
    return;
  }

  // activation_3 + success_screen: публикация подтверждена явно пользователем.
  // already_published=true означает что предыдущая попытка (например после
  // ложного timeout) на самом деле успела опубликовать пост на backend —
  // показываем success так же, без дублирования сообщения в канале
  // (publish_post на backend идемпотентен).
  trackGoal("first_post_published",{channel_id:channelId});
  trackGoal("first_post_publish_success",{channel_id:channelId});
  logLandingEventWeb("first_post_published");
  await renderPublishSuccess(channelId, tgChat, postId);
}

async function renderPublishSuccess(channelId, tgChat, postId){
  const chatLabel = (tgChat||"").replace(/^https?:\/\/t\.me\//i,"").replace(/^@/,"");
  const tgUrl = `https://t.me/${chatLabel}`;
  trackGoal("success_screen_shown",{channel_id:channelId});

  // Task C rules 3-4: контекстная подсказка про очередь/автопубликацию.
  // Не критично если не получится загрузить — экран всё равно покажется.
  let contextLine = "";
  try{
    const chan = await api("GET", "/channels/"+channelId);
    const posts = await api("GET", `/channels/${channelId}/posts`);
    const pendingCount = (posts||[]).filter(p=>p.status==="pending"||p.status==="onboarding").length;
    if(pendingCount > 0){
      contextLine = `<p style="font-size:13px;color:var(--text-dim);margin-top:8px">В очереди уже есть посты, которые ждут вашего подтверждения.</p>`;
    } else if(!chan.auto_publish){
      contextLine = `<p style="font-size:13px;color:var(--text-dim);margin-top:8px">Новые посты будут ждать вашего подтверждения. Это можно изменить в настройках.</p>`;
    }
  }catch(_){}

  if(!$("app")) return;
  $("app").innerHTML=`<div class="wrap" style="max-width:560px">
    <div class="page-head" style="text-align:center;margin-top:32px">
      <div style="font-size:40px;margin-bottom:8px">✅</div>
      <h1 style="font-family:'Instrument Serif',serif;font-size:26px;font-weight:400">Готово — пост опубликован</h1>
      <p style="color:var(--text-dim)">Пост опубликован в канале @${esc(chatLabel)}</p>
      ${contextLine}
    </div>
    <button class="btn" style="width:100%;justify-content:center;margin-top:16px;padding:14px"
      onclick="trackGoal('queue_opened',{channel_id:${channelId}});go('channel',${channelId})">Перейти в очередь</button>
    <button class="btn-outline btn-sm" style="width:100%;justify-content:center;margin-top:10px"
      onclick="go('new_channel')">Создать следующий пост</button>
    <div style="text-align:center;margin-top:14px">
      <a onclick="window.open('${tgUrl}','_blank')" style="font-size:13px;color:var(--text-faint);cursor:pointer;text-decoration:underline">Открыть пост в Telegram</a>
    </div>
  </div>`;
}

function renderNewChannel(){
  _ncVoice="author";_ncFormat="story";_ncEmoji="minimal";_ncCta=false;_ncCtaText="";_ncHz=12;_ncStyleProfile="";
  $("app").innerHTML=topbar("dashboard","все каналы")+`<div class="wrap" style="max-width:680px">
    <div class="page-head"><h1>Новый канал</h1>
      <p>Расскажи о канале — ИИ покажет три варианта постов на выбор.</p></div>
    <div class="card">
      <label class="field"><span class="field-label">Название (для тебя)</span>
        <input id="nc_title" placeholder="Например: Крипта без воды" maxlength="80"></label>

      <div class="field mt"><span class="field-label">Telegram-канал</span>
        <div id="nc_verify_block">
          <div class="row" style="gap:8px">
            <input id="nc_chat" placeholder="@my_channel или https://t.me/channel" style="flex:1">
            <button class="btn-outline btn-sm" onclick="ncVerify()" id="nc_vbtn" style="white-space:nowrap">Проверить</button>
          </div>
          <div class="hint">Сначала добавь бота <b>@${esc(App.cfg?.bot_username||"…")}</b> в админы канала, потом вставь @username и нажми «Проверить».</div>
          <div id="nc_vmsg" style="font-size:13px;margin-top:6px"></div>
          <button class="btn-ghost btn-sm" onclick="ncSkipVerify()"
            style="margin-top:8px;font-size:13px;color:var(--accent)">Подключу позже →</button>
        </div>
        <div id="nc_verify_skipped" class="hidden">
          <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--surface2);border-radius:12px">
            <span style="font-size:18px">🕓</span>
            <div style="flex:1;font-size:13px;color:var(--text-dim);line-height:1.5">
              Канал подключишь позже в настройках. Сейчас ИИ покажет варианты постов.
            </div>
            <button class="btn-ghost btn-sm" onclick="ncShowVerify()" style="font-size:12px;color:var(--accent);white-space:nowrap">Подключить</button>
          </div>
        </div>
      </div>

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
    trackGoal("style_analyzed",{source:"onboarding"});
    toast("Стиль изучен","ok");
  }catch(e){toast(e&&e.message?e.message:"Ошибка запроса","err");}
  btn.innerHTML="Изучить";btn.disabled=false;
}