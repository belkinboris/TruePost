


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
    <div class="card" id="settings_automation_card">
      <div class="card-title">Автоматизация</div>
      <div class="toggle-row">
        <div class="toggle-info"><b>Публиковать без проверки</b><small>Если включено — новые посты выходят в канал автоматически по расписанию, без вашего подтверждения. Если выключено — каждый пост ждёт, пока вы нажмёте «Опубликовать сейчас».</small></div>
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
    trackGoal("post_generated",{source:"test",channel_id:App._chan.id});
    $("test_result").innerHTML=`<div class="card" style="background:var(--surface2)">

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
    notify_published:$("sw_n2")?$("sw_n2").checked:false,
    notify_low_tokens:$("sw_n3")?$("sw_n3").checked:true,
  };
  try{
    await api("PATCH","/channels/"+App._chan.id,payload);
    await api("PATCH","/me",notif);
    // Обновляем локально без перерендера — чтобы тумблеры не сбросились
    if(App.user){ App.user.notify_published=notif.notify_published; App.user.notify_low_tokens=notif.notify_low_tokens; }
    toast("Сохранено ✓","ok");
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
  if(!requireAuth()) return;
  const chat=($("f_chat")||{value:""}).value.trim();if(!chat) return toast("Введите @username или ссылку","err");
  const btn=$("verBtn");if(btn) btn.innerHTML='<span class="spinner"></span>';
  try{
    await api("PATCH","/channels/"+App._chan.id,{tg_chat:chat});
    const r=await api("POST","/channels/"+App._chan.id+"/verify");
    if(r.ok){
      App._chan.tg_chat=chat;App._chan.verified=true;
      trackGoal("telegram_verified",{channel_id:App._chan.id});
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
    trackGoal("style_analyzed",{source:"channel",channel_id:App._chan.id});
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
      trackGoal("post_generated",{source:"manual",channel_id:App._chan.id});
      toast("Готово ✓","ok");
      if($("genPanel")) $("genPanel").classList.add("hidden");
      if($("genTopic")) $("genTopic").value="";
      App.tab="queue";renderChannel();return;
    }catch(e){
      const is529=e.message.includes("529")||e.message.toLowerCase().includes("overload");
      const isLimit=e.message.toLowerCase().includes("токен")||e.message.toLowerCase().includes("баланс");
      if(isLimit) logProductEvent("limit_reached");
      attempts++;
      if(is529&&attempts<3){toast(`Серверы заняты, повтор через 15с… (${attempts}/3)`);await new Promise(r=>setTimeout(r,15000));}
      else{toast(is529?"Серверы перегружены. Попробуй позже.":e.message,"err");if(btn) btn.innerHTML="Создать";return;}
    }
  }
}