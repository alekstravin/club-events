"use strict";
const byId = id => document.getElementById(id);
const dateFormat = new Intl.DateTimeFormat("ru-RU", {day:"numeric",month:"long",year:"numeric",timeZone:"Europe/Moscow"});
const timeFormat = new Intl.DateTimeFormat("ru-RU", {hour:"2-digit",minute:"2-digit",timeZone:"Europe/Moscow"});
let events = [], selected = null, intent = null, sending = false, refreshing = false, preparing = false;
const form = byId("registration-form");
const button = byId("register-button");

async function api(path, options={}) {
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(), 20000);
  try {
    const response = await fetch(CLUB_GATEWAY+path, {...options, credentials:"omit", cache:"no-store", signal:controller.signal});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось получить ответ сервера.");
    return data;
  } catch (error) {
    if (error instanceof TypeError || error instanceof SyntaxError || error.name === "AbortError") throw new Error("Не удалось получить ответ сервера. Попробуйте снова: повторная отправка не создаст вторую запись.");
    throw error;
  } finally {clearTimeout(timeout);}
}

function showConnectionError(message) {
  byId("connection-message").textContent = message;
  byId("connection-error").hidden = false;
}

function eventLink(event) {
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("event", event.id);
  return url.pathname+url.search;
}

function renderList() {
  byId("events-total").textContent = events.length+" "+(events.length===1?"событие":"событий");
  const container = byId("events-container");
  container.replaceChildren();
  if (!events.length) {
    const state = document.createElement("div"); state.className="empty-state";
    const title = document.createElement("h3"); title.textContent="Скоро встретимся";
    const text = document.createElement("p"); text.textContent="Организатор ещё не опубликовал новое заседание. Анонс появится здесь и в каналах Клуба.";
    state.append(title,text); container.append(state); return;
  }
  for (const event of events) {
    const card = byId("event-card-template").content.cloneNode(true);
    card.querySelector(".availability").textContent = event.can_register?`${event.remaining} из ${event.capacity} мест свободно`:"Регистрация закрыта";
    card.querySelector(".event-date").textContent = dateFormat.format(new Date(event.start_at))+" · "+timeFormat.format(new Date(event.start_at))+" мск";
    const links = card.querySelectorAll(".event-link");
    for (const link of links) link.href=eventLink(event);
    links[0].textContent=event.title;
    links[1].textContent=(event.can_register?"Зарегистрироваться":"Открыть событие")+" ↗";
    links[1].classList.toggle("secondary",!event.can_register);
    card.querySelector(".location").textContent="↳ "+event.location;
    card.querySelector(".card-description").textContent=event.description.length>200?event.description.slice(0,200)+"…":event.description;
    container.append(card);
  }
}

function updateButton() {
  button.disabled=sending || !selected || !selected.can_register || !intent;
  button.textContent=sending?"Сохраняем регистрацию…":!selected?.can_register?"Регистрация закрыта":intent?"Зарегистрироваться ↗":"Подготавливаем форму…";
}

async function prepareIntent() {
  if (!selected || !selected.can_register || preparing || intent) return;
  const eventId = selected.id;
  preparing=true;
  try {
    const proof=await api(`/api/events/${eventId}/mirror-intent`);
    if (selected?.id===eventId) intent=proof;
  } catch(error) {showConnectionError(error.message);}
  finally {preparing=false;updateButton();}
}

function renderSelection() {
  const reference = new URLSearchParams(location.search).get("event");
  const event = events.find(item=>item.id===reference || item.slug===reference) || null;
  if (selected?.id!==event?.id) {selected=event;intent=null;form.reset();byId("registration-error").hidden=true;}
  else selected=event;
  byId("list-heading").hidden=Boolean(reference);
  byId("events-view").hidden=Boolean(reference);
  byId("back-link").hidden=!reference;
  byId("registration-view").hidden=!event;
  if (reference && !event) {showConnectionError("Это событие уже завершилось или было удалено. Вернитесь к списку заседаний.");return;}
  if (!event) {document.title="Заседания · Клуб ИИИИ";return;}
  document.title=event.title+" · Клуб ИИИИ";
  byId("event-title").textContent=event.title;
  byId("event-date").textContent=dateFormat.format(new Date(event.start_at));
  byId("event-time").textContent=timeFormat.format(new Date(event.start_at))+" · московское время";
  byId("event-location").textContent=event.location;
  byId("event-description").textContent=event.description;
  byId("event-description").hidden=!event.description;
  byId("event-remaining").textContent=event.remaining;
  byId("event-capacity").textContent=event.capacity;
  byId("seat-progress").max=event.capacity;
  byId("seat-progress").value=event.remaining;
  form.hidden=!event.can_register;
  byId("closed-note").hidden=event.can_register;
  byId("closed-heading").textContent=event.remaining===0?"Все места заняты":"Регистрация закрыта";
  updateButton();
  void prepareIntent();
}

async function refresh() {
  if (refreshing || document.hidden || sending) return;
  refreshing=true;
  try {
    const data=await api("/api/events");
    const changed=JSON.stringify(events)!==JSON.stringify(data.events);
    events=data.events;
    byId("connection-error").hidden=true;
    if (changed || !byId("events-container").querySelector(".event-card")) renderList();
    renderSelection();
  } catch(error) {showConnectionError(error.message);}
  finally {refreshing=false;}
}

form.addEventListener("submit", async event=>{
  event.preventDefault();
  if (sending || !selected || !intent || !form.reportValidity()) return;
  const eventId=selected.id;
  const data=new FormData(form);
  const payload={full_name:data.get("full_name"),organization:data.get("organization"),needs_pass:data.has("needs_pass"),consent:data.has("consent"),website:data.get("website"),request_key:intent.request_key};
  sending=true;updateButton();byId("registration-error").hidden=true;
  try {
    const result=await api(`/api/events/${eventId}/register`,{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":intent.csrf_token},body:JSON.stringify(payload)});
    const confirmation=new URL(result.confirmation_url,CLUB_GATEWAY);
    if (confirmation.origin!==CLUB_GATEWAY || !confirmation.pathname.startsWith("/confirmation/")) throw new Error("Не удалось открыть подтверждение. Повторите отправку заявки.");
    location.assign(confirmation.href);
  } catch(error) {byId("registration-error").textContent=error.message;byId("registration-error").hidden=false;sending=false;updateButton();void refresh();}
});
byId("retry-connection").addEventListener("click",()=>void refresh());
document.addEventListener("visibilitychange",()=>void refresh());
setInterval(()=>void refresh(),8000);
void refresh();
