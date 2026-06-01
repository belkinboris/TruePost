@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400&family=Manrope:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

:root {
  --ink: #0b0c0f;
  --panel: #14161c;
  --panel-2: #1b1e26;
  --line: #262a33;
  --line-soft: #1e222a;
  --text: #e9e6df;
  --text-dim: #8d8f98;
  --text-faint: #5a5d68;
  --gold: #d8b15e;
  --gold-soft: #3a2f17;
  --green: #6fcf97;
  --green-bg: #112b1c;
  --red: #e07a6b;
  --red-bg: #2c1512;
  --blue: #7aa2d6;
  --radius: 14px;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: var(--ink);
  color: var(--text);
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  background-image:
    radial-gradient(900px 500px at 85% -10%, rgba(216,177,94,0.06), transparent),
    radial-gradient(700px 400px at -10% 10%, rgba(122,162,214,0.04), transparent);
  background-attachment: fixed;
  min-height: 100vh;
}

::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #2a2e38; border-radius: 8px; }

.serif { font-family: 'Fraunces', serif; }
.mono { font-family: 'JetBrains Mono', monospace; }

.label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-faint);
}

a { color: var(--gold); }

/* ── Buttons ────────────────────────────────── */
button {
  font-family: 'Manrope', sans-serif;
  cursor: pointer;
  border: none;
  border-radius: 10px;
  font-weight: 600;
  font-size: 14px;
  transition: all 0.15s ease;
}
.btn {
  padding: 10px 18px;
  background: var(--gold);
  color: #1a1404;
}
.btn:hover { filter: brightness(1.08); transform: translateY(-1px); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
.btn-ghost {
  padding: 9px 16px;
  background: transparent;
  border: 1px solid var(--line);
  color: var(--text-dim);
}
.btn-ghost:hover { border-color: var(--gold); color: var(--text); }
.btn-sm { padding: 6px 12px; font-size: 12.5px; border-radius: 8px; }
.btn-green { background: var(--green); color: #06210f; }
.btn-danger { background: transparent; border: 1px solid var(--red-bg); color: var(--red); }
.btn-danger:hover { background: var(--red-bg); }

/* ── Inputs ─────────────────────────────────── */
input, textarea, select {
  width: 100%;
  background: var(--ink);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 11px 14px;
  color: var(--text);
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s;
}
input:focus, textarea:focus, select:focus { border-color: var(--gold); }
textarea { resize: vertical; min-height: 90px; line-height: 1.6; }
label.field { display: block; margin-bottom: 18px; }
label.field > .label { display: block; margin-bottom: 7px; }
.hint { font-size: 12px; color: var(--text-faint); margin-top: 6px; }

/* ── Layout ─────────────────────────────────── */
.topbar {
  position: sticky; top: 0; z-index: 50;
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 32px;
  background: rgba(11,12,15,0.85);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--line-soft);
}
.brand { display: flex; align-items: baseline; gap: 10px; }
.brand .logo { font-family: 'Fraunces', serif; font-size: 24px; font-weight: 600; letter-spacing: -0.02em; }
.brand .logo b { color: var(--gold); }
.brand .tag { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--text-faint); letter-spacing: 0.15em; }

.balance-pill {
  display: flex; align-items: center; gap: 10px;
  background: var(--panel); border: 1px solid var(--line);
  padding: 7px 14px; border-radius: 99px;
}
.balance-pill .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--green); box-shadow: 0 0 8px var(--green); }
.balance-pill.low .dot { background: var(--red); box-shadow: 0 0 8px var(--red); }
.balance-pill .num { font-family: 'JetBrains Mono', monospace; font-weight: 500; }

.wrap { max-width: 1080px; margin: 0 auto; padding: 32px; }

.page-head { margin-bottom: 28px; }
.page-head h1 { font-family: 'Fraunces', serif; font-size: 34px; font-weight: 500; letter-spacing: -0.02em; line-height: 1.1; }
.page-head p { color: var(--text-dim); margin-top: 6px; }

/* ── Cards ──────────────────────────────────── */
.card {
  background: var(--panel);
  border: 1px solid var(--line-soft);
  border-radius: var(--radius);
  padding: 24px;
}
.card + .card { margin-top: 16px; }
.card-title { font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-faint); margin-bottom: 18px; }

.grid { display: grid; gap: 16px; }
.grid-2 { grid-template-columns: repeat(2, 1fr); }
.grid-3 { grid-template-columns: repeat(3, 1fr); }
.grid-4 { grid-template-columns: repeat(4, 1fr); }
@media (max-width: 820px) { .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr; } }

/* channel card */
.chan-card {
  background: var(--panel); border: 1px solid var(--line-soft);
  border-radius: var(--radius); padding: 22px; cursor: pointer;
  transition: all 0.18s; position: relative; overflow: hidden;
}
.chan-card:hover { border-color: var(--gold); transform: translateY(-2px); }
.chan-card h3 { font-family: 'Fraunces', serif; font-size: 21px; font-weight: 500; margin-bottom: 4px; }
.chan-card .meta { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-faint); }
.chan-card .about { color: var(--text-dim); font-size: 13px; margin-top: 12px; min-height: 38px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.chan-card .foot { display: flex; gap: 8px; margin-top: 16px; align-items: center; flex-wrap: wrap; }

.chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 99px; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; letter-spacing: 0.04em; }
.chip-ok { background: var(--green-bg); color: var(--green); }
.chip-warn { background: var(--gold-soft); color: var(--gold); }
.chip-off { background: #20242c; color: var(--text-faint); }
.chip-blue { background: #14233a; color: var(--blue); }

.dashed-card {
  border: 1.5px dashed var(--line); background: transparent; border-radius: var(--radius);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 22px; min-height: 170px; cursor: pointer; color: var(--text-faint); transition: all 0.18s;
}
.dashed-card:hover { border-color: var(--gold); color: var(--gold); }
.dashed-card .plus { font-size: 34px; font-weight: 300; line-height: 1; margin-bottom: 8px; font-family: 'Fraunces', serif; }

/* ── Tabs ───────────────────────────────────── */
.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line-soft); margin-bottom: 24px; flex-wrap: wrap; }
.tab { padding: 10px 16px; background: transparent; color: var(--text-faint); border-radius: 0; border-bottom: 2px solid transparent; font-size: 14px; }
.tab.active { color: var(--text); border-bottom-color: var(--gold); }
.tab:hover { color: var(--text-dim); }

/* ── Posts ──────────────────────────────────── */
.post {
  background: var(--panel); border: 1px solid var(--line-soft);
  border-radius: var(--radius); padding: 20px; margin-bottom: 14px;
}
.post .ph { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.post-text {
  background: var(--ink); border: 1px solid var(--line-soft); border-radius: 10px;
  padding: 14px 16px; white-space: pre-wrap; line-height: 1.7; font-size: 14px; color: #d6d3cc;
}
.post-actions { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; align-items: center; }
.tg-preview { display: flex; gap: 10px; }
.tg-avatar { width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, var(--gold), #8a6d2a); flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; font-weight: 700; color: #1a1404; }

/* ── Source rows ────────────────────────────── */
.src-row { display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 11px 14px; background: var(--ink); border: 1px solid var(--line-soft); border-radius: 10px; margin-bottom: 8px; }
.src-row .url { font-family: 'JetBrains Mono', monospace; font-size: 12.5px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── Toggle ─────────────────────────────────── */
.toggle { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; }
.toggle .track { width: 42px; height: 24px; border-radius: 99px; background: #2a2e38; position: relative; transition: 0.18s; flex-shrink: 0; }
.toggle .track .knob { width: 18px; height: 18px; border-radius: 50%; background: #777; position: absolute; top: 3px; left: 3px; transition: 0.18s; }
.toggle.on .track { background: var(--gold-soft); }
.toggle.on .track .knob { left: 21px; background: var(--gold); }

/* ── Pricing ────────────────────────────────── */
.price-card { background: var(--panel); border: 1px solid var(--line-soft); border-radius: var(--radius); padding: 24px; text-align: center; transition: all 0.18s; }
.price-card:hover { border-color: var(--gold); transform: translateY(-3px); }
.price-card .pname { font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-faint); }
.price-card .prub { font-family: 'Fraunces', serif; font-size: 38px; font-weight: 500; margin: 10px 0 2px; }
.price-card .ptok { color: var(--text-dim); font-size: 13px; margin-bottom: 18px; }

/* ── Auth ───────────────────────────────────── */
.auth-screen { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
.auth-box { width: 100%; max-width: 400px; }
.auth-box .logo-big { font-family: 'Fraunces', serif; font-size: 42px; font-weight: 600; text-align: center; letter-spacing: -0.02em; margin-bottom: 4px; }
.auth-box .logo-big b { color: var(--gold); }
.auth-box .sub { text-align: center; color: var(--text-dim); margin-bottom: 28px; font-size: 14px; }
.auth-switch { text-align: center; margin-top: 18px; font-size: 13px; color: var(--text-faint); }
.auth-switch a { cursor: pointer; }

/* ── Misc ───────────────────────────────────── */
.toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 999;
  background: var(--panel-2); border: 1px solid var(--line); color: var(--text);
  padding: 12px 20px; border-radius: 12px; font-size: 14px; box-shadow: 0 10px 40px rgba(0,0,0,0.5);
  animation: rise 0.25s ease; max-width: 90vw; }
.toast.err { border-color: var(--red-bg); color: var(--red); }
.toast.ok { border-color: var(--green-bg); color: var(--green); }
@keyframes rise { from { opacity: 0; transform: translate(-50%, 12px); } to { opacity: 1; transform: translate(-50%, 0); } }

.empty { text-align: center; padding: 50px 20px; color: var(--text-faint); }
.empty .big { font-family: 'Fraunces', serif; font-size: 22px; color: var(--text-dim); margin-bottom: 6px; }

.spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; vertical-align: -2px; }
@keyframes spin { to { transform: rotate(360deg); } }

.row { display: flex; align-items: center; gap: 12px; }
.between { justify-content: space-between; }
.muted { color: var(--text-dim); }
.faint { color: var(--text-faint); }
.mt { margin-top: 16px; } .mt-lg { margin-top: 28px; }
.back { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-faint); cursor: pointer; display: inline-flex; gap: 6px; margin-bottom: 16px; }
.back:hover { color: var(--gold); }
.seg { display: inline-flex; gap: 6px; flex-wrap: wrap; }
.seg button { padding: 8px 14px; background: transparent; border: 1px solid var(--line); color: var(--text-faint); border-radius: 9px; font-size: 13px; }
.seg button.on { background: var(--gold); color: #1a1404; border-color: var(--gold); }
.hidden { display: none !important; }
