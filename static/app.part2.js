

function qsChooseAnalyze(){
  logProductEvent("onboarding_choice_selected", "analyze_existing_channel");
  // Безопасный первый шаг: запросить @username канала.
  // Не обещаем полноценный анализ — показываем что принято к сведению
  // и переходим к генерации с подсказкой темы из имени канала.
  $("app").innerHTML=`<div class="wrap" style="max-width:560px">
    <button class="back-link" style="margin-top:12px" onclick="renderQuickStart()">← Назад</button>
    <div class="page-head" style="text-align:center;margin-top:8px">
      <h1 style="font-family:'Instrument Serif',serif;font-size:26px;font-weight:400">Ваш канал</h1>
      <p style="color:var(--text-dim)">Укажите @username или ссылку на канал</p>
    </div>
    <div class="card">
      <input id="qs_channel_link" placeholder="@mychannel или t.me/mychannel" style="font-size:15px;width:100%">
    </div>
    <p style="color:var(--text-faint);font-size:13px;margin-top:8px;text-align:center">
      Сгенерируем пример поста в стиле вашего канала.
    </p>
    <button class="btn" style="width:100%;justify-content:center;margin-top:16px;padding:14px"
      onclick="qsAnalyzeSubmit()">Продолжить</button>
    <div style="text-align:center;margin-top:12px">
      <button class="btn-ghost btn-sm" style="color:var(--text-faint)" onclick="renderQuickStartGenerate()">
        Пропустить — начать с темы
      </button>
    </div>
  </div>`;
  setTimeout(()=>{const el=$("qs_channel_link");if(el) el.focus();},100);
}

function qsAnalyzeSubmit(){
  const raw=($("qs_channel_link").value||"").trim();
  if(!raw) return toast("Укажите @username канала","err");
  const handle=raw.replace(/^https?:\/\/t\.me\//,"@").replace(/^t\.me\//,"@").replace(/^@+/,"@");
  renderQuickStartGenerate(handle);
}

function renderQuickStartGenerate(prefillTopic){
  // Экран с textarea — существующий quick start flow без изменений логики генерации.
  $("app").innerHTML=`<div class="wrap" style="max-width:560px">
    <button class="back-link" style="margin-top:12px" onclick="renderQuickStart()">← Назад</button>
    <div class="page-head" style="text-align:center;margin-top:8px">
      <h1 style="font-family:'Instrument Serif',serif;font-size:30px;font-weight:400">О чём сделать первый пост?</h1>
      <p style="color:var(--text-dim)">Канал можно подключить позже — сначала покажем пример поста.</p>
      <p style="color:var(--text-faint);font-size:13px;margin-top:6px">Сейчас покажем пример поста. Потом можно будет менять стиль, длину, расписание и подключить канал.</p>
    </div>
    <div class="card">
      <textarea id="qs_about" rows="3" placeholder="Например: M&A сделки в России, Roblox, салон красоты, криптоновости" style="font-size:15px"></textarea>
    </div>
    <button class="btn" style="width:100%;justify-content:center;margin-top:16px;padding:14px"
      onclick="qsGenerate()" id="qs_btn">Сгенерировать пост</button>
  </div>`;
  if(prefillTopic){const el=$("qs_about");if(el) el.value=prefillTopic;}
  setTimeout(()=>{const el=$("qs_about");if(el) el.focus();},100);
}

function qsSkip(){
  // Флаг "пропустил онбординг" — теперь сохраняется в localStorage,
  // чтобы переживать перезагрузку. Без этого renderDashboard() при
  // chans.length===0 снова показывал quick start.
  trackGoal("quick_start_skipped");
  logProductEvent("onboarding_choice_selected", "skip");
  App._onboardingSkipped = true;
  localStorage.setItem("ap_onboarding_skipped", "1");
  go("dashboard");
}

// ── Создание второго и следующих каналов (task item 2) ────────────────
// Минимальная форма с настройками — НЕ quick start (тот только для первого
// канала, см. renderNewChannelRouter). Без полного восстановления старого
// мёртвого renderNewChannel/ncGenerate — это новый, компактный flow.
function renderNewChannelSettings(){
  trackGoal("new_channel_settings_opened");
  $("app").innerHTML=`<div class="wrap" style="max-width:560px">
    <button class="back-link" style="margin-top:12px" onclick="go('dashboard')">← Все каналы</button>
    <div class="page-head" style="margin-top:8px">
      <h1>Новый канал</h1>
      <p style="color:var(--text-dim)">Базовые настройки — остальное можно донастроить позже во вкладке «Расширенные».</p>
    </div>

    <label class="field"><span class="field-label">Название канала</span>
      <input id="ncs_title" placeholder="Например: Новости M&A" style="width:100%"></label>

    <label class="field mt"><span class="field-label">Тема канала</span>
      <textarea id="ncs_about" rows="3" placeholder="О чём канал, для кого, какой тон" style="width:100%;font-size:15px"></textarea></label>

    <label class="field mt"><span class="field-label">@username канала <span class="text-faint">(можно позже)</span></span>
      <input id="ncs_chat" placeholder="@my_channel" style="width:100%"></label>

    <label class="field mt"><span class="field-label">Частота генерации</span>
      <select id="ncs_interval" style="width:100%">
        <option value="6">Каждые 6 часов</option>
        <option value="12" selected>Каждые 12 часов</option>
        <option value="24">Раз в сутки</option>
        <option value="48">Раз в 2 суток</option>
      </select></label>

    <div class="card mt">
      <div class="toggle-row">
        <div class="toggle-info"><b>Публиковать без проверки</b><small>Если выключено — каждый пост ждёт вашего подтверждения перед публикацией.</small></div>
        <label class="switch"><input type="checkbox" id="ncs_auto"><span class="slider"></span></label>
      </div>
    </div>

    <button class="btn" style="width:100%;justify-content:center;margin-top:16px;padding:14px"
      onclick="ncsCreate()" id="ncs_btn">Создать канал</button>
  </div>`;
  setTimeout(()=>{const el=$("ncs_title");if(el) el.focus();},100);
}

let _ncsCreateInFlight=false;

async function ncsCreate(){
  if(!requireAuth()) return;
  if(_ncsCreateInFlight) return;
  const title=($("ncs_title").value||"").trim();
  const about=($("ncs_about").value||"").trim();
  if(!title) return toast("Укажите название канала","err");
  if(!about) return toast("Опишите тему канала","err");

  const tgChat=($("ncs_chat").value||"").trim();
  const intervalHours=parseFloat($("ncs_interval").value||"12");
  const autoPublish=!!$("ncs_auto").checked;

  // Topic validation (та же защита что и в quick start, не дублируем логику —
  // переиспользуем существующий /validate-topic эндпоинт).
  _ncsCreateInFlight=true;
  const btn=$("ncs_btn");
  btn.innerHTML='<span class="spinner"></span> Проверяю тему…';btn.disabled=true;
  try{
    const validation=await api("POST","/validate-topic",{topic:about});
    if(!validation.ok){
      toast(validation.message||"Не понял тему. Напишите проще.","err");
      btn.innerHTML="Создать канал";btn.disabled=false;
      _ncsCreateInFlight=false;
      return;
    }
  }catch(e){
    toast("Не удалось проверить тему. Попробуйте переформулировать.","err");
    btn.innerHTML="Создать канал";btn.disabled=false;
    _ncsCreateInFlight=false;
    return;
  }

  btn.innerHTML='<span class="spinner"></span> Создаю канал…';
  try{
    const chan=await api("POST","/channels",{
      title, about,
      tg_chat: tgChat,
      interval_hours: intervalHours,
      auto_publish: autoPublish,
    });
    trackGoal("new_channel_settings_created",{channel_id:chan.id});
    toast("Канал создан ✓","ok");
    go("channel",chan.id);
  }catch(e){
    toast(e&&e.message?e.message:"Ошибка запроса","err");
    btn.innerHTML="Создать канал";btn.disabled=false;
  }finally{
    _ncsCreateInFlight=false;
  }
}

let _qsGenerateInFlight = false;

async function qsGenerate(){
  if(!requireAuth()) return;
  // КРИТИЧНО (P0 fix): защита от двойного клика через явный флаг, не только
  // через btn.disabled. disabled выставляется синхронно в начале функции,
  // но между двумя очень быстрыми кликами браузер может не успеть
  // перерисовать DOM-состояние кнопки до второго клика — флаг in-memory
  // гарантированно блокирует повторный вызов независимо от рендера.
  if (_qsGenerateInFlight) {
    toast("Пост уже генерируется, подождите несколько секунд.", "err");
    return;
  }
  const about=($("qs_about").value||"").trim();
  if(!about) return toast("Опишите тему","err");
  _qsGenerateInFlight = true;
  try{
    await _qsGenerateImpl(about);
  } finally {
    _qsGenerateInFlight = false;
  }
}

async function _qsGenerateImpl(about){
  console.log(`[qsGenerate] input_topic=«${about}» client_request_id=${App._qsRequestId}`);
  trackGoal("quick_start_submitted",{topic:about});
  const btn=$("qs_btn");
  btn.innerHTML='<span class="spinner"></span> Проверяю тему…';btn.disabled=true;

  // КРИТИЧНО (фикс по итогам ревью): валидируем тему ДО создания канала.
  // Раньше Channel создавался первым, а классификация происходила только
  // внутри /generate — из-за этого неподходящая тема всё равно попадала
  // в dashboard/settings как уже существующий канал. Этот вызов не создаёт
  // ничего в БД, поэтому при отказе канал просто не появляется.
  let validation;
  try{
    validation=await api("POST","/validate-topic",{topic:about});
  }catch(e){
    // Сбой самой проверки — не продолжаем генерацию (см. задачу: classify_topic
    // должен иметь safe fallback, который блокирует, а не пропускает молча).
    toast("Не удалось проверить тему. Попробуйте переформулировать.","err");
    btn.innerHTML="Сгенерировать пост";btn.disabled=false;
    return;
  }
  if(!validation.ok){
    if(validation.is_clarification){
      // Task E: уточняющий вопрос, не ошибка — спокойный, не алармистский UI.
      // Пользователь может согласиться продолжить с безопасной формулировкой
      // той же темы, не теряя то что уже ввёл.
      btn.innerHTML="Сгенерировать пост";btn.disabled=false;
      const qsCard=document.querySelector('#qs_about')?.closest('.card');
      if(qsCard){
        let clarifyBox=document.getElementById('qs_clarify');
        if(!clarifyBox){
          clarifyBox=document.createElement('div');
          clarifyBox.id='qs_clarify';
          clarifyBox.style.marginTop='10px';
          clarifyBox.style.padding='12px';
          clarifyBox.style.background='var(--surface2)';
          clarifyBox.style.borderRadius='10px';
          clarifyBox.style.fontSize='14px';
          qsCard.after(clarifyBox);
        }
        clarifyBox.innerHTML=`<div style="margin-bottom:8px">${esc(validation.message)}</div>
          <button class="btn-sm btn" onclick="document.getElementById('qs_about').value='Образовательный пост про уверенность, коммуникацию и уважение в интимных отношениях: '+document.getElementById('qs_about').value;document.getElementById('qs_clarify').remove();qsGenerate();">Да, такой формат подходит</button>`;
      } else {
        toast(validation.message,"err");
      }
      return;
    }
    toast(validation.message||"Не понял тему. Напишите проще.","err");
    btn.innerHTML="Сгенерировать пост";btn.disabled=false;
    return;
  }

  btn.innerHTML='<span class="spinner"></span> Пишу пост…';

  // Заголовок канала — авто, из темы (первые слова), пользователь сможет
  // переименовать позже в настройках. Не спрашиваем его сейчас намеренно —
  // лишнее поле на первом экране снижает activation (см. задачу).
  const title=about.length>40?about.slice(0,40).trim()+"…":about;

  let chan;
  try{
    chan=await api("POST","/channels",{
      title, about,
      // Короче, чем дефолт — первый пост должен читаться за 10 секунд (см. задачу).
      post_length:"700-1200 знаков, 2-4 коротких абзаца, простой заголовок",
      // Idempotency key (task item E): повторный клик с тем же ключом
      // вернёт уже созданный канал, не создаст дубль.
      client_request_id: App._qsRequestId || "",
    });
  }catch(e){
    toast(e&&e.message?e.message:"Ошибка запроса","err");
    btn.innerHTML="Сгенерировать пост";btn.disabled=false;
    return;
  }
  App.channelId=chan.id;
  trackGoal("first_post_generation_started",{channel_id:chan.id});

  let post;
  try{
    post=await api("POST",`/channels/${chan.id}/generate`,{});
    // Защитная сеть на фронте: backend уже делает fallback при отказе модели,
    // но если что-то всё равно похоже на не-пост (короткий текст, латиница
    // в начале, явный вопрос) — не показываем это пользователю как результат.
    const looksWrong = !post.text || post.text.trim().length < 60
      || /^(what|please|sorry|i\s|let me|could you)/i.test(post.text.trim());
    if(looksWrong){
      trackGoal("first_post_generation_failed",{channel_id:chan.id,reason:"looks_wrong"});
      // Тема уже была одобрена validate-topic, значит это сбой генерации
      // (например web_search не нашёл фактов), а не проблема с темой как
      // таковой — поэтому канал НЕ удаляем, просто сообщаем об ошибке.
      // Пользователь может нажать "Сгенерировать пост" ещё раз для той же темы.
      toast("Не получилось найти свежий факт по этой теме. Попробуйте уточнить тему — например: «новости M&A в России».","err");
      btn.innerHTML="Сгенерировать пост";btn.disabled=false;
      return;
    }
  }catch(e){
    const errMsg=(e&&e.message)||"";
    const isTokenIssue=errMsg.toLowerCase().includes("токен")||errMsg.toLowerCase().includes("баланс");
    trackGoal("first_post_generation_failed",{channel_id:chan.id,reason:errMsg});
    if(isTokenIssue) logProductEvent("limit_reached");

    // Если тема была отклонена классификатором (defense-in-depth расхождение
    // между validate-topic и generate_for_channel) — backend уже удалил
    // канал сам (см. tasks.generate_for_channel). Для остальных технических
    // сбоев (web_search не нашёл фактов, временная ошибка API и т.п.) канал
    // остаётся пустым черновиком — удаляем его и здесь, чтобы не оставлять
    // в dashboard непроверенные дубли без единого поста (task item E, п.4-5).
    if(!isTokenIssue){
      try{await api("DELETE","/channels/"+chan.id);}catch(_){}
    }

    // Backend уже возвращает готовый русский текст для отклонённых тем
    // (unclear/adult/unsafe — см. tasks.generate_for_channel) и для других
    // ошибок генерации. Показываем его как есть, не подменяем дженериком —
    // иначе пользователь не узнает что именно с темой не так.
    const human=isTokenIssue
      ? "Закончились пробные посты. Пополни баланс в разделе «Тарифы»."
      : (errMsg || "Не удалось сгенерировать пост. Попробуй ещё раз.");
    toast(human,"err");
    btn.innerHTML="Сгенерировать пост";btn.disabled=false;
    return;
  }

  // activation_1: первый пост сгенерирован — ключевая метрика онбординга
  trackGoal("first_post_generated",{channel_id:chan.id});
  logLandingEventWeb("first_post_generated");

  renderFirstPostResult(chan.id, post, about);
}

function renderFirstPostResult(channelId, post, about){
  App._qsAbout = about || App._qsAbout || ""; // помним тему для перегенерации
  $("app").innerHTML=`<div class="wrap" style="max-width:560px">
    <div class="page-head" style="text-align:center;margin-top:16px">
      <h1 style="font-family:'Instrument Serif',serif;font-size:26px;font-weight:400">Готово ✦</h1>
      <p style="color:var(--text-dim)">Вот первый пост для канала</p>
    </div>
    <div class="card" style="font-size:15px;line-height:1.7" id="fp_text">${renderTg(post.text)}</div>

    <div id="fp_feedback_block" style="margin-top:20px;padding:16px;background:var(--surface2);border-radius:12px;text-align:center">
      <p style="font-weight:500;margin-bottom:12px">Пост подходит?</p>
      <div style="display:flex;gap:10px;justify-content:center">
        <button class="btn" style="padding:10px 28px" onclick="fpFeedbackGood(${channelId})">Да</button>
        <button class="btn-outline" style="padding:10px 28px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface);cursor:pointer;font-family:inherit;color:var(--text)"
          onclick="fpFeedbackBad(${channelId})">Не совсем</button>
      </div>
    </div>

    <div id="fp_actions" style="display:none">
      <button class="btn" style="width:100%;justify-content:center;margin-top:16px;padding:14px"
        onclick="go('connect_channel',${channelId})">Подключить Telegram-канал</button>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;justify-content:center">
      <button class="btn-outline btn-sm" onclick="qsRegenerate(${channelId})" id="fp_regen_btn">Ещё вариант</button>
      <button class="btn-outline btn-sm" onclick="qsRewrite(${channelId},'короче')" id="fp_short_btn">Сократить</button>
      <button class="btn-outline btn-sm" onclick="qsRewrite(${channelId},'живее')" id="fp_live_btn">Сделать живее</button>
    </div>

    <div style="display:flex;justify-content:space-between;margin-top:16px">
      <button class="btn-ghost btn-sm" style="color:var(--text-faint)" onclick="qsEdit(${channelId},${post.post_id})">Изменить текст</button>
      <button class="btn-ghost btn-sm" style="color:var(--text-faint)" onclick="go('dashboard')">Сохранить на потом</button>
    </div>
  </div>`;
}

function fpFeedbackGood(channelId){
  logProductEvent("first_post_feedback", "good");
  const fb=$("fp_feedback_block");
  if(fb){
    // Эксперимент commercial_bridge: мост от хорошего первого поста к
    // регулярному ведению (тарифам). Превью тем -- статичный формат из
    // about канала (полноценной логики подбора будущих тем в коде нет,
    // генерировать по SPEC не нужно).
    const about=(App._qsAbout||"вашей теме").slice(0,60);
    fb.innerHTML=`<p style="color:var(--ok,#2a9d5c);font-weight:500">Отлично! ✓</p>
      <div id="queue_offer_block" style="margin-top:14px;text-align:left;background:var(--surface);border:1.5px solid var(--border);border-radius:10px;padding:14px">
        <p style="font-weight:600;margin-bottom:6px">Соберём очередь на неделю?</p>
        <p style="color:var(--text-dim);font-size:14px;line-height:1.5">Автопост подготовит 7 постов по вашей теме — по одному на каждый день. Вы просто просматриваете и публикуете.</p>
        <p style="color:var(--text-faint);font-size:13px;margin-top:8px">Например: «${esc(about)} — тема 1», «${esc(about)} — тема 2», «${esc(about)} — тема 3»…</p>
        <button class="btn" style="width:100%;justify-content:center;margin-top:12px;padding:12px" onclick="queueOfferClick()">Собрать очередь</button>
      </div>`;
    logProductEvent("queue_offer_shown");
  }
  const actions=$("fp_actions");
  if(actions) actions.style.display="block";
}

function queueOfferClick(){
  logProductEvent("queue_offer_clicked");
  go("billing");
}

function fpFeedbackBad(channelId){
  logProductEvent("first_post_feedback", "bad");
  const fb=$("fp_feedback_block");
  if(!fb) return;
  const reasons=[
    {k:"too_generic",   label:"Слишком общий"},
    {k:"wrong_style",   label:"Не тот стиль"},
    {k:"wrong_topic",   label:"Не про мою тему"},
    {k:"too_dry",       label:"Слишком сухо"},
    {k:"too_salesy",    label:"Слишком рекламно"},
    {k:"other",         label:"Другое"},
  ];
  fb.innerHTML=`<p style="font-weight:500;margin-bottom:12px">Что не так?</p>
    <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center">
      ${reasons.map(r=>`<button onclick="fpFeedbackReason('${r.k}',${channelId})"
        style="padding:8px 14px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface);cursor:pointer;font-size:14px;font-family:inherit;color:var(--text)"
        >${r.label}</button>`).join("")}
    </div>`;
}

function fpFeedbackReason(reason, channelId){
  logProductEvent("first_post_feedback_reason", reason);
  const fb=$("fp_feedback_block");
  if(fb) fb.innerHTML=`<p style="color:var(--text-dim);font-size:14px">Понял, спасибо. Попробуйте ещё вариант или уточните тему.</p>`;
  // Показываем кнопку подключения канала — пользователь может продолжить несмотря на недовольство
  const actions=$("fp_actions");
  if(actions) actions.style.display="block";
}

async function qsRegenerate(channelId){
  const btn=$("fp_regen_btn");
  btn.innerHTML='<span class="spinner"></span>';btn.disabled=true;
  try{
    const post=await api("POST",`/channels/${channelId}/generate`,{});
    renderFirstPostResult(channelId, post);
  }catch(e){
    toast(e&&e.message?e.message:"Ошибка запроса","err");
    btn.innerHTML="Ещё вариант";btn.disabled=false;
  }
}

async function qsRewrite(channelId, mode){
  // "Сократить"/"Сделать живее" — переиспользуем тот же /generate с уточнённой
  // темой, без отдельного эндпоинта переписывания (см. задачу: не расширять
  // функциональность). Это не идеальная правка существующего текста, а новая
  // генерация с явной инструкцией по стилю — для onboarding этого достаточно.
  const btnId = mode==="короче" ? "fp_short_btn" : "fp_live_btn";
  const btn=$(btnId);
  if(btn){btn.innerHTML='<span class="spinner"></span>';btn.disabled=true;}
  const hint = mode==="короче"
    ? `${App._qsAbout}. Сделай короче и проще — максимум 2 коротких абзаца.`
    : `${App._qsAbout}. Сделай живее и разговорнее, добавь конкретную деталь.`;
  try{
    const post=await api("POST",`/channels/${channelId}/generate`,{topic:hint});
    renderFirstPostResult(channelId, post);
  }catch(e){
    toast(e&&e.message?e.message:"Ошибка запроса","err");
    if(btn){btn.innerHTML=mode==="короче"?"Сократить":"Сделать живее";btn.disabled=false;}
  }
}

function qsEdit(channelId, postId){
  // Редактирование первого поста — ведём в карточку канала, вкладка Очередь,
  // там уже есть полноценный редактор поста. Не дублируем эту логику здесь.
  go("channel", channelId);
}

// CONNECT CHANNEL — второй шаг онбординга: подключение publishing bot
async function renderConnectChannel(){
  let c;
  try{c=await api("GET","/channels/"+App.channelId);}
  catch(e){toast(e&&e.message?e.message:"Ошибка запроса","err");return go("dashboard");}
  if(!$("app")) return;
  App._chan=c;
  const botUsername=App.cfg?.bot_username||"Trpst_bot";

  trackGoal("connect_channel_started",{channel_id:c.id});

  $("app").innerHTML=`<div class="wrap" style="max-width:560px">
    <button class="back-link" style="margin-top:12px" onclick="go('channel',${c.id})">← Назад</button>
    <div class="page-head" style="text-align:center;margin-top:8px">
      <h1 style="font-family:'Instrument Serif',serif;font-size:26px;font-weight:400">Подключите Telegram-канал</h1>
      <p style="color:var(--text-dim)">Чтобы АвтоПост мог публиковать посты, добавьте бота-публикатора администратором канала.</p>
    </div>

    <div class="card" style="text-align:center;padding:24px">
      <div style="font-size:13px;color:var(--text-faint);margin-bottom:6px">Бот для публикации</div>
      <div id="cc_bot_name" style="font-family:'JetBrains Mono',monospace;font-size:22px;font-weight:600;color:var(--accent);margin-bottom:14px">@${esc(botUsername)}</div>
      <button class="btn-outline btn-sm" onclick="ccCopyBot('${esc(botUsername)}')" id="cc_copy_btn">📋 Скопировать @${esc(botUsername)}</button>
    </div>

    <div class="hint" style="margin-top:14px;line-height:1.7">
      1. Открой канал → Управление → Администраторы<br>
      2. Добавь <b>@${esc(botUsername)}</b><br>
      3. Включи право «Публиковать сообщения»
    </div>

    <label class="field mt"><span class="field-label">@username канала или ссылка t.me/</span>
      <div class="row" style="gap:8px">
        <input id="cc_chat" value="${esc(c.tg_chat||"")}" placeholder="@my_channel или https://t.me/channel" style="flex:1">
      </div>
    </label>
    <div id="cc_msg" style="font-size:13px;margin-top:6px;min-height:18px"></div>

    <button class="btn" style="width:100%;justify-content:center;margin-top:12px;padding:14px"
      onclick="ccVerify()" id="cc_verify_btn">Проверить подключение</button>

    <button class="btn-ghost btn-sm" style="width:100%;justify-content:center;margin-top:10px;color:var(--text-faint)"
      onclick="go('channel',${c.id})">Подключу позже →</button>
  </div>`;
}

function ccCopyBot(username){
  const text="@"+username;
  if(navigator.clipboard?.writeText){
    navigator.clipboard.writeText(text).then(()=>toast("Скопировано","ok")).catch(()=>{});
  }
  const btn=$("cc_copy_btn");
  if(btn){const orig=btn.textContent;btn.textContent="✓ Скопировано";setTimeout(()=>{btn.textContent=orig;},1500);}
}

// Универсальная обёртка с реальным таймаутом (не просто текст-подсказка) —
// если промис не резолвится за timeoutMs, кнопка гарантированно
// разблокируется с понятным сообщением, вместо вечного spinner (task: "Fix
// loading / stuck button").
function withTimeout(promise, timeoutMs, timeoutMessage){
  let timedOut=false;
  const timeout=new Promise((_,reject)=>{
    setTimeout(()=>{timedOut=true;reject(new Error(timeoutMessage));},timeoutMs);
  });
  return Promise.race([promise, timeout]).then(
    result=>({timedOut:false, result}),
    err=>{ if(timedOut) return {timedOut:true, error:err}; throw err; }
  );
}