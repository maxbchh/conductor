(() => {
'use strict';
const SUPABASE_URL='https://yycaxmfljqzfkjukplkz.supabase.co';
const SUPABASE_KEY='sb_publishable_Ur6yP5_7LQ-9DGmriBJIpw_zIWJiM7T';
const $=id=>document.getElementById(id);
const money=n=>Number(n||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' BYN';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=p=>p+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7);
let db={routes:[],vehicles:[],shifts:[],tickets:[]},client=null,currentShift=null,lastTicket=null,toastTimer;
const statusOptions=['В эксплуатации','На рейсе','Не в эксплуатации','Ремонт','Капитальный ремонт','Списан','Выведен из эксплуатации'];
function toast(s){const el=$('toast');el.textContent=s;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2600)}
function setCloud(s,cls){$('cloudState').className='cloud-state '+cls;$('cloudState').innerHTML='<i></i> '+s}
function showModal(html){$('modalContent').innerHTML=html;$('modalLayer').classList.add('open');$('modalLayer').setAttribute('aria-hidden','false')}
function closeModal(){$('modalLayer').classList.remove('open');$('modalLayer').setAttribute('aria-hidden','true')}
function activeRoute(){return db.routes.find(r=>r.id===$('saleRoute').value)||null}
function activeVehicle(){return currentShift?db.vehicles.find(v=>v.id===currentShift.vehicle_id):null}
function activeTripRoute(){return currentShift?db.routes.find(r=>r.id===currentShift.route_id):null}
function fillSelect(el,items,placeholder){el.innerHTML=placeholder?'<option value="">'+esc(placeholder)+'</option>':'';items.forEach(x=>{const o=document.createElement('option');o.value=x.value;o.textContent=x.label;el.appendChild(o)})}
function renderRouteSelects(){
 const city=$('tripCity').value||'Тверь';
 const routes=db.routes.filter(r=>r.city===city);
 const opts=routes.map(r=>({value:r.id,label:r.name+' · '+r.city}));
 const previous=$('tripRoute').value;fillSelect($('tripRoute'),opts,'Выберите маршрут');if(routes.some(r=>r.id===previous))$('tripRoute').value=previous;
 const saleOpts=db.routes.map(r=>({value:r.id,label:r.name+' · '+r.city}));
 const old=$('saleRoute').value;fillSelect($('saleRoute'),saleOpts,'Выберите маршрут');if(db.routes.some(r=>r.id===old))$('saleRoute').value=old;
 updateSaleStops();renderVehicleSelect();renderInfo();
}
function updateSaleStops(){
 const r=activeRoute(),from=$('saleFrom'),to=$('saleTo');
 const oldFrom=from.value,oldTo=to.value;
 fillSelect(from,(r?.stops||[]).map((s,i)=>({value:String(i),label:(i+1)+'. '+s})),'Начальная остановка');
 fillSelect(to,(r?.stops||[]).map((s,i)=>({value:String(i),label:(i+1)+'. '+s})),'Конечная остановка');
 if(r&&oldFrom!=='')from.value=oldFrom;if(r&&oldTo!=='')to.value=oldTo;
 updateFare();
}
function updateFare(){
 const r=activeRoute(),a=Number($('saleFrom').value),b=Number($('saleTo').value),valid=!!r&&Number.isInteger(a)&&Number.isInteger(b)&&b>a;
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
 $('infoRoute').textContent=route?route.name:'—';$('infoVehicle').textContent=vehicle?(vehicle.number+' · '+vehicle.model):'—';
 $('infoGameTime').textContent=currentShift?.game_time||'—';$('cashContext').textContent=currentShift?'Рейс '+(route?.name||'')+' · '+(vehicle?.number||''):'Смена не открыта';
 $('shiftBadge').textContent=currentShift?'Смена открыта':'Смена закрыта';$('shiftBadge').className='shift-badge '+(currentShift?'open':'closed');
 $('startShift').disabled=!!currentShift;$('endShift').disabled=!currentShift;
}
function renderStats(){
 const tickets=currentShift?db.tickets.filter(t=>t.shift_id===currentShift.id):[];
 $('shiftTickets').textContent=tickets.length;
 $('shiftRevenue').textContent=money(tickets.reduce((s,t)=>s+Number(t.amount||0),0));
}
function renderFleet(){
 const city=$('dbCity').value||'Тверь',q=$('fleetSearch').value.toLowerCase();
 const rows=db.vehicles.filter(v=>v.city===city&&[v.number,v.model,v.status].join(' ').toLowerCase().includes(q));
 $('fleetList').innerHTML=rows.length?'<table><thead><tr><th>Подвижной состав</th><th>Маршруты</th><th>Статус</th><th></th></tr></thead><tbody>'+rows.map(v=>'<tr><td><span class="row-title">'+esc(v.number)+'</span><span class="subtext">'+esc(v.model)+(v.build_date?' · '+esc(v.build_date):'')+'</span></td><td>'+esc((v.routes||[]).join(', ')||'—')+'</td><td><span class="status-tag '+(v.status==='В эксплуатации'?'active':/ремонт/i.test(v.status)?'repair':'')+'">'+esc(v.status)+'</span></td><td><button class="table-action" data-edit-vehicle="'+esc(v.id)+'">Изменить</button></td></tr>').join('')+'</tbody></table>':'<div class="empty-state">В этом парке пока нет подвижного состава</div>';
}
function renderRoutes(){
 const city=$('routesCity').value||'Тверь',rows=db.routes.filter(r=>r.city===city);
 $('routesList').innerHTML=rows.length?'<table><thead><tr><th>Маршрут</th><th>Остановки</th><th>Цена за остановку</th><th></th></tr></thead><tbody>'+rows.map(r=>'<tr><td><span class="row-title">'+esc(r.name)+'</span><span class="subtext">'+esc(r.city)+'</span></td><td>'+((r.stops||[]).length)+' остановок</td><td>'+money(r.fare_per_stop)+'</td><td><button class="table-action" data-edit-route="'+esc(r.id)+'">Изменить</button></td></tr>').join('')+'</tbody></table>':'<div class="empty-state">Маршруты не найдены</div>';
}
function renderTickets(){
 const rows=[...db.tickets].sort((a,b)=>b.ticket_number-a.ticket_number).slice(0,100);
 $('ticketCount').textContent=db.tickets.length+' билетов';
 $('ticketsList').innerHTML=rows.length?'<table><thead><tr><th>Билет</th><th>Маршрут</th><th>Откуда → Куда</th><th>Тариф</th><th>Оплата</th><th>Сумма</th></tr></thead><tbody>'+rows.map(t=>'<tr><td><b>#'+t.ticket_number+'</b><span class="subtext">'+new Date(t.issued_at).toLocaleString('ru-RU')+'</span></td><td>'+esc(t.route_name||'—')+'</td><td>'+esc(t.from_stop)+' → '+esc(t.to_stop)+'</td><td>'+esc(t.fare_type)+'</td><td>'+esc(t.payment_method==='card'?'Карта':'Наличные')+'</td><td><b>'+money(t.amount)+'</b></td></tr>').join('')+'</tbody></table>':'<div class="empty-state">Проданных билетов пока нет</div>';
}
function renderHistory(){
 const rows=[...db.shifts].sort((a,b)=>new Date(b.started_at)-new Date(a.started_at)).slice(0,20);
 $('shiftHistory').innerHTML=rows.length?'<div class="table-wrap"><table><thead><tr><th>Маршрут</th><th>Состав</th><th>Игровое время</th><th>Статус</th><th>Начало</th></tr></thead><tbody>'+rows.map(s=>{const r=db.routes.find(x=>x.id===s.route_id),v=db.vehicles.find(x=>x.id===s.vehicle_id);return '<tr><td>'+esc(r?.name||'—')+'</td><td>'+esc(v?.number||'—')+'</td><td>'+esc(s.game_time||'—')+'</td><td><span class="status-tag '+(s.status==='open'?'active':'')+'">'+(s.status==='open'?'Открыт':'Завершён')+'</span></td><td>'+new Date(s.started_at).toLocaleString('ru-RU')+'</td></tr>'}).join('')+'</tbody></table></div>':'<div class="empty-state">Рейсов пока нет</div>';
}
function renderTicket(t){
 if(!t)return;
 lastTicket=t;
 $('ticketPreview').innerHTML='<b>БИЛЕТ № '+esc(t.ticket_number)+'</b><span>От: '+esc(t.from_stop)+'</span><span>До: '+esc(t.to_stop)+'</span><strong>'+money(t.amount)+'</strong>';
}
function renderAll(){renderRouteSelects();renderFleet();renderRoutes();renderTickets();renderHistory();renderStats();renderInfo()}
function ticketPrint(t){
 if(!t){toast('Сначала продай билет');return}
 let root=document.getElementById('ticketPrintRoot');if(root)root.remove();
 root=document.createElement('div');root.id='ticketPrintRoot';root.innerHTML='<div class="ticket-paper printable"><b>БИЛЕТ № '+esc(t.ticket_number)+'</b><span>От: '+esc(t.from_stop)+'</span><span>До: '+esc(t.to_stop)+'</span><strong>'+money(t.amount)+'</strong></div>';
 document.body.appendChild(root);document.body.classList.add('print-ticket');window.print();
 window.onafterprint=()=>{document.body.classList.remove('print-ticket');root.remove();};
}
function openPayment(){
 const x=updateFare();if(!x.valid){toast('Выбери маршрут и корректные остановки');return}
 if(!currentShift){toast('Сначала открой смену в разделе «Рейсы»');return}
 const fareName=x.mult===.5?'Льготный':x.mult===.75?'Школьный':'Полный';
 showModal('<p class="eyebrow">ПОДТВЕРЖДЕНИЕ ПОКУПКИ</p><h2>Оплата билета</h2><div class="payment-total">'+money(x.total)+'</div><div class="trip-info"><div><small>Маршрут</small><b>'+esc(x.r.name)+'</b></div><div><small>Путь</small><b>'+esc(x.r.stops[x.a])+' → '+esc(x.r.stops[x.b])+'</b></div><div><small>Тариф · количество</small><b>'+fareName+' · '+x.qty+'</b></div></div><label class="field"><span>Получено наличными</span><input id="cashReceived" type="number" min="'+x.total+'" step=".01" value="'+x.total.toFixed(2)+'"></label><div class="quick-cash">'+[1,2,3,4,5,10,15,20,25,30,35,40,45,50].map(n=>'<button type="button" data-cash="'+n+'">'+n+'</button>').join('')+'</div><div class="fare-summary"><div><small>К оплате</small><b>'+money(x.total)+'</b></div><div><small>Получено</small><b id="receivedValue">'+money(x.total)+'</b></div><div class="sum"><small>Сдача</small><b id="changeValue">0,00 BYN</b></div></div><div class="payment-methods"><button id="payCash" class="primary-btn">Наличными</button><button id="payCard" class="secondary-btn">Оплатить картой</button></div><p class="hint">Оплата картой здесь отмечается как безналичная операция внутри симулятора; реальный банковский эквайринг не подключён.</p>');
 const input=$('cashReceived');
 function change(){const received=Math.max(0,Number(input.value)||0);$('receivedValue').textContent=money(received);$('changeValue').textContent=money(Math.max(0,received-x.total));}
 input.addEventListener('input',change);
 document.querySelectorAll('[data-cash]').forEach(b=>b.addEventListener('click',()=>{input.value=Number(b.dataset.cash).toFixed(2);change()}));
 $('payCash').addEventListener('click',()=>{const received=Number(input.value)||0;if(received+0.00001<x.total){toast('Недостаточно наличных');return}completeSale(x,'cash',received)});
 $('payCard').addEventListener('click',()=>completeSale(x,'card',x.total));
}
async function completeSale(x,method,received){
 const button=method==='cash'?$('payCash'):$('payCard');button.disabled=true;button.textContent='Сохранение…';
 try{
  const fareName=x.mult===.5?'Льготный':x.mult===.75?'Школьный':'Полный';
  const rows=Array.from({length:x.qty},()=>({shift_id:currentShift.id,route_id:x.r.id,route_name:x.r.name,from_stop:x.r.stops[x.a],to_stop:x.r.stops[x.b],stop_count:x.stops,fare_type:fareName,fare_multiplier:x.mult,fare_per_stop:x.per,amount:Number((x.stops*x.per*x.mult).toFixed(2)),payment_method:method,cash_received:method==='cash'?received/x.qty:x.total/x.qty,change_due:method==='cash'?Math.max(0,received-x.total)/x.qty:0,game_time:currentShift.game_time}));
  const {data,error}=await client.from('conductor_tickets').insert(rows).select('*');if(error)throw error;
  db.tickets.push(...data);renderTicket(data[0]);closeModal();renderStats();renderTickets();toast('Оплата принята · билет № '+data[0].ticket_number);
 }catch(e){console.error(e);button.disabled=false;button.textContent=method==='cash'?'Наличными':'Оплатить картой';toast('Не удалось сохранить билет: '+(e.message||'ошибка базы'))}
}
function openVehicleEditor(v){
 const edit=!!v;
 showModal('<p class="eyebrow">АВТОБУСНЫЙ ПАРК</p><h2>'+(edit?'Изменить состав':'Добавить подвижной состав')+'</h2><div class="field-grid"><label class="field"><span>Бортовой номер</span><input id="vNumber" value="'+esc(v?.number||'')+'"></label><label class="field"><span>Модель</span><input id="vModel" value="'+esc(v?.model||'')+'"></label><label class="field"><span>Город / парк</span><select id="vCity"><option '+((v?.city||$('dbCity').value)==='Тверь'?'selected':'')+'>Тверь</option><option '+((v?.city||$('dbCity').value)==='Новоозёрск'?'selected':'')+'>Новоозёрск</option></select></label><label class="field"><span>Дата постройки</span><input id="vDate" type="date" value="'+esc(v?.build_date||'')+'"></label><label class="field full"><span>Статус</span><select id="vStatus">'+statusOptions.filter(s=>s!=='На рейсе'||v?.status==='На рейсе').map(s=>'<option '+(s===(v?.status||'В эксплуатации')?'selected':'')+'>'+s+'</option>').join('')+'</select></label><label class="field full"><span>Бригадные маршруты (через запятую)</span><input id="vRoutes" value="'+esc((v?.routes||[]).join(', '))+'"></label><label class="field full"><span>Примечание</span><input id="vNote" value="'+esc(v?.note||'')+'"></label></div><div class="modal-actions"><button id="saveVehicle" class="primary-btn">Сохранить</button></div>');
 $('saveVehicle').onclick=async()=>{const payload={number:$('vNumber').value.trim(),model:$('vModel').value.trim(),city:$('vCity').value,status:$('vStatus').value,build_date:$('vDate').value||null,routes:$('vRoutes').value.split(',').map(s=>s.trim()).filter(Boolean),note:$('vNote').value.trim()};if(!payload.number||!payload.model){toast('Заполни номер и модель');return}try{let q;if(edit)q=await client.from('conductor_vehicles').update(payload).eq('id',v.id).select().single();else q=await client.from('conductor_vehicles').insert({...payload,id:uid('vehicle'),previous_status:payload.status}).select().single();if(q.error)throw q.error;if(edit)db.vehicles=db.vehicles.map(x=>x.id===v.id?q.data:x);else db.vehicles.push(q.data);closeModal();renderAll();toast('Подвижной состав сохранён')}catch(e){toast('Ошибка сохранения: '+e.message)}};
}
function openRouteEditor(r){
 const edit=!!r;
 showModal('<p class="eyebrow">МАРШРУТНАЯ СЕТЬ</p><h2>'+(edit?'Изменить маршрут':'Новый маршрут')+'</h2><div class="field-grid"><label class="field"><span>Номер / название</span><input id="rName" value="'+esc(r?.name||'')+'"></label><label class="field"><span>Город</span><select id="rCity"><option '+((r?.city||$('routesCity').value)==='Тверь'?'selected':'')+'>Тверь</option><option '+((r?.city||$('routesCity').value)==='Новоозёрск'?'selected':'')+'>Новоозёрск</option></select></label><label class="field full"><span>Остановки по порядку — каждая с новой строки</span><textarea id="rStops" rows="7">'+esc((r?.stops||[]).join('\n'))+'</textarea></label><label class="field"><span>Цена за одну остановку (BYN)</span><input id="rFare" type="number" min="0" step=".01" value="'+esc(r?.fare_per_stop??.5)+'"></label></div><div class="modal-actions"><button id="saveRoute" class="primary-btn">Сохранить маршрут</button></div>');
 $('saveRoute').onclick=async()=>{const payload={name:$('rName').value.trim(),city:$('rCity').value,stops:$('rStops').value.split('\n').map(s=>s.trim()).filter(Boolean),fare_per_stop:Math.max(0,Number($('rFare').value)||0)};if(!payload.name||payload.stops.length<2){toast('Нужно название и минимум две остановки');return}try{let q;if(edit)q=await client.from('conductor_routes').update(payload).eq('id',r.id).select().single();else q=await client.from('conductor_routes').insert({...payload,id:uid('route')}).select().single();if(q.error)throw q.error;if(edit)db.routes=db.routes.map(x=>x.id===r.id?q.data:x);else db.routes.push(q.data);closeModal();renderAll();toast('Маршрут сохранён')}catch(e){toast('Ошибка сохранения: '+e.message)}};
}
async function startShift(){
 if(currentShift){toast('Смена уже открыта');return}
 const route=db.routes.find(r=>r.id===$('tripRoute').value),vehicle=db.vehicles.find(v=>v.id===$('tripVehicle').value);
 if(!route||!vehicle){toast('Выбери маршрут и подвижной состав');return}
 const gameTime=$('tripGameTime').value||'08:00';
 try{
  const {data,error}=await client.from('conductor_shifts').insert({id:uid('shift'),route_id:route.id,vehicle_id:vehicle.id,game_time:gameTime,status:'open',started_at:new Date().toISOString(),previous_vehicle_status:vehicle.status}).select().single();if(error)throw error;
  const upd=await client.from('conductor_vehicles').update({status:'На рейсе',previous_status:vehicle.status}).eq('id',vehicle.id).select().single();if(upd.error){await client.from('conductor_shifts').delete().eq('id',data.id);throw upd.error}
  Object.assign(vehicle,upd.data);currentShift=data;db.shifts.unshift(data);renderAll();toast('Смена открыта · рейс '+route.name);
 }catch(e){toast('Не удалось открыть смену: '+e.message)}
}
async function endShift(){
 if(!currentShift)return;
 try{
  const now=new Date().toISOString();const q=await client.from('conductor_shifts').update({status:'closed',ended_at:now}).eq('id',currentShift.id).select().single();if(q.error)throw q.error;
  const vehicle=db.vehicles.find(v=>v.id===currentShift.vehicle_id),restore=vehicle?.previous_status||currentShift.previous_vehicle_status||'В эксплуатации';
  if(vehicle){const u=await client.from('conductor_vehicles').update({status:restore,previous_status:null}).eq('id',vehicle.id).select().single();if(u.error)throw u.error;Object.assign(vehicle,u.data)}
  db.shifts=db.shifts.map(s=>s.id===currentShift.id?q.data:s);currentShift=null;renderAll();toast('Смена завершена и сохранена');
 }catch(e){toast('Ошибка завершения смены: '+e.message)}
}
async function loadData(){
 setCloud('Загрузка базы…','');
 const [r,v,s,t]=await Promise.all([
  client.from('conductor_routes').select('*').order('city').order('name'),
  client.from('conductor_vehicles').select('*').order('city').order('number'),
  client.from('conductor_shifts').select('*').order('started_at',{ascending:false}).limit(100),
  client.from('conductor_tickets').select('*').order('ticket_number',{ascending:false}).limit(500)
 ]);
 for(const x of [r,v,s,t])if(x.error)throw x.error;
 db={routes:r.data||[],vehicles:v.data||[],shifts:s.data||[],tickets:t.data||[]};
 currentShift=db.shifts.find(s=>s.status==='open')||null;
 if(currentShift){const active= db.shifts.filter(s=>s.status==='open');if(active.length>1){console.warn('Several open shifts detected; using newest.')}} 
 setCloud('База синхронизирована','ok');renderAll();
}
function nav(tab){document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id==='view-'+tab))}
function init(){
 $('realClock').textContent=new Date().toLocaleTimeString('ru-RU');setInterval(()=>$('realClock').textContent=new Date().toLocaleTimeString('ru-RU'),1000);
 $('gameClock').textContent='—';
 document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>nav(b.dataset.tab)));
 document.querySelectorAll('[data-goto]').forEach(b=>b.addEventListener('click',()=>nav(b.dataset.goto)));
 document.querySelectorAll('.db-tab').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.db-tab').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.db-view').forEach(x=>x.classList.toggle('active',x.id==='db-'+b.dataset.dbtab))}));
 $('saleRoute').onchange=updateSaleStops;$('saleFrom').onchange=updateFare;$('saleTo').onchange=updateFare;$('saleFare').onchange=updateFare;$('saleQty').oninput=updateFare;
 $('qtyMinus').onclick=()=>{$('saleQty').value=Math.max(1,Number($('saleQty').value)-1);updateFare()};$('qtyPlus').onclick=()=>{$('saleQty').value=Math.min(20,Number($('saleQty').value)+1);updateFare()};
 $('openPayment').onclick=openPayment;$('printTicket').onclick=()=>ticketPrint(lastTicket);
 $('tripCity').onchange=renderRouteSelects;$('tripGameTime').oninput=()=>{if(!currentShift)$('gameClock').textContent=$('tripGameTime').value||'—'};$('startShift').onclick=startShift;$('endShift').onclick=endShift;
 $('dbCity').onchange=renderFleet;$('fleetSearch').oninput=renderFleet;$('routesCity').onchange=renderRoutes;
 $('addVehicle').onclick=()=>openVehicleEditor(null);$('addRoute').onclick=()=>openRouteEditor(null);
 $('fleetList').onclick=e=>{const b=e.target.closest('[data-edit-vehicle]');if(b)openVehicleEditor(db.vehicles.find(v=>v.id===b.dataset.editVehicle))};
 $('routesList').onclick=e=>{const b=e.target.closest('[data-edit-route]');if(b)openRouteEditor(db.routes.find(r=>r.id===b.dataset.editRoute))};
 $('modalClose').onclick=closeModal;$('modalLayer').onclick=e=>{if(e.target===$('modalLayer'))closeModal()};document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
}
document.addEventListener('DOMContentLoaded',async()=>{
 init();
 try{if(!window.supabase)throw new Error('Supabase SDK не загрузился');client=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:false}});await loadData()}
 catch(e){console.error(e);setCloud('Нет соединения с базой','error');toast('Не удалось загрузить базу: '+e.message)}
});
})();