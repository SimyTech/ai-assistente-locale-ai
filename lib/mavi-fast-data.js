import { parseLocalAgendaPeriod } from "./mavi-local-date.js";
import { analyzeLocalIntent } from "./mavi-local-intent.js";

const normalize = value => String(value || "")
  .toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const isoLocal = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
const activeAppointment = item => !["cancelled","no_show"].includes(item?.status || "confirmed");
const has = (text, pattern) => pattern.test(text);
const readIntent = text => !has(text, /(prenot|fissa|sposta|rimanda|annulla appunt|cancella appunt|modifica|crea|aggiung|elimina|invia|manda)/);

function agendaTimeWindow(text) {
  if (/\b(mattina|mattino)\b/.test(text)) return { from:0, to:13*60 };
  if (/\bpomeriggio\b/.test(text)) return { from:13*60, to:18*60 };
  if (/\b(sera|serale)\b/.test(text)) return { from:18*60, to:24*60 };
  return null;
}
function requestedStatus(text) {
  if (/\b(cancellat|annullat)\w*\b/.test(text)) return "cancelled";
  if (/\b(completat|conclus)\w*\b/.test(text)) return "completed";
  if (/\b(no show|assent)\w*\b/.test(text)) return "no_show";
  if (/\b(confermat)\w*\b/.test(text)) return "confirmed";
  return "";
}
function minutesOf(item) { const m=String(item?.time||"").match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1])*60+Number(m[2]) : null; }
function namedFilter(text, values=[]) {
  return values.map(value => ({ raw:String(value||"").trim(), key:normalize(value) }))
    .filter(item => item.key.length >= 2 && text.includes(item.key))
    .sort((a,b)=>b.key.length-a.key.length)[0]?.raw || "";
}
function agendaEntityFilters(text, data) {
  const clientNames = [
    ...(data.clients || []).map(item => item?.name),
    ...(data.appointments || []).map(item => item?.name)
  ];
  const serviceNames = [
    ...(data.services || []).map(item => item?.name),
    ...(data.appointments || []).map(item => item?.service)
  ];
  return { client:namedFilter(text, clientNames), service:namedFilter(text, serviceNames) };
}
function asksForDaySchedule(text) {
  const day=Boolean(parseLocalAgendaPeriod(text));
  const schedule=has(text, /(programm|agenda|appuntament|impegn|giornata|chi (?:vedo|viene|ho)|come sono messo)/);
  const duties=has(text, /(?:cosa|che).*(?:ho|devo).*(?:fare|gestire)|(?:cosa|che) faccio/);
  const colloquial=has(text, /(?:cosa|che) (?:si fa|facciamo|c e da fare|mi aspetta|ci aspetta|abbiamo)|(?:cos|cosa|che) (?:ho|c e) (?:oggi|domani)|(?:oggi|domani).*(?:che si fa|cosa si fa|che facciamo|cosa facciamo|che c e|cosa c e|che mi aspetta|che abbiamo|come va|situazione)|^(?:oggi|domani)$/);
  return day && readIntent(text) && (schedule||duties||colloquial);
}
function todayPlanAnswer(message,data,now) {
  const text=normalize(message); const entities=agendaEntityFilters(text,data);
  if (agendaTimeWindow(text)||requestedStatus(text)||entities.client||entities.service) return null;
  if (!(has(text,/\boggi\b/)&&asksForDaySchedule(text))) return null;
  const today=isoLocal(now); const tomorrowDate=new Date(now); tomorrowDate.setDate(tomorrowDate.getDate()+1); const tomorrow=isoLocal(tomorrowDate); const currentMoment=now.getTime();
  const appointments=Array.isArray(data.appointments)?data.appointments:[];
  const todayItems=appointments.filter(i=>(i.status||"confirmed")==="confirmed"&&i.date===today).sort((a,b)=>String(a.time||"").localeCompare(String(b.time||"")));
  const reminders=appointments.filter(i=>(i.status||"confirmed")==="confirmed"&&i.date===tomorrow&&!i.reminderSentAt);
  const overdue=appointments.filter(i=>{if((i.status||"confirmed")!=="confirmed"||!i.date||!i.time)return false;const moment=new Date(`${i.date}T${i.time}:00`).getTime();return Number.isFinite(moment)&&moment<currentMoment;});
  const lines=["Programma di oggi:"];
  if(todayItems.length)lines.push(...todayItems.map(i=>`${i.time||"--:--"} — ${i.name||"Cliente"}${i.service?` — ${i.service}`:""}`));else lines.push("Nessun appuntamento confermato.");
  lines.push("","Azioni da gestire:"); if(!reminders.length&&!overdue.length)lines.push("Nessuna azione urgente."); if(reminders.length)lines.push(`• Promemoria da inviare per domani: ${reminders.length}`); if(overdue.length)lines.push(`• Appuntamenti passati da chiudere: ${overdue.length}`); return lines.join("\n");
}
function appointmentAnswer(message,data,now,forced=false) {
  const text=normalize(message); const period=parseLocalAgendaPeriod(text,now);
  const entities=agendaEntityFilters(text,data);
  const scheduleWords=/(programm|agenda|appuntament|impegn|giornata|recap|riepilog|chi (?:vedo|viene|ho)|come sono messo|che si fa|che facciamo|cosa c e|mattina|pomeriggio|sera|cancellat|annullat|completat|no show|assent)/.test(text) || entities.client || entities.service;
  if(!period||!readIntent(text)||(!forced&&!scheduleWords))return null;
  const timeWindow=agendaTimeWindow(text); const statusFilter=requestedStatus(text);
  const clientKey=normalize(entities.client); const serviceKey=normalize(entities.service);
  const items=(data.appointments||[])
    .filter(i=>i.date>=period.start&&i.date<=period.end)
    .filter(i=>statusFilter?(i.status||"confirmed")===statusFilter:(period.end<isoLocal(now)||activeAppointment(i)))
    .filter(i=>!clientKey||normalize(i.name)===clientKey)
    .filter(i=>!serviceKey||normalize(i.service)===serviceKey)
    .filter(i=>{if(!timeWindow)return true;const m=minutesOf(i);return m!==null&&m>=timeWindow.from&&m<timeWindow.to;})
    .sort((a,b)=>`${a.date||""}${a.time||""}`.localeCompare(`${b.date||""}${b.time||""}`));
  const filters=[timeWindow?"fascia richiesta":"",statusFilter?`stato ${statusFilter}`:"",entities.client?`cliente ${entities.client}`:"",entities.service?`servizio ${entities.service}`:""].filter(Boolean).join(", ");
  if(!items.length)return `Non risultano appuntamenti per ${period.label}${filters?` con ${filters}`:""}.`;
  const status=i=>i.status==="completed"?" — completato":i.status==="no_show"?" — assente":i.status==="cancelled"?" — annullato":"";
  const rows=items.slice(0,40).map(i=>`${period.kind==="day"?"":`${i.date} · `}${i.time||"--:--"} — ${i.name||"Cliente"}${i.service?` — ${i.service}`:""}${status(i)}`);
  const more=items.length>rows.length?`\n…e altri ${items.length-rows.length} appuntamenti.`:""; return `Per ${period.label} risultano ${items.length} ${items.length===1?"appuntamento":"appuntamenti"}${filters?` (${filters})`:""}:\n${rows.join("\n")}${more}`;
}
function servicesAnswer(message,data,forced=false){const text=normalize(message);if(!readIntent(text)||(!forced&&!/(serviz|trattament|prezz|cost|tariff|listino|cosa (?:offro|propongo)|quanto (?:faccio pagare|costa))/.test(text)))return null;const services=Array.isArray(data.services)?data.services:[];if(!services.length)return"Non risultano servizi configurati.";return`Servizi configurati:\n${services.map(s=>`${s.name||"Servizio"}${Number.isFinite(Number(s.price))?` — €${Number(s.price).toFixed(2)}`:""}${s.duration?` — ${s.duration} min`:""}`).join("\n")}`;}
function clientsAnswer(message,data,forced=false){const text=normalize(message);if(!readIntent(text)||(!forced&&!/(quanti (?:client|contatt|person)|numero (?:client|contatt)|elenco (?:client|contatt)|lista (?:client|contatt)|rubrica)/.test(text)))return null;const clients=Array.isArray(data.clients)?data.clients:[];if(/elenco|lista/.test(text)&&clients.length)return`Hai ${clients.length} clienti:\n${clients.map(c=>c.name||"Cliente").join("\n")}`;return`Hai ${clients.length} ${clients.length===1?"cliente":"clienti"} in archivio.`;}
function promotionsAnswer(message,data,forced=false){const text=normalize(message);if(!readIntent(text)||(!forced&&!/(promozion|promo|offert|scont|iniziativ.*attiv)/.test(text)))return null;const promotions=Array.isArray(data.promotions)?data.promotions:[];if(!promotions.length)return"Non risultano promozioni attive configurate.";return`Promozioni configurate:\n${promotions.map(i=>`${i.title||"Promozione"}${i.valid?` — ${i.valid}`:""}`).join("\n")}`;}
function hoursAnswer(message,data,forced=false){const text=normalize(message);if(!readIntent(text)||(!forced&&!/(orar|quando (?:apro|apriamo|chiudo|chiudiamo)|giorni? (?:apert|chius)|a che ora)/.test(text)))return null;const hours=Array.isArray(data.settings?.hours)?data.settings.hours:[];if(!hours.length)return"Non risultano orari configurati.";return`Orari configurati:\n${hours.map((i,x)=>{const name=i.name||["Lunedì","Martedì","Mercoledì","Giovedì","Venerdì","Sabato","Domenica"][x]||"Giorno";if(i.closed)return`${name} — Chiuso`;return`${name} — ${i.open||"--:--"}–${i.close||"--:--"}`;}).join("\n")}`;}
function businessAnswer(message,data,forcedIntent=""){const text=normalize(message);const business=data.business||{};if(!readIntent(text))return null;if(forcedIntent==="address"||/(dove (?:siamo|siete)|qual e l indirizzo|indirizzo dell attivita)/.test(text))return business.address?`L'indirizzo configurato è: ${business.address}.`:"Non risulta un indirizzo configurato.";if(forcedIntent==="contact"||/(numero di telefono|telefono dell attivita|contatto dell attivita|numero whatsapp)/.test(text)){const contact=business.whatsapp||business.phone;return contact?`Il contatto configurato è: ${contact}.`:"Non risulta un contatto configurato.";}return null;}
export function answerFastLocalData(message,data={},now=new Date()){const detected=analyzeLocalIntent(message);const semantic=detected.intent==="agenda"?appointmentAnswer(message,data,now,true):detected.intent==="services"?servicesAnswer(message,data,true):detected.intent==="clients"?clientsAnswer(message,data,true):detected.intent==="promotions"?promotionsAnswer(message,data,true):detected.intent==="hours"?hoursAnswer(message,data,true):["address","contact"].includes(detected.intent)?businessAnswer(message,data,detected.intent):null;const answer=todayPlanAnswer(message,data,now)||semantic||appointmentAnswer(message,data,now)||hoursAnswer(message,data)||businessAnswer(message,data)||clientsAnswer(message,data)||servicesAnswer(message,data)||promotionsAnswer(message,data);return answer?{handled:true,answer}:{handled:false,answer:""};}
