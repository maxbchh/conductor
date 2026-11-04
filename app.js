(() => {
'use strict';
const SUPABASE_URL='https://yycaxmfljqzfkjukplkz.supabase.co';
const SUPABASE_KEY='sb_publishable_Ur6yP5_7LQ-9DGmriBJIpw_zIWJiM7T';
const $=id=>document.getElementById(id);
const money=n=>Number(n||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' BYN';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=p=>p+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7);
let db={routes:[],vehicles:[],shifts:[],tickets:[],schedules:[],cards:[],cashShifts:[],news:[]},activeScheduleFolder=null,client=null,currentShift=null,currentCashShift=null,lastTicket=null,lastTickets=[],toastTimer,realtimeChannel=null,realtimeRefreshTimer=null,realtimeLoading=false,gameClockState=null,gameClockSaving=false;
const statusOptions=['В эксплуатации','На рейсе','Не в эксплуатации','Ремонт','Капитальный ремонт','Списан','Выведен из эксплуатации'];
function toast(s,type=''){const el=$('toast');el.textContent=s;el.className='toast show '+type;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3000)}
function setCloud(s,cls){$('cloudState').className='cloud-state '+cls;$('cloudState').innerHTML='<i></i> '+s}

function getGameClockMs(){
 if(!gameClockState)return Date.now();
 const base=Date.parse(gameClockState.base_time),updated=Date.parse(gameClockState.updated_at);
 if(!Number.isFinite(base))return Date.now();
 const elapsed=gameClockState.is_paused?0:Math.max(0,Date.now()-(Number.isFinite(updated)?updated:Date.now()))*Number(gameClockState.rate||1);
 return base+elapsed;
}
function formatGameTimeOnly(ms=getGameClockMs()){return new Date(ms).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}
function formatGameDateTime(ms=getGameClockMs()){return new Date(ms).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})}
function gameClockInputValue(ms){const d=new Date(ms),p=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds())}
function renderGameClock(){
 const ms=getGameClockMs(),d=new Date(ms),clock=$('gameClock'),date=$('gameDate'),paused=!!gameClockState?.is_paused,rate=Number(gameClockState?.rate||1);
 if(clock)clock.textContent=gameClockState?d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'--:--:--';
 if(date)date.textContent=gameClockState?d.toLocaleDateString('ru-RU',{day:'2-digit',month:'long',year:'numeric'}):'--.--.----';
 if($('gameClockLarge'))$('gameClockLarge').textContent=gameClockState?d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'--:--:--';
 if($('gameClockLargeDate'))$('gameClockLargeDate').textContent=gameClockState?d.toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long',year:'numeric'}):'Дата не загружена';
 if($('gameClockStatus'))$('gameClockStatus').textContent=!gameClockState?'Часы не загружены':paused?'Игровое время остановлено':'Игровое время идёт · '+rate+'×';
 if($('gameClockDot'))$('gameClockDot').classList.toggle('paused',paused);
 if($('gameClockPause'))$('gameClockPause').textContent=paused?'▶ Продолжить время':'Ⅱ Остановить время';
 if($('gameClockRate')&&document.activeElement!==$('gameClockRate'))$('gameClockRate').value=String(rate);
 if($('gameClockManual')&&$('gameClockManual').dataset.touched!=='1'&&gameClockState)$('gameClockManual').value=gameClockInputValue(ms);
 const ids=['gameClockPause','gameClockRate','gameClockBackHour','gameClockBack15','gameClockForward15','gameClockForwardHour','gameClockManual','gameClockSet'];
 ids.forEach(id=>{const el=$(id);if(el)el.disabled=!gameClockState||gameClockSaving});
 if(!currentShift&&$('tripGameTime')&&gameClockState&&document.activeElement!==$('tripGameTime'))$('tripGameTime').value=formatGameTimeOnly(ms);
}
async function persistGameClock(baseMs,rate,paused){
 if(!client||!gameClockState||gameClockSaving)return false;
 if(!Number.isFinite(baseMs)||!Number.isFinite(Number(rate))||Number(rate)<=0)return false;
 gameClockSaving=true;renderGameClock();
 try{
  const now=new Date().toISOString(),payload={id:'main',base_time:new Date(baseMs).toISOString(),updated_at:now,rate:Number(rate),is_paused:!!paused};
  const q=await client.from('conductor_game_clock').upsert(payload,{onConflict:'id'}).select().single();
  if(q.error)throw q.error;
  gameClockState=q.data;if($('gameClockManual'))$('gameClockManual').dataset.touched='0';return true;
 }catch(e){toast('Не удалось изменить игровое время: '+(e.message||String(e)),'error');return false}
 finally{gameClockSaving=false;renderGameClock()}
}
async function toggleGameClockPause(){if(!gameClockState)return;await persistGameClock(getGameClockMs(),gameClockState.rate,!gameClockState.is_paused)}
async function changeGameClockRate(value){if(!gameClockState)return;const rate=Number(value);if(![.25,.5,1,2,4,8,16].includes(rate)){toast('Недопустимая скорость игрового времени','error');renderGameClock();return}await persistGameClock(getGameClockMs(),rate,gameClockState.is_paused)}
async function jumpGameClock(minutes){if(!gameClockState)return;await persistGameClock(getGameClockMs()+minutes*60000,gameClockState.rate,gameClockState.is_paused)}
async function setGameClockManually(){if(!gameClockState)return;const value=$('gameClockManual').value,ms=Date.parse(value);if(!value||!Number.isFinite(ms)){toast('Укажи корректные дату и время','error');return}const ok=await persistGameClock(ms,gameClockState.rate,gameClockState.is_paused);if(ok)toast('Игровое время установлено','success')}

function showModal(html){$('modalContent').innerHTML=html;$('modalLayer').classList.add('open');$('modalLayer').setAttribute('aria-hidden','false')}
function closeModal(){$('modalLayer').classList.remove('open');$('modalLayer').setAttribute('aria-hidden','true')}
function activeRoute(){return db.routes.find(r=>r.id===$('saleRoute').value)||null}
function activeVehicle(){return currentShift?db.vehicles.find(v=>v.id===currentShift.vehicle_id):null}
function activeTripRoute(){return currentShift?db.routes.find(r=>r.id===currentShift.route_id):null}
function fillSelect(el,items,placeholder){el.innerHTML=placeholder?'<option value="">'+esc(placeholder)+'</option>':'';items.forEach(x=>{const o=document.createElement('option');o.value=x.value;o.textContent=x.label;el.appendChild(o)})}
function renderRouteSelects(){
 const routes=db.routes.filter(r=>r.city==='Тверь'&&!r.archived_at),opts=routes.map(r=>({value:r.id,label:r.name})),old=$('saleRoute').value;
 fillSelect($('saleRoute'),opts,'Выберите маршрут');fillSelect($('liveRoute'),opts,'Выбери маршрут');if(currentShift?.route_id&&routes.some(r=>r.id===currentShift.route_id))$('liveRoute').value=currentShift.route_id;
 const chosen=currentShift?(currentShift.route_id||''):old;if(chosen&&routes.some(r=>r.id===chosen))$('saleRoute').value=chosen;else if(currentShift)$('saleRoute').value='';
 updateSaleStops();renderVehicleSelect();renderInfo();if(currentShift)syncTripStops();
}
function updateSaleStops(){
 const r=activeRoute(),from=$('saleFrom'),to=$('saleTo'),oldFrom=from.value,oldTo=to.value,start=currentShift?Number(currentShift.current_stop_index||0):Math.max(0,Number(oldFrom||0));
 fillSelect(from,(r?.stops||[]).map((s,i)=>({value:String(i),label:s})), '');
 const end=currentShift&&currentShift.end_stop_index!=null?Number(currentShift.end_stop_index):((r?.stops?.length||1)-1);
 fillSelect(to,(r?.stops||[]).map((s,i)=>({value:String(i),label:s})).filter(x=>Number(x.value)>start&&Number(x.value)<=end), '');
 if(r&&start<r.stops.length)from.value=String(currentShift?start:(oldFrom!==''&&Number(oldFrom)<r.stops.length?oldFrom:'0'));
 if(r&&oldTo!==''&&Number(oldTo)>start)to.value=oldTo;
 from.disabled=!!currentShift;updateFare();
}
function updateFare(){
 const r=activeRoute(),a=Number($('saleFrom').value),b=Number($('saleTo').value),start=currentShift?Number(currentShift.current_stop_index||0):a,end=currentShift&&currentShift.end_stop_index!=null?Number(currentShift.end_stop_index):(r?.stops?.length||0)-1,valid=!!currentCashShift&&!!r&&!r.archived_at&&Number.isInteger(a)&&Number.isInteger(b)&&a===start&&b>a&&b<=end;
 const stops=valid?b-a:0,per=Number(r?.fare_per_stop||0),mult=Number($('saleFare').value||1),qty=Math.max(1,Math.min(20,Number($('saleQty').value)||1));
 const total=stops*per*mult*qty;
 $('stopCount').textContent=valid?stops:'—';$('farePerStop').textContent=r?money(per):'—';$('saleTotal').textContent=money(total);
 return {r,a,b,stops,per,mult,qty,total,valid};
}
function renderVehicleSelect(){
 const city=$('tripCity').value||'Тверь';
 const vehicles=db.vehicles.filter(v=>v.city===city&&v.status==='В эксплуатации');
 const old=$('tripVehicle').value;fillSelect($('tripVehicle'),vehicles.map(v=>({value:v.id,label:(v.number||v.model)+' · '+v.model})),'Выберите подвижной состав');
 if(vehicles.some(v=>v.id===old))$('tripVehicle').value=old;
}
function renderInfo(){
 const route=activeTripRoute(),vehicle=activeVehicle();
 $('gameClock').textContent=currentShift?.game_time||$('tripGameTime').value||'—';
 $('infoRoute').textContent=route?route.name:'—';$('infoVehicle').textContent=vehicle?(vehicle.number+' · '+vehicle.model):(currentShift?.vehicle_label||'—');
 $('infoGameTime').textContent=currentShift?.game_time||'—';if($('liveRoute'))$('liveRoute').value=currentShift?.route_id||'';if($('liveRouteControls'))$('liveRouteControls').style.display=currentShift?'grid':'none';if($('liveCurrentStop'))$('liveCurrentStop').disabled=!!currentShift;if($('tripNextStop'))$('tripNextStop').disabled=!currentShift||!activeTripRoute()||Number(currentShift.current_stop_index||0)>=Math.min(Number(currentShift.end_stop_index??((activeTripRoute()?.stops?.length||1)-1)),(activeTripRoute()?.stops?.length||1)-1);if($('cashNextStop'))$('cashNextStop').disabled=$('tripNextStop')?.disabled??true;
 const activeStops=activeTripRoute()?.stops||[],cur=Number(currentShift?.current_stop_index||0);$('infoCurrentStop').textContent=currentShift&&activeStops[cur]?activeStops[cur]:'—';$('infoNextStop').textContent=currentShift&&activeStops[cur+1]?activeStops[cur+1]:'—';$('cashContext').textContent=currentShift?(route?'Рейс '+route.name+' · ':'Водительская смена · ')+(vehicle?.number||currentShift.vehicle_label||''):'Водительская смена не открыта';if($('cashShiftStatus'))$('cashShiftStatus').textContent=currentCashShift?'Кассовая смена открыта':'Кассовая смена закрыта';if($('openCashShift'))$('openCashShift').disabled=!!currentCashShift;if($('closeCashShift'))$('closeCashShift').disabled=!currentCashShift;
 $('shiftBadge').textContent=currentShift?'Смена открыта':'Смена закрыта';$('shiftBadge').className='shift-badge '+(currentShift?'open':'closed');
 $('startShift').disabled=!!currentShift;$('endShift').disabled=!currentShift;
}
function renderStats(){
 const tickets=currentCashShift?db.tickets.filter(t=>t.cash_shift_id===currentCashShift.id&&!t.archived_at):[];
 $('shiftTickets').textContent=tickets.length;
 $('shiftRevenue').textContent=money(tickets.reduce((s,t)=>s+Number(t.amount||0),0));
}
function renderFleet(){
 const city=$('dbCity').value||'Тверь',q=$('fleetSearch').value.toLowerCase();
 const rows=db.vehicles.filter(v=>v.city===city&&!v.archived_at&&[v.number,v.model,v.status].join(' ').toLowerCase().includes(q));
 $('fleetList').innerHTML=rows.length?'<table><thead><tr><th>Подвижной состав</th><th>Маршруты</th><th>Статус</th><th></th></tr></thead><tbody>'+rows.map(v=>'<tr><td><span class="row-title">'+esc(v.number)+'</span><span class="subtext">'+esc(v.model)+(v.build_date?' · '+esc(v.build_date):'')+'</span></td><td>'+esc((v.routes||[]).join(', ')||'—')+'</td><td><span class="status-tag '+(v.status==='В эксплуатации'?'active':/ремонт/i.test(v.status)?'repair':'')+'">'+esc(v.status)+'</span></td><td><button class="table-action" data-edit-vehicle="'+esc(v.id)+'">Изменить</button><button class="table-action" data-archive-vehicle="'+esc(v.id)+'">Удалить</button></td></tr>').join('')+'</tbody></table>':'<div class="empty-state">В этом парке пока нет подвижного состава</div>';
}
function renderTripRoutes(){const rows=db.routes.filter(r=>r.city==='Тверь'&&!r.archived_at);$('tripRoutesList').innerHTML=rows.length?'<table><thead><tr><th>Маршрут</th><th>Остановки</th><th>Цена за остановку</th><th></th></tr></thead><tbody>'+rows.map(r=>'<tr><td><b>'+esc(r.name)+'</b></td><td>'+r.stops.length+'</td><td>'+money(r.fare_per_stop)+'</td><td><button class="table-action" data-trip-edit-route="'+esc(r.id)+'">Изменить</button><button class="table-action" data-trip-select-route="'+esc(r.id)+'">Выбрать</button></td></tr>').join('')+'</tbody></table>':'<div class="empty-state">Маршрутов пока нет. Нажми «Создать маршрут», чтобы добавить первый.</div>'}
function renderRoutes(){
 const city=$('routesCity').value||'Тверь',rows=db.routes.filter(r=>r.city===city&&!r.archived_at);
 $('routesList').innerHTML=rows.length?'<table><thead><tr><th>Маршрут</th><th>Остановки</th><th>Цена за остановку</th><th></th></tr></thead><tbody>'+rows.map(r=>'<tr><td><span class="row-title">'+esc(r.name)+'</span><span class="subtext">'+esc(r.city)+'</span></td><td>'+((r.stops||[]).length)+' остановок</td><td>'+money(r.fare_per_stop)+'</td><td><button class="table-action" data-edit-route="'+esc(r.id)+'">Изменить</button><button class="table-action" data-archive-route="'+esc(r.id)+'">Удалить</button></td></tr>').join('')+'</tbody></table>':'<div class="empty-state">Маршруты не найдены</div>';
}
function renderCards(){const el=$('cardsList');if(!el)return;el.innerHTML=db.cards.length?db.cards.map(c=>'<div class="card-row"><div><b>'+esc(c.holder)+'</b><div class="subtext">'+esc(c.label)+'</div><div class="card-balance">Баланс: '+money(c.balance)+'</div></div><button class="table-action" data-edit-card="'+esc(c.id)+'">Изменить баланс</button></div>').join(''):'<div class="empty-state">Виртуальных карт пока нет</div>'}
function openCardEditor(card){const edit=!!card;showModal('<p class="eyebrow">ВИРТУАЛЬНАЯ КАРТА</p><h2>'+(edit?'Настроить карту':'Новая карта')+'</h2><div class="field-grid"><label class="field full"><span>Имя владельца</span><input id="cardHolder" value="'+esc(card?.holder||'')+'"></label><label class="field full"><span>Название карты</span><input id="cardLabel" value="'+esc(card?.label||'Карта Conductor')+'"></label><label class="field full"><span>Баланс (BYN)</span><input id="cardBalance" type="number" min="0" step=".01" value="'+esc(card?.balance??0)+'"></label></div><div class="modal-actions"><button id="saveCard" class="primary-btn">Сохранить</button></div>');$('saveCard').onclick=async()=>{const p={holder:$('cardHolder').value.trim(),label:$('cardLabel').value.trim(),balance:Math.max(0,Number($('cardBalance').value)||0)};if(!p.holder||!p.label){toast('Заполни имя и название карты','error');return}try{const q=edit?await client.from('conductor_cards').update(p).eq('id',card.id).select().single():await client.from('conductor_cards').insert({...p,id:uid('card')}).select().single();if(q.error)throw q.error;if(edit)db.cards=db.cards.map(x=>x.id===card.id?q.data:x);else db.cards.push(q.data);closeModal();renderCards();toast('Виртуальная карта сохранена','success')}catch(e){toast('Ошибка карты: '+e.message,'error')}}}
function renderTickets(){
 const active=db.tickets.filter(t=>!t.archived_at);
 const rows=[...active].sort((a,b)=>b.ticket_number-a.ticket_number).slice(0,100);
 $('ticketCount').textContent=active.length+' билетов';
 $('ticketsList').innerHTML=rows.length?'<table><thead><tr><th>Билет</th><th>Маршрут</th><th>Откуда → Куда</th><th>Тариф</th><th>Оплата</th><th>Сумма</th></tr></thead><tbody>'+rows.map(t=>'<tr><td><b>#'+t.ticket_number+'</b><span class="subtext">'+new Date(t.issued_at).toLocaleString('ru-RU')+'</span></td><td>'+esc(t.route_name||'—')+'</td><td>'+esc(t.from_stop)+' → '+esc(t.to_stop)+'</td><td>'+esc(t.fare_type)+'</td><td>'+esc(t.payment_method==='card'?'Карта':'Наличные')+'</td><td><b>'+money(t.amount)+'</b><button class="table-action" data-archive-ticket="'+t.ticket_number+'">Удалить</button></td></tr>').join('')+'</tbody></table>':'<div class="empty-state">Проданных билетов пока нет</div>';
}
async function openCashShift(){if(currentCashShift){toast('Кассовая смена уже открыта');return}const q=await client.from('conductor_cash_shifts').insert({id:uid('cash'),status:'open',opening_cash:Math.max(0,Number($('cashOpening').value)||0)}).select().single();if(q.error){toast('Не удалось открыть кассу: '+q.error.message,'error');return}currentCashShift=q.data;db.cashShifts.unshift(q.data);renderInfo();renderStats();toast('Кассовая смена открыта отдельно','success')}
async function closeCashShift(){if(!currentCashShift)return;const q=await client.from('conductor_cash_shifts').update({status:'closed',ended_at:new Date().toISOString(),closing_cash:Math.max(0,Number($('cashClosing').value)||0)}).eq('id',currentCashShift.id).select().single();if(q.error){toast('Не удалось закрыть кассу: '+q.error.message,'error');return}db.cashShifts=db.cashShifts.map(x=>x.id===q.data.id?q.data:x);currentCashShift=null;renderInfo();renderStats();toast('Кассовая смена закрыта','success')}
function updateRouteSummary(){const el=$('liveRouteSummary');if(!el)return;const r=db.routes.find(x=>x.id===$('liveRoute')?.value);if(!r){el.textContent='Выбери маршрут — появятся начальная, конечная и все промежуточные остановки';return}const a=Number($('liveCurrentStop').value||0),b=Number($('liveEndStop').value||r.stops.length-1);el.innerHTML='<b>Маршрут '+esc(r.name)+'</b><p>Начальная остановка маршрута: '+esc(r.stops[0])+'</p><p>Конечная остановка маршрута: '+esc(r.stops[r.stops.length-1])+'</p><p>Текущая отправная точка: '+esc(r.stops[a]||r.stops[0])+'</p><p>Окончание рейса: '+esc(r.stops[b]||r.stops[r.stops.length-1])+'</p><small>Весь путь: '+r.stops.map((x,i)=>(i+1)+'. '+esc(x)).join(' → ')+'</small>'}
function syncTripStops(){
 const r=db.routes.find(x=>x.id===$('liveRoute')?.value&&!x.archived_at);if(!r)return;
 for(const id of ['liveCurrentStop','liveEndStop']){const el=$(id);if(el)el.innerHTML=r.stops.map((s,i)=>'<option value="'+i+'">'+esc(s)+'</option>').join('')}
 if(currentShift){$('liveCurrentStop').value=String(currentShift.current_stop_index||0);$('liveEndStop').value=String(currentShift.end_stop_index??r.stops.length-1)}updateRouteSummary();
}
function renderHistory(){
 const rows=[...db.shifts].sort((a,b)=>new Date(b.started_at)-new Date(a.started_at)).slice(0,20);
 $('shiftHistory').innerHTML=rows.length?'<div class="table-wrap"><table><thead><tr><th>Маршрут</th><th>Состав</th><th>Игровое время</th><th>Статус</th><th>Начало</th></tr></thead><tbody>'+rows.map(s=>{const r=db.routes.find(x=>x.id===s.route_id),v=db.vehicles.find(x=>x.id===s.vehicle_id);return '<tr><td>'+esc(r?.name||'—')+'</td><td>'+esc(v?.number||(s.vehicle_label||'—'))+'</td><td>'+esc(s.game_time||'—')+'</td><td><span class="status-tag '+(s.status==='open'?'active':'')+'">'+(s.status==='open'?'Открыт':'Завершён')+'</span></td><td>'+new Date(s.started_at).toLocaleString('ru-RU')+'</td></tr>'}).join('')+'</tbody></table></div>':'<div class="empty-state">Рейсов пока нет</div>';
}
function renderTicket(t){if(!t)return;lastTicket=t;$('ticketPreview').innerHTML='<b>БИЛЕТ № '+esc(t.ticket_number)+'</b><span>От: '+esc(t.from_stop)+'</span><span>До: '+esc(t.to_stop)+'</span><strong>'+money(t.amount)+'</strong>'}
function ticketPrint(tickets){
 const list=(Array.isArray(tickets)?tickets:[tickets]).filter(Boolean);if(!list.length){toast('Сначала продай билет');return}
 let root=document.getElementById('ticketPrintRoot');if(root)root.remove();root=document.createElement('div');root.id='ticketPrintRoot';
 root.innerHTML=list.map(t=>'<div class="ticket-paper printable"><b>БИЛЕТ № '+esc(t.ticket_number)+'</b><span>От: '+esc(t.from_stop)+'</span><span>До: '+esc(t.to_stop)+'</span><strong>'+money(t.amount)+'</strong></div>').join('');
 document.body.appendChild(root);document.body.classList.add('print-ticket');window.print();
 window.onafterprint=()=>{document.body.classList.remove('print-ticket');root.remove()};
}
function showPhoneQr(){
 if(!currentCashShift){toast('Сначала открой кассовую смену','error');return}
 const routeId=$('saleRoute').value||(currentShift?.route_id||'');
 const base=location.href.split('?')[0].replace('index.html','').replace(/#.*$/,'');
 const url=base+'pay.html?cash='+encodeURIComponent(currentCashShift.id)+(currentShift?'&shift='+encodeURIComponent(currentShift.id):'')+(routeId?'&route='+encodeURIComponent(routeId):'');
 showModal('<p class="eyebrow">ПОКУПКА НА ТЕЛЕФОНЕ</p><h2>QR-код для телефона</h2><p class="hint">На другом устройстве открой камеру и наведи её на этот код. Откроется форма выбора остановки и оплаты.</p><div id="phoneQr" class="phone-qr"></div><p class="hint">'+esc(url)+'</p>');
 new QRCode($('phoneQr'),{text:url,width:220,height:220,correctLevel:QRCode.CorrectLevel.M});
}
async function openPayment(){
 if(!currentCashShift){toast('Сначала открой кассовую смену в разделе «Касса»','error');return}
 const x=updateFare();if(!x.valid){toast('Выбери маршрут и остановку назначения','error');return}
 if(currentShift&&currentShift.route_id!==x.r.id){await assignShiftRoute(x.r.id);if(currentShift.route_id!==x.r.id)return}
 const fareName=x.mult===.5?'Льготный':x.mult===.75?'Школьный':'Полный';
 const cards=db.cards.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.holder)+' · '+money(c.balance)+'</option>').join('');
 showModal('<p class="eyebrow">ПОДТВЕРЖДЕНИЕ ПОКУПКИ</p><h2>Оплата билета</h2><div class="payment-total">'+money(x.total)+'</div><div class="trip-info"><div><small>Маршрут</small><b>'+esc(x.r.name)+'</b></div><div><small>Путь</small><b>'+esc(x.r.stops[x.a])+' → '+esc(x.r.stops[x.b])+'</b></div><div><small>Тариф · количество</small><b>'+fareName+' · '+x.qty+'</b></div></div><label class="field"><span>Получено наличными</span><input id="cashReceived" type="number" min="'+x.total+'" step=".01" value="'+x.total.toFixed(2)+'"></label><div class="quick-cash">'+[1,2,3,4,5,10,15,20,25,30,35,40,45,50].map(n=>'<button type="button" data-cash="'+n+'">'+n+'</button>').join('')+'</div><label class="field"><span>Виртуальная карта</span><select id="cardForPayment"><option value="">Выбери карту</option>'+cards+'</select></label><div class="fare-summary"><div><small>К оплате</small><b>'+money(x.total)+'</b></div><div><small>Получено</small><b id="receivedValue">'+money(x.total)+'</b></div><div class="sum"><small>Сдача</small><b id="changeValue">0,00 BYN</b></div></div><div class="payment-methods"><button id="payCash" class="primary-btn">Наличными</button><button id="payCard" class="secondary-btn">Оплатить картой</button></div><p class="hint">Карта виртуальная, только для игровой симуляции. Настоящие банковские платежи не выполняются.</p>');
 const input=$('cashReceived');
 function change(){const received=Math.max(0,Number(input.value)||0);$('receivedValue').textContent=money(received);$('changeValue').textContent=money(Math.max(0,received-x.total))}
 input.addEventListener('input',change);
 document.querySelectorAll('[data-cash]').forEach(b=>b.addEventListener('click',()=>{input.value=Number(b.dataset.cash).toFixed(2);change()}));
 $('payCash').onclick=()=>{const received=Number(input.value)||0;if(received+0.00001<x.total){toast('Недостаточно наличных','error');return}completeSale(x,'cash',received,null)};
 $('payCard').onclick=()=>{const id=$('cardForPayment').value;if(!id){toast('Создай или выбери виртуальную карту','error');return}completeSale(x,'card',x.total,id)};
}
async function completeSale(x,method,received,cardId){
 const button=method==='cash'?$('payCash'):$('payCard');button.disabled=true;button.textContent='Проверка оплаты…';
 try{
  const fareName=x.mult===.5?'Льготный':x.mult===.75?'Школьный':'Полный';
  const rows=Array.from({length:x.qty},()=>({shift_id:currentShift?.id||null,cash_shift_id:currentCashShift.id,route_id:x.r.id,route_name:x.r.name,from_stop:x.r.stops[x.a],to_stop:x.r.stops[x.b],stop_count:x.stops,fare_type:fareName,fare_multiplier:x.mult,fare_per_stop:x.per,amount:Number((x.stops*x.per*x.mult).toFixed(2)),payment_method:method,cash_received:method==='cash'?received/x.qty:x.total/x.qty,change_due:method==='cash'?Math.max(0,received-x.total)/x.qty:0,game_time:formatGameDateTime(getGameClockMs()),card_id:cardId}));
  let data;
  if(method==='card'){
   const charge=await client.rpc('conductor_charge_virtual_card',{p_card_id:cardId,p_ticket_rows:rows});
   if(charge.error)throw charge.error;
   if(!charge.data?.ok)throw new Error('Недостаточно средств на виртуальной карте');
   data=charge.data.tickets;
   const refreshed=await client.from('conductor_cards').select('*').eq('id',cardId).single();
   if(!refreshed.error)db.cards=db.cards.map(c=>c.id===cardId?refreshed.data:c);
  }else{
   const q=await client.from('conductor_tickets').insert(rows).select('*');if(q.error)throw q.error;data=q.data;
  }
  db.tickets.push(...data);lastTickets=data;renderTicket(data[0]);closeModal();renderStats();renderTickets();renderCards();
  toast(method==='card'?'Оплата прошла · билет № '+data[0].ticket_number:'Оплата принята · билет № '+data[0].ticket_number,'success');
 }catch(e){console.error(e);button.disabled=false;button.textContent=method==='cash'?'Наличными':'Оплатить картой';toast('Оплата не прошла: '+(e.message||'ошибка базы'),'error')}
}
function openVehicleEditor(v){
 const edit=!!v;
 showModal('<p class="eyebrow">АВТОБУСНЫЙ ПАРК · ТВЕРЬ</p><h2>'+(edit?'Изменить состав':'Добавить подвижной состав')+'</h2><div class="field-grid"><label class="field"><span>Бортовой номер</span><input id="vNumber" value="'+esc(v?.number||'')+'"></label><label class="field"><span>Модель</span><input id="vModel" value="'+esc(v?.model||'')+'"></label><label class="field"><span>Дата постройки</span><input id="vDate" type="date" value="'+esc(v?.build_date||'')+'"></label><label class="field full"><span>Статус</span><select id="vStatus">'+statusOptions.filter(s=>s!=='На рейсе'||v?.status==='На рейсе').map(s=>'<option '+(s===(v?.status||'В эксплуатации')?'selected':'')+'>'+s+'</option>').join('')+'</select></label><label class="field full"><span>Бригадные маршруты (через запятую)</span><input id="vRoutes" value="'+esc((v?.routes||[]).join(', '))+'"></label><label class="field full"><span>Примечание</span><input id="vNote" value="'+esc(v?.note||'')+'"></label></div><div class="modal-actions"><button id="saveVehicle" class="primary-btn">Сохранить</button></div>');
 $('saveVehicle').onclick=async()=>{const payload={number:$('vNumber').value.trim(),model:$('vModel').value.trim(),city:'Тверь',status:$('vStatus').value,build_date:$('vDate').value||null,routes:$('vRoutes').value.split(',').map(s=>s.trim()).filter(Boolean),note:$('vNote').value.trim()};if(!payload.number||!payload.model){toast('Заполни номер и модель','error');return}try{const q=edit?await client.from('conductor_vehicles').update(payload).eq('id',v.id).select().single():await client.from('conductor_vehicles').insert({...payload,id:uid('vehicle'),previous_status:payload.status}).select().single();if(q.error)throw q.error;if(edit)db.vehicles=db.vehicles.map(x=>x.id===v.id?q.data:x);else db.vehicles.push(q.data);closeModal();renderAll();toast('Подвижной состав сохранён','success')}catch(e){toast('Ошибка сохранения: '+e.message,'error')}};
}
function openRouteEditor(r){
 const edit=!!r;
 showModal('<p class="eyebrow">МАРШРУТНАЯ СЕТЬ</p><h2>'+(edit?'Изменить пару маршрутов':'Новая пара маршрутов')+'</h2><div class="field-grid"><label class="field full"><span>Номер / название маршрута</span><input id="rName" value="'+esc(r?.name||'')+'"></label><label class="field full"><span>Остановки по порядку — через точку с запятой</span><textarea id="rStops" rows="7" placeholder="Речной вокзал; Третьяковск; Ивановск; Тетрис">'+esc((r?.stops||[]).join('; '))+'</textarea></label><label class="field"><span>Цена за одну остановку (BYN)</span><input id="rFare" type="number" min="0" step=".01" value="'+esc(r?.fare_per_stop??.5)+'"></label></div><p class="hint">Обратное направление создаётся автоматически: список остановок будет развёрнут в обратном порядке. Обе стороны будут связаны между собой.</p><div class="modal-actions"><button id="saveRoute" class="primary-btn">Сохранить оба направления</button></div>');
 $('saveRoute').onclick=async()=>{
  const stops=$('rStops').value.split(/[;\n]+/).map(s=>s.trim()).filter(Boolean);
  const typedName=$('rName').value.trim();
  const baseName=typedName.replace(/\s*\(обратный\)$/i,'').trim();
  const payload={name:baseName,city:'Тверь',stops,fare_per_stop:Math.max(0,Number($('rFare').value)||0)};
  if(!baseName||stops.length<2){toast('Укажи маршрут и минимум две остановки','error');return}
  const pairSuffix=' (обратный)',routeNames=[baseName,baseName+pairSuffix];
  try{
   let savedRows=[],selectedId='',pairId='';
   if(edit){
    pairId=r.pair_id||r.id;
    const direction=r.direction||(String(r.name||'').toLowerCase().endsWith(pairSuffix)?'return':'outbound');
    const oppositeDirection=direction==='return'?'outbound':'return';
    const other=db.routes.find(x=>x.id!==r.id&&x.pair_id===pairId&&!x.archived_at);
    const otherId=other?.id||uid('route');
    selectedId=r.id;
    const selectedRow={...payload,id:r.id,pair_id:pairId,direction,name:direction==='return'?baseName+pairSuffix:baseName};
    const otherRow={id:otherId,pair_id:pairId,direction:oppositeDirection,city:payload.city,name:oppositeDirection==='return'?baseName+pairSuffix:baseName,stops:[...stops].reverse(),fare_per_stop:payload.fare_per_stop};
    const conflict=db.routes.find(x=>!x.archived_at&&x.city===payload.city&&x.pair_id!==pairId&&routeNames.includes(x.name));
    if(conflict)throw new Error('Маршрут с таким названием уже существует: '+conflict.name);
    const q=await client.from('conductor_routes').upsert([selectedRow,otherRow],{onConflict:'id'}).select();
    if(q.error)throw q.error;
    savedRows=q.data||[];
   }else{
    const conflict=db.routes.find(x=>!x.archived_at&&x.city===payload.city&&routeNames.includes(x.name));
    if(conflict)throw new Error('Маршрут с таким названием уже существует: '+conflict.name);
    pairId=uid('route');selectedId=pairId;
    const reverseId=uid('route');
    const rows=[
     {...payload,id:pairId,pair_id:pairId,direction:'outbound',name:baseName},
     {...payload,id:reverseId,pair_id:pairId,direction:'return',name:baseName+pairSuffix,stops:[...stops].reverse()}
    ];
    const q=await client.from('conductor_routes').insert(rows).select();
    if(q.error)throw q.error;
    savedRows=q.data||[];
   }
   db.routes=db.routes.map(old=>savedRows.find(row=>row.id===old.id)||old);
   const knownIds=new Set(db.routes.map(x=>x.id));
   db.routes.push(...savedRows.filter(row=>!knownIds.has(row.id)));
   if(currentShift&&savedRows.some(row=>row.id===currentShift.route_id)){
    const active= savedRows.find(row=>row.id===currentShift.route_id);
    const max=active.stops.length-1,current=Math.max(0,Math.min(Number(currentShift.current_stop_index||0),max)),end=Math.max(current,Math.min(Number(currentShift.end_stop_index??max),max));
    const sync=await client.from('conductor_shifts').update({current_stop_index:current,end_stop_index:end}).eq('id',currentShift.id).select().single();
    if(sync.error)throw sync.error;
    currentShift=sync.data;db.shifts=db.shifts.map(x=>x.id===sync.data.id?sync.data:x);
   }
   closeModal();renderAll();
   if(!currentShift)$('saleRoute').value=selectedId;
   updateSaleStops();
   toast(edit?'Оба направления маршрута сохранены':'Созданы прямое и обратное направления','success');
  }catch(e){toast('Ошибка сохранения маршрутов: '+(e.message||String(e)),'error')}
 };
}
async function startShift(){
 if(currentShift){toast('Смена уже открыта');return}
 const vehicle=db.vehicles.find(v=>v.id===$('tripVehicle').value),manual=$('tripManualVehicle').value.trim();
 if(!vehicle&&!manual){toast('Выбери автобус из базы или впиши его вручную','error');return}
 try{
  const payload={id:uid('shift'),route_id:null,vehicle_id:vehicle?.id||null,vehicle_label:vehicle?null:manual,game_time:formatGameTimeOnly(getGameClockMs()),status:'open',started_at:new Date().toISOString(),previous_vehicle_status:vehicle?.status||null,current_stop_index:0,end_stop_index:null};
  const q=await client.from('conductor_shifts').insert(payload).select().single();if(q.error)throw q.error;
  if(vehicle){const upd=await client.from('conductor_vehicles').update({status:'На рейсе',previous_status:vehicle.status}).eq('id',vehicle.id).select().single();if(upd.error){await client.from('conductor_shifts').delete().eq('id',q.data.id);throw upd.error}Object.assign(vehicle,upd.data)}
  currentShift=q.data;db.shifts.unshift(q.data);renderAll();toast('Смена открыта. Теперь выбери маршрут.');
 }catch(e){toast('Не удалось открыть смену: '+e.message,'error')}
}
async function assignShiftRoute(routeId){
 if(!currentShift){toast('Сначала открой смену','error');return}
 const route=db.routes.find(r=>r.id===routeId&&!r.archived_at);if(!route){toast('Архивный или отсутствующий маршрут нельзя назначить','error');return}
 if(!Array.isArray(route.stops)||route.stops.length<2){toast('В маршруте недостаточно остановок','error');return}
 const current=currentShift.route_id===route.id?Math.max(0,Math.min(Number(currentShift.current_stop_index||0),route.stops.length-1)):0;
 const patch={route_id:route.id,current_stop_index:current,end_stop_index:route.stops.length-1};
 const q=await client.from('conductor_shifts').update(patch).eq('id',currentShift.id).select().single();
 if(q.error){toast('Не удалось назначить маршрут: '+q.error.message,'error');return}
 currentShift=q.data;db.shifts=db.shifts.map(s=>s.id===q.data.id?q.data:s);$('saleRoute').value=route.id;$('liveRoute').value=route.id;syncTripStops();updateSaleStops();renderInfo();renderHistory();toast('Рейс '+route.name+' назначен');
}
async function nextStop(){if(!currentShift){toast('Рейс не открыт','error');return}const route=activeTripRoute();if(!route||!Array.isArray(route.stops)){toast('Сначала назначь маршрут','error');return}const current=Number(currentShift.current_stop_index||0),end=Math.min(Number(currentShift.end_stop_index??route.stops.length-1),route.stops.length-1);if(current>=end){toast('Достигнута конечная остановка рейса','error');return}try{const next=current+1;const q=await client.from('conductor_shifts').update({current_stop_index:next}).eq('id',currentShift.id).eq('status','open').select().single();if(q.error)throw q.error;currentShift=q.data;db.shifts=db.shifts.map(s=>s.id===q.data.id?q.data:s);$('saleRoute').value=route.id;renderInfo();updateSaleStops();syncTripStops();renderHistory();toast('Следующая остановка: '+route.stops[next],'success')}catch(e){toast('Не удалось перейти к следующей остановке: '+e.message,'error')}}
async function endShift(){
 if(!currentShift)return;
 try{
  const closingId=currentShift.id;const q=await client.rpc('conductor_close_shift',{p_shift_id:closingId});if(q.error)throw q.error;
  const closed=typeof q.data==='string'?JSON.parse(q.data):q.data;db.shifts=db.shifts.map(s=>s.id===closingId?closed:s);
  const vehicle=db.vehicles.find(v=>v.id===closed.vehicle_id);if(vehicle){vehicle.status=vehicle.previous_status||closed.previous_vehicle_status||'В эксплуатации';vehicle.previous_status=null}
  currentShift=null;renderAll();toast('Смена завершена атомарно и сохранена');
 }catch(e){toast('Ошибка завершения смены: '+e.message)}
}
function renderSchedules(){const folders=[...new Set(db.schedules.map(s=>s.folder))];$('scheduleFolders').innerHTML=folders.length?folders.map(f=>'<button class="schedule-folder '+(activeScheduleFolder===f?'active':'')+'" data-folder="'+esc(f)+'">'+esc(f)+'<small>'+db.schedules.filter(s=>s.folder===f).length+' расписаний</small></button>').join(''):'<div class="empty-state">Папок пока нет — создай первую</div>';const list=db.schedules.filter(s=>s.folder===activeScheduleFolder);$('scheduleEntries').innerHTML=activeScheduleFolder?'<div class="panel-head"><h2>Маршрут '+esc(activeScheduleFolder)+'</h2><button id="addScheduleText" class="primary-btn compact" type="button">＋ Добавить расписание</button></div>'+(list.length?list.map(s=>'<article class="schedule-entry"><h3>'+esc(s.title)+'</h3><pre>'+esc(s.body)+'</pre><button class="table-action" data-edit-schedule="'+esc(s.id)+'">Изменить</button></article>').join(''):'<div class="empty-state">В этой папке пока нет расписаний</div>'):'<div class="empty-state">Выбери папку маршрута</div>'}
function editSchedule(s){const folder=activeScheduleFolder||s?.folder||'';showModal('<p class="eyebrow">РАСПИСАНИЕ</p><h2>'+(s?'Изменить расписание':'Новое расписание')+'</h2><div class="field-grid"><label class="field full"><span>Папка / маршрут</span><input id="scheduleFolder" value="'+esc(folder)+'"></label><label class="field full"><span>Название</span><input id="scheduleTitle" value="'+esc(s?.title||'')+'"></label><label class="field full"><span>Текст расписания</span><textarea id="scheduleBody" rows="8">'+esc(s?.body||'')+'</textarea></label></div><div class="modal-actions"><button id="saveSchedule" class="primary-btn">Сохранить</button></div>');$('saveSchedule').onclick=async()=>{const p={folder:$('scheduleFolder').value.trim(),title:$('scheduleTitle').value.trim(),body:$('scheduleBody').value};if(!p.folder||!p.title){toast('Укажи папку и название','error');return}const q=s?await client.from('conductor_schedules').update(p).eq('id',s.id).select().single():await client.from('conductor_schedules').insert({...p,id:uid('schedule')}).select().single();if(q.error){toast('Ошибка расписания: '+q.error.message,'error');return}db.schedules=s?db.schedules.map(x=>x.id===s.id?q.data:x):[...db.schedules,q.data];activeScheduleFolder=p.folder;closeModal();renderSchedules();toast('Расписание сохранено','success')}}
function renderNews(){const el=$('newsList');if(!el)return;const rows=db.news.filter(n=>!n.archived_at);el.innerHTML=rows.length?rows.map(n=>'<article class="glass panel news-item"><div class="eyebrow">'+esc(n.category)+' · '+new Date(n.published_at).toLocaleString('ru-RU')+'</div><h2>'+esc(n.title)+'</h2><p>'+esc(n.body).replace(/\n/g,'<br>')+'</p><button class="table-action" data-archive-news="'+esc(n.id)+'">В архив</button></article>').join(''):'<div class="empty-state">Городских новостей пока нет</div>'}
function editNews(){showModal('<p class="eyebrow">ГОРОДСКИЕ НОВОСТИ</p><h2>Новая новость</h2><div class="field-grid"><label class="field full"><span>Заголовок</span><input id="newsTitle" maxlength="160"></label><label class="field full"><span>Категория</span><input id="newsCategory" value="Город"></label><label class="field full"><span>Текст</span><textarea id="newsBody" rows="6"></textarea></label></div><div class="modal-actions"><button id="saveNews" class="primary-btn">Опубликовать</button></div>');$('saveNews').onclick=async()=>{const p={id:uid('news'),title:$('newsTitle').value.trim(),category:$('newsCategory').value.trim()||'Город',body:$('newsBody').value.trim()};if(!p.title||!p.body){toast('Заполни заголовок и текст','error');return}const q=await client.from('conductor_news').insert(p).select().single();if(q.error){toast('Ошибка публикации: '+q.error.message,'error');return}db.news.unshift(q.data);closeModal();renderNews();toast('Новость опубликована','success')}}
async function archiveRecord(table,id,key='id'){if(table==='conductor_routes'&&currentShift?.route_id===id){toast('Нельзя архивировать маршрут действующего рейса','error');return}if(!confirm('Переместить в архив? Запись можно будет восстановить.'))return;const q=await client.from(table).update({archived_at:new Date().toISOString()}).eq(key,id).select().single();if(q.error){toast('Ошибка архива: '+q.error.message,'error');return}await loadData();toast('Запись перемещена в архив','success')}
async function restoreRecord(table,id,key='id'){const q=await client.from(table).update({archived_at:null}).eq(key,id).select().single();if(q.error){toast('Ошибка восстановления: '+q.error.message,'error');return}await loadData();toast('Запись восстановлена','success')}
function renderArchive(){const el=$('archiveList');if(!el)return;const items=[...db.vehicles.filter(x=>x.archived_at).map(x=>({table:'conductor_vehicles',id:x.id,label:'Автобус '+x.number+' · '+x.model})),...db.routes.filter(x=>x.archived_at).map(x=>({table:'conductor_routes',id:x.id,label:'Маршрут '+x.name})),...db.tickets.filter(x=>x.archived_at).map(x=>({table:'conductor_tickets',id:String(x.ticket_number),label:'Билет №'+x.ticket_number})),...db.news.filter(x=>x.archived_at).map(x=>({table:'conductor_news',id:x.id,label:'Новость: '+x.title}))];el.innerHTML=items.length?items.map(x=>'<div class="archive-row"><span>'+esc(x.label)+'</span><button class="table-action" data-restore-table="'+x.table+'" data-restore-id="'+esc(x.id)+'" data-restore-key="'+(x.table==='conductor_tickets'?'ticket_number':'id')+'">Восстановить</button></div>').join(''):'<div class="empty-state">Архив пуст</div>'}
function renderAll(){renderRouteSelects();renderFleet();renderRoutes();renderCards();renderTickets();renderHistory();renderSchedules();renderStats();renderTripRoutes();renderNews();renderArchive();}
async function fetchAllTickets(){const all=[];let start=0;const pageSize=1000;while(true){const q=await client.from('conductor_tickets').select('*').order('ticket_number',{ascending:false}).range(start,start+pageSize-1);if(q.error)throw q.error;const rows=q.data||[];all.push(...rows);if(rows.length<pageSize)break;start+=pageSize;}return all;}
async function loadData(){
 setCloud('Загрузка базы…','');
 const [r,v,s,t,sch,cards,cs,news,gc]=await Promise.all([
  client.from('conductor_routes').select('*').order('city').order('name'),
  client.from('conductor_vehicles').select('*').order('city').order('number'),
  client.from('conductor_shifts').select('*').order('started_at',{ascending:false}).limit(100),
  fetchAllTickets(),
  client.from('conductor_schedules').select('*').order('folder').order('title'),
  client.from('conductor_cards').select('*').order('holder'),
  client.from('conductor_cash_shifts').select('*').order('started_at',{ascending:false}).limit(100),
  client.from('conductor_news').select('*').order('published_at',{ascending:false}).limit(200),
   client.from('conductor_game_clock').select('*').eq('id','main').maybeSingle()
  ]);
 for(const [label,x] of [['маршруты',r],['подвижной состав',v],['водительские смены',s],['расписания',sch],['виртуальные карты',cards],['кассовые смены',cs],['городские новости',news],['игровые часы',gc]])if(x.error)throw new Error(label+': '+x.error.message+' · '+(x.error.code||'без кода'));
 db={routes:(r.data||[]).filter(x=>x.city==='Тверь'),vehicles:(v.data||[]).filter(x=>x.city==='Тверь'),shifts:s.data||[],tickets:t||[],schedules:sch.data||[],cards:cards.data||[],cashShifts:cs.data||[],news:news.data||[]};
 currentShift=db.shifts.find(s=>s.status==='open')||null;currentCashShift=db.cashShifts.find(s=>s.status==='open')||null;gameClockState=gc.data||null;
 if(currentShift){const activeRoute=db.routes.find(r=>r.id===currentShift.route_id&&!r.archived_at);if(activeRoute){const max=activeRoute.stops.length-1,current=Math.max(0,Math.min(Number(currentShift.current_stop_index||0),max)),end=Math.max(current,Math.min(Number(currentShift.end_stop_index??max),max));if(current!==currentShift.current_stop_index||end!==currentShift.end_stop_index){const fixed=await client.from('conductor_shifts').update({current_stop_index:current,end_stop_index:end}).eq('id',currentShift.id).select().single();if(!fixed.error){currentShift=fixed.data;db.shifts=db.shifts.map(s=>s.id===fixed.data.id?fixed.data:s)}}}}
 setCloud('База синхронизирована','ok');renderAll();renderGameClock();
}
function startRealtime(){if(realtimeChannel)return;realtimeChannel=client.channel('conductor-live-sync').on('postgres_changes',{event:'*',schema:'public'},payload=>{if(!String(payload.table||'').startsWith('conductor_')||realtimeLoading)return;clearTimeout(realtimeRefreshTimer);realtimeRefreshTimer=setTimeout(async()=>{if(realtimeLoading)return;realtimeLoading=true;try{await loadData()}catch(e){console.error('Realtime refresh failed',e);setCloud('Ошибка синхронизации','error')}finally{realtimeLoading=false}},350)}).subscribe((status,error)=>{if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')console.error('Conductor Realtime:',status,error)});}
function nav(tab){document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id==='view-'+tab))}
function init(){
 $('realClock').textContent=new Date().toLocaleTimeString('ru-RU');renderGameClock();setInterval(()=>{$('realClock').textContent=new Date().toLocaleTimeString('ru-RU');renderGameClock()},1000);
 document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>nav(b.dataset.tab)));
 document.querySelectorAll('[data-goto]').forEach(b=>b.addEventListener('click',()=>nav(b.dataset.goto)));
 document.querySelectorAll('.db-tab').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.db-tab').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.db-view').forEach(x=>x.classList.toggle('active',x.id==='db-'+b.dataset.dbtab))}));
 $('saleRoute').onchange=()=>{updateSaleStops();if(currentShift&&$('saleRoute').value&&currentShift.route_id!==$('saleRoute').value)assignShiftRoute($('saleRoute').value)};$('saleFrom').onchange=()=>{if(!currentShift)updateSaleStops();else updateFare()};$('saleTo').onchange=updateFare;$('saleFare').onchange=updateFare;$('saleQty').oninput=updateFare;
 $('qtyMinus').onclick=()=>{$('saleQty').value=Math.max(1,Number($('saleQty').value)-1);updateFare()};$('qtyPlus').onclick=()=>{$('saleQty').value=Math.min(20,Number($('saleQty').value)+1);updateFare()};
 $('openPayment').onclick=openPayment;$('printTicket').onclick=()=>ticketPrint(lastTickets.length?lastTickets:lastTicket);$('showPhoneQr').onclick=showPhoneQr;$('addScheduleFolder').onclick=()=>{const f=prompt('Название папки маршрута, например 102:');if(!f)return;activeScheduleFolder=f.trim();editSchedule(null)};$('scheduleFolders').onclick=e=>{const b=e.target.closest('[data-folder]');if(b){activeScheduleFolder=b.dataset.folder;renderSchedules()}};$('scheduleEntries').onclick=e=>{const add=e.target.closest('#addScheduleText'),edit=e.target.closest('[data-edit-schedule]');if(add)editSchedule(null);if(edit)editSchedule(db.schedules.find(s=>s.id===edit.dataset.editSchedule))};
 $('tripCity').onchange=renderRouteSelects;$('liveRoute').onchange=()=>assignShiftRoute($('liveRoute').value);$('liveCurrentStop').onchange=()=>{if(currentShift){$('liveCurrentStop').value=String(currentShift.current_stop_index||0);toast('Используй кнопку «Следующая остановка»')}};$('liveEndStop').onchange=async()=>{if(!currentShift)return;const i=Number($('liveEndStop').value),current=Number(currentShift.current_stop_index||0);if(!Number.isInteger(i)||i<current){$('liveEndStop').value=String(currentShift.end_stop_index??current);toast('Конечная остановка не может быть раньше текущей','error');return}const route=activeTripRoute();if(!route||i>=route.stops.length){toast('Остановка не принадлежит действующему маршруту','error');syncTripStops();return}const q=await client.from('conductor_shifts').update({end_stop_index:i}).eq('id',currentShift.id).select().single();if(q.error){toast(q.error.message,'error');return}currentShift=q.data;db.shifts=db.shifts.map(s=>s.id===q.data.id?q.data:s);updateSaleStops();updateRouteSummary();toast('Конечная остановка рейса изменена','success')};$('gameClockPause').onclick=toggleGameClockPause;$('gameClockRate').onchange=()=>changeGameClockRate($('gameClockRate').value);$('gameClockBackHour').onclick=()=>jumpGameClock(-60);$('gameClockBack15').onclick=()=>jumpGameClock(-15);$('gameClockForward15').onclick=()=>jumpGameClock(15);$('gameClockForwardHour').onclick=()=>jumpGameClock(60);$('gameClockSet').onclick=setGameClockManually;$('gameClockManual').oninput=()=>{$('gameClockManual').dataset.touched='1'};$('startShift').onclick=startShift;$('endShift').onclick=endShift;$('tripNextStop').onclick=nextStop;$('cashNextStop').onclick=nextStop;$('openCashShift').onclick=openCashShift;$('closeCashShift').onclick=closeCashShift;
 $('dbCity').onchange=renderFleet;$('fleetSearch').oninput=renderFleet;$('routesCity').onchange=renderRoutes;
 $('addCard').onclick=()=>openCardEditor(null);$('cardsList').onclick=e=>{const b=e.target.closest('[data-edit-card]');if(b)openCardEditor(db.cards.find(c=>c.id===b.dataset.editCard))};$('addVehicle').onclick=()=>openVehicleEditor(null);$('addRoute').onclick=()=>openRouteEditor(null);$('tripAddRoute').onclick=()=>openRouteEditor(null);$('tripRoutesList').onclick=e=>{const ed=e.target.closest('[data-trip-edit-route]'),sel=e.target.closest('[data-trip-select-route]');if(ed)openRouteEditor(db.routes.find(r=>r.id===ed.dataset.tripEditRoute));if(sel)assignShiftRoute(sel.dataset.tripSelectRoute)};
 $('fleetList').onclick=e=>{const b=e.target.closest('[data-edit-vehicle]'),d=e.target.closest('[data-archive-vehicle]');if(b)openVehicleEditor(db.vehicles.find(v=>v.id===b.dataset.editVehicle));if(d)archiveRecord('conductor_vehicles',d.dataset.archiveVehicle)};
 $('routesList').onclick=e=>{const b=e.target.closest('[data-edit-route]'),d=e.target.closest('[data-archive-route]');if(b)openRouteEditor(db.routes.find(r=>r.id===b.dataset.editRoute));if(d)archiveRecord('conductor_routes',d.dataset.archiveRoute)};
 $('addNews').onclick=editNews;$('newsList').onclick=e=>{const d=e.target.closest('[data-archive-news]');if(d)archiveRecord('conductor_news',d.dataset.archiveNews)};$('archiveList').onclick=e=>{const b=e.target.closest('[data-restore-table]');if(b)restoreRecord(b.dataset.restoreTable,b.dataset.restoreId,b.dataset.restoreKey)};$('ticketsList').onclick=e=>{const b=e.target.closest('[data-archive-ticket]');if(b)archiveRecord('conductor_tickets',b.dataset.archiveTicket,'ticket_number')};
 $('modalClose').onclick=closeModal;$('modalLayer').onclick=e=>{if(e.target===$('modalLayer'))closeModal()};document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
}
document.addEventListener('DOMContentLoaded',async()=>{
 init();
 try{if(!window.supabase)throw new Error('Supabase SDK не загрузился');client=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:false}});await loadData();startRealtime()}
 catch(e){console.error('Conductor startup error',e);setCloud('Ошибка запуска','error');toast('Ошибка запуска: '+(e.message||String(e)),'error')}
});
})();