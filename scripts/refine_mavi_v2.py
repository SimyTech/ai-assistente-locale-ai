from pathlib import Path

path = Path("index.html")
text = path.read_text(encoding="utf-8")

css_start = text.index("#mavi .chat{overflow:hidden")
css_end = text.index("\n\n</style>", css_start)

new_css = r'''#mavi .chat{height:auto;min-height:720px;overflow:hidden;padding:0;background:linear-gradient(180deg,rgba(10,28,61,.96),rgba(5,17,40,.99));border-color:rgba(86,129,255,.2)}
.mavi-stage{position:relative;display:flex;flex-direction:column;align-items:center;text-align:center;padding:48px 24px 30px;overflow:hidden;background:radial-gradient(circle at 50% 30%,rgba(70,88,255,.22),transparent 29%),radial-gradient(circle at 82% 52%,rgba(26,221,185,.09),transparent 28%)}
.mavi-stage::before{content:'';position:absolute;inset:25% -14% auto;height:190px;background:linear-gradient(92deg,transparent,rgba(56,167,255,.12),rgba(135,92,255,.3),rgba(57,217,138,.14),transparent);filter:blur(36px);opacity:.72;transform:rotate(-3deg);pointer-events:none}
.mavi-model-line{position:absolute;right:20px;top:18px;z-index:2}
.mavi-orb{position:relative;z-index:1;width:154px;height:154px;border-radius:50%;display:grid;place-items:center;padding:4px;background:linear-gradient(135deg,#38a7ff,#875cff 52%,#39d98a);box-shadow:0 0 0 1px rgba(255,255,255,.08),0 0 38px rgba(56,167,255,.28),0 0 70px rgba(135,92,255,.18)}
.mavi-orb-inner{width:100%;height:100%;border-radius:50%;display:grid;place-items:center;background:radial-gradient(circle at 50% 35%,#0b2047,#06132d 72%);box-shadow:inset 0 0 34px rgba(56,167,255,.12)}
.mavi-hero-logo{width:94px;height:94px;object-fit:cover;border-radius:23px;display:block}
.mavi-name{position:relative;z-index:1;margin:17px 0 0;font-size:clamp(42px,6vw,60px);line-height:1;font-weight:950;letter-spacing:-2.5px;background:linear-gradient(110deg,#28c7ff 0%,#477cff 25%,#9854ff 55%,#39d98a 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
.mavi-tagline{position:relative;z-index:1;margin:9px 0 0;color:#b6c5e3;font-size:clamp(15px,2vw,18px)}
.mavi-voice-wrap{position:relative;z-index:1;margin-top:25px;display:flex;flex-direction:column;align-items:center;gap:8px}
.mavi-voice{width:84px;height:84px;border-radius:50%!important;padding:0!important;font-size:32px!important;display:grid!important;place-items:center;border:2px solid rgba(255,255,255,.2)!important;background:linear-gradient(145deg,#189fff,#6b45ff 58%,#c34fff)!important;box-shadow:0 0 0 7px rgba(94,91,255,.08),0 0 34px rgba(72,109,255,.5);transition:transform .16s ease,box-shadow .16s ease}
.mavi-voice:hover{transform:translateY(-2px) scale(1.02);box-shadow:0 0 0 8px rgba(94,91,255,.1),0 0 42px rgba(75,119,255,.58)}
.mavi-voice:disabled{opacity:.45;filter:grayscale(.4)}
.mavi-voice-label{font-size:12px;color:#9eafd0}
#mavi .quick-prompts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;overflow:visible;padding:18px 20px 14px;border-top:1px solid rgba(255,255,255,.055);background:rgba(4,15,35,.2)}
#mavi .quick-prompts .prompt-chip{width:100%;min-height:50px;padding:10px 12px;border-radius:14px;background:rgba(10,30,66,.9);border:1px solid rgba(89,138,255,.2);color:#e8efff;box-shadow:none;text-align:center;white-space:normal;line-height:1.25}
#mavi .quick-prompts .prompt-chip:hover{border-color:rgba(76,171,255,.48);background:rgba(15,42,88,.95)}
.mavi-conversation{margin:0 20px 20px;padding:14px 16px 16px;border:1px solid rgba(255,255,255,.08);border-radius:18px;background:rgba(3,14,35,.56)}
.mavi-conversation .messages{min-height:150px;max-height:300px;padding:8px 2px 10px}
.mavi-conversation .chatbar{margin-top:8px;padding-top:8px;background:none}
.mavi-conversation .chatbar input{min-height:50px;border-radius:14px;background:#071a38}
@media(max-width:760px){body:has(#mavi.active) .main{padding-top:10px}body:has(#mavi.active) .top{min-height:50px;margin:-10px -18px 8px;padding:8px 14px 6px;align-items:center;background:linear-gradient(180deg,rgba(7,20,47,.99) 82%,transparent)}body:has(#mavi.active) .top>div:first-child{display:none}body:has(#mavi.active) .top-actions{width:100%;max-width:none;justify-content:flex-end}.save-pill{display:none}.activity-menu summary{font-size:12px;padding:0 11px;min-height:38px}#mavi .chat{min-height:calc(100dvh - 145px);border-radius:22px}.mavi-stage{padding:28px 14px 22px}.mavi-model-line{position:absolute;right:12px;top:12px}.mavi-orb{width:132px;height:132px}.mavi-hero-logo{width:80px;height:80px}.mavi-name{font-size:44px;margin-top:14px}.mavi-tagline{font-size:15px}.mavi-voice-wrap{margin-top:20px}.mavi-voice{width:74px;height:74px;font-size:29px!important}#mavi .quick-prompts{display:flex;overflow-x:auto;gap:8px;padding:14px 12px 12px;scroll-snap-type:x proximity;scrollbar-width:none}#mavi .quick-prompts::-webkit-scrollbar{display:none}#mavi .quick-prompts .prompt-chip{flex:0 0 auto;width:auto;min-width:148px;min-height:44px;padding:9px 12px;white-space:nowrap;scroll-snap-align:start}.mavi-conversation{margin:0 10px 10px;padding:10px 11px 11px}.mavi-conversation .messages{min-height:120px;max-height:220px}.mavi-conversation .chatbar{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}.mavi-conversation .chatbar input{min-width:0}.mavi-conversation .chatbar .primary{min-width:66px}}
@media(max-width:430px){.activity-menu-panel{width:205px}.mavi-stage{padding-top:24px}.mavi-orb{width:118px;height:118px}.mavi-hero-logo{width:72px;height:72px}.mavi-name{font-size:40px}.mavi-tagline{font-size:14px}.mavi-voice{width:68px;height:68px;font-size:27px!important}#mavi .quick-prompts .prompt-chip{min-width:138px;font-size:12px}.mavi-conversation .bubble{max-width:96%;font-size:13px}}'''

text = text[:css_start] + new_css + text[css_end:]

mavi_start = text.index('<section class="page" id="mavi">')
calendar_start = text.index('<section class="page" id="calendar">', mavi_start)

new_mavi = '''<section class="page" id="mavi"><div class="card chat"><div class="mavi-stage"><div class="mavi-model-line"><span class="badge" id="maviModelBadge">MAVI FAST CORE</span></div><div class="mavi-orb"><div class="mavi-orb-inner"><img class="mavi-hero-logo" id="maviHeroLogo" alt="Mavi"></div></div><h2 class="mavi-name">Mavi</h2><p class="mavi-tagline">Il tuo assistente intelligente</p><div class="mavi-voice-wrap"><button class="btn mavi-voice" id="voice" aria-label="Parla con Mavi" title="Parla con Mavi">🎙</button><span class="mavi-voice-label">Tocca per parlare</span></div></div><div class="quick-prompts" aria-label="Azioni rapide di Mavi"><button class="prompt-chip" onclick="askMavi('Oggi che si fa?')">✦ Oggi che si fa?</button><button class="prompt-chip" onclick="askMavi('In questo mese?')">◫ In questo mese?</button><button class="prompt-chip" onclick="askMavi('Controlla la disponibilità')">🗓 Disponibilità</button><button class="prompt-chip" onclick="askMavi('Prenota un appuntamento')">＋ Prenota</button><button class="prompt-chip" onclick="askMavi('Mostra le promozioni')">◆ Promozioni</button><button class="prompt-chip" onclick="askMavi('Cerca un cliente')">👥 Cerca cliente</button><button class="prompt-chip" onclick="askMavi('Dimmi gli orari di apertura')">◷ Orari</button></div><div class="mavi-conversation"><div class="messages" id="messages"><div class="bubble mavi">Ciao, sono Mavi. Dimmi cosa vuoi fare: posso controllare agenda, clienti, servizi, promozioni e aiutarti a gestire gli appuntamenti.</div></div><div class="chatbar"><input id="maviInput" aria-label="Messaggio per Mavi" placeholder="Scrivi un messaggio a Mavi…" onkeydown="if(event.key==='Enter')sendMavi()"><button class="btn primary" onclick="sendMavi()">Invia</button></div></div></div></section>\n\n'''

text = text[:mavi_start] + new_mavi + text[calendar_start:]
path.write_text(text, encoding="utf-8")
