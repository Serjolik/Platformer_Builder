import { createHash } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { normalizeDocument, validateDocument } from './tools/model-tools.mjs';

// This file authors a standalone constructor project. It never contacts Unreal or browser storage.
const C = 32;
const uid = key => {
  const hex = createHash('sha1').update(`MapConstructor:QuietJunction:2026-10-22:v1:${key}`).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
};
const colors = { structure:'#83a1ad', floor:'#569e91', main:'#e7c278', loop:'#75c5be', secret:'#bd8cda', danger:'#df8166', enemy:'#d76e7a', note:'#a1b4c7' };
const arrival = {preservePlayerDepth:true,overrideFacing:false,faceRight:true,maximumPlacementAdjustmentCm:50};
const layers = [
  {id:'layer-shells',name:'01 · Контуры',visible:true,locked:false},
  {id:'layer-gameplay',name:'02 · Геометрия',visible:true,locked:false},
  {id:'layer-actors',name:'03 · Сущности',visible:true,locked:false},
  {id:'layer-design',name:'04 · Маршруты и заметки',visible:true,locked:false},
];
const regions = [
  {id:uid('region-depot'),name:'I · Релейное депо',description:'Ориентирование, спокойный узел, выбор пути через галерею и необязательный архив.',color:'#577d85',graphPosition:{x:0,y:0}},
  {id:uid('region-water'),name:'II · Водосбор',description:'Сухие мостки над резервуаром и башня с чередующимися площадками. Промежуточный отдых и верхняя петля возвращения.',color:'#487a9a',graphPosition:{x:420,y:470}},
  {id:uid('region-core'),name:'III · Резонатор',description:'Выбор между боем на полу и верхним обходом; тихая подготовка перед просторной ареной.',color:'#967256',graphPosition:{x:420,y:940}},
];
const doc = {version:2,name:'Затихший узел · блокинг v1',grid:C,items:[],paths:[],layers,inactiveLayerOpacity:.9,
  blocking:{version:1,enabled:false,centimetersPerCell:100,depthCm:200,wallThicknessCm:20},
  world:{id:uid('world'),regions,rooms:[],start:null,startGraphPosition:{x:-290,y:30},settings:{assetFolder:'/Game/Worlds',transitionTimeout:45,useRoomGraphForPlayerMap:true}}};
const specs = [
  {key:'hub',name:'01 · Перрон тишины',region:0,pos:[0,0],graph:[0,0],w:48,h:20,type:'Save',
    poly:[[0,4],[8,4],[8,0],[33,0],[33,4],[48,4],[48,20],[0,20]],
    description:'Спокойный хаб и ориентир. Слева место появления Q и первая скамья, в центре смотритель депо, справа основной выход в галерею. Верхний балкон ведёт к отдельному возвратному пути. Никаких врагов у старта. Основной пол непрерывен; на балкон ведёт лестница. Размеры — исходная гипотеза, не проверенные метрики движения.',
    ports:[['out-main','R',15,18,'exit','В галерею'],['in-loop','R',7,10,'entrance','Верхний возврат']]},
  {key:'gallery',name:'02 · Галерея конвейеров',region:0,pos:[60,0],graph:[420,0],w:76,h:24,type:'Combat',
    poly:[[0,5],[24,5],[24,0],[52,0],[52,5],[76,5],[76,24],[0,24]],
    description:'Три последовательных пролёта: один враг на ровном полу; приподнятая площадка осмотра со следующим противником; пара противников в широком последнем пролёте. Основной путь идёт по полу с невысокими ступенями. Верхние мостки — необязательный обход, награда за исследование и отдельный возврат на перрон. Архив за рывком виден заранее. У входов свободные площадки.',
    ports:[['in-main','L',19,22,'entrance','С перрона'],['out-loop','L',7,10,'exit','Балкон перрона'],['out-main','R',19,22,'exit','К водосбору'],['out-secret','R',9,12,'exit','Архив · рывок']]},
  {key:'archive',name:'03 · Архив эха',region:0,pos:[148,0],graph:[840,0],w:38,h:24,type:'Secret',
    poly:[[0,6],[8,6],[8,0],[30,0],[30,6],[38,6],[38,24],[0,24]],
    description:'Необязательная награда за возвращение с рывком. Тихая комната памяти: центральный NPC и верхняя ниша с лутом, к которой есть лестница. Не нужна для завершения основного маршрута. Условие Dash действительно записано на переходе; выдача способности в водосборе пока только дизайнерская пометка.',
    ports:[['in-secret','L',17,20,'entrance','Из галереи']]},
  {key:'water',name:'04 · Затопленный водосбор',region:1,pos:[60,50],graph:[420,470],w:78,h:32,type:'Normal',
    poly:[[0,6],[12,6],[12,0],[56,0],[56,6],[78,6],[78,32],[0,32]],
    description:'Сначала безопасный обзор резервуара, затем сухой путь по широким мосткам. Под ними находятся страховочные площадки и лестницы возвращения, а не обязательная смерть при ошибке. Нижняя ветка содержит проектную награду «модуль рывка»; выдача способности не реализована конструктором. Справа сухой пост со скамьёй. Верхний путь связывается с отдельной площадкой башни и образует петлю.',
    ports:[['in-main','L',21,24,'entrance','Из галереи'],['out-main','R',21,24,'exit','К основанию башни'],['in-loop','R',9,12,'entrance','Верхний мост башни']]},
  {key:'tower',name:'05 · Башня противовесов',region:1,pos:[148,40],graph:[840,470],w:42,h:60,type:'Normal',
    poly:[[0,0],[42,0],[42,20],[34,20],[34,38],[42,38],[42,60],[0,60],[0,38],[8,38],[8,20],[0,20]],
    description:'Высокий зал с узкой средней шахтой и пятью чередующимися площадками. Основной подъём идёт по существующим лестницам; каждый выход с лестницы имеет место для осмотра. Враги размещены на широких площадках, вдали от их верхних точек. На верхней трети — отдых и проход обратно на верх водосбора. Никакой обязательной механики нового лифта нет.',
    ports:[['in-main','L',55,58,'entrance','Из нижнего водосбора'],['out-loop','L',13,16,'exit','Верхний мост водосбора'],['out-main','R',7,10,'exit','К цеху резонанса']]},
  {key:'forge',name:'06 · Цех резонанса',region:2,pos:[60,115],graph:[420,940],w:82,h:28,type:'Combat',
    poly:[[0,6],[18,6],[26,0],[57,0],[65,6],[82,6],[82,28],[0,28]],
    description:'Три двора вокруг центральной машины. Знакомый враг встречается отдельно; тяжёлый противник стоит на широком помосте с двумя путями отступления; пара обычных завершает участок. В центре можно выбрать прямой бой или необязательный верхний обход. После боя — спокойный выход к посту.',
    ports:[['in-main','L',23,26,'entrance','Из башни'],['out-main','R',23,26,'exit','К посту наблюдателя']]},
  {key:'rest',name:'07 · Пост наблюдателя',region:2,pos:[154,115],graph:[840,940],w:32,h:16,type:'Save',
    poly:[[0,4],[8,4],[8,0],[25,0],[25,4],[32,4],[32,16],[0,16]],
    description:'Короткая безопасная пауза перед боссом. Скамья, NPC и видимый выход к арене. Прямой ровный маршрут без противников и платформинга обеспечивает короткое повторное возвращение к боссу.',
    ports:[['in-main','L',11,14,'entrance','Из цеха'],['out-main','R',11,14,'exit','К сердцу резонатора']]},
  {key:'boss',name:'08 · Сердце резонатора',region:2,pos:[198,115],graph:[1260,940],w:52,h:22,type:'Boss',
    poly:[[0,6],[8,6],[14,0],[40,0],[46,6],[52,6],[52,22],[0,22]],
    description:'Широкая арена без ям и контакта с врагом сразу после входа. Основная боевая полоса 36 клеток, края оставлены для отступления. Две боковые полки дают варианты позиции; центр свободен. Босс и финальный сигнал обозначены маркерами. Запирание арены, награда за победу и поведение босса пока не симулируются.',
    ports:[['in-main','L',17,20,'entrance','С поста наблюдателя']]},
];
const rooms = new Map();
const ids = new Map();
let sequence=0;
function makeItem(spec,kind,x,y,w,h,label,extra={}) {
  const mode = kind==='platform' ? 'solid' : ['note','comment','transition'].includes(kind) ? 'none' : 'blueprint';
  const item={id:uid(`item-${spec.key}-${sequence++}`),kind,label,color:kind==='platform'?colors.floor:kind==='enemy'||kind==='boss'?colors.enemy:kind==='hazard'?colors.danger:kind==='loot'?colors.secret:colors.note,
    x:(spec.pos[0]+x)*C,y:(spec.pos[1]+y)*C,w,h,layerId:kind==='platform'?'layer-gameplay':kind==='note'||kind==='comment'?'layer-design':'layer-actors',
    blocking:{roomId:rooms.get(spec.key).id,mode},attachedRoomId:rooms.get(spec.key).shapeItemId,...extra};
  doc.items.push(item);return item;
}
function buildRoom(spec){
  const room={id:uid(`room-${spec.key}`),name:spec.name,description:spec.description,regionId:regions[spec.region].id,graphPosition:{x:spec.graph[0],y:spec.graph[1]},
    roomType:spec.type,status:'Blockout',designSizeCm:{x:spec.w*100,z:spec.h*100},tags:[],environmentTags:[],shapeItemId:uid(`shape-${spec.key}`),
    blockingOrigin:{x:spec.pos[0]*C,y:(spec.pos[1]+spec.h)*C},entrances:[],exits:[]};
  const ports=spec.ports.map(([name,side,top,bottom,kind,label])=>({name,side,top,bottom,kind,label,id:uid(`endpoint-${spec.key}-${name}`)}));
  const points=[],types=[],bindings=[];
  for(let i=0;i<spec.poly.length;i++){
    const a=spec.poly[i],b=spec.poly[(i+1)%spec.poly.length];
    const candidates=ports.filter(p=>a[0]===b[0]&&a[0]===(p.side==='L'?0:spec.w)&&p.top>=Math.min(a[1],b[1])&&p.bottom<=Math.max(a[1],b[1]));
    const cuts=[a,...candidates.flatMap(p=>[[a[0],p.top],[a[0],p.bottom]]),b]
      .filter((p,index,all)=>all.findIndex(q=>q[0]===p[0]&&q[1]===p[1])===index)
      .sort((p,q)=>((p[0]-a[0])*(b[0]-a[0])+(p[1]-a[1])*(b[1]-a[1]))-((q[0]-a[0])*(b[0]-a[0])+(q[1]-a[1])*(b[1]-a[1])));
    for(let j=0;j<cuts.length-1;j++){
      const p=cuts[j],q=cuts[j+1];
      const portal=candidates.find(port=>Math.min(p[1],q[1])===port.top&&Math.max(p[1],q[1])===port.bottom);
      points.push({x:p[0]*C,y:p[1]*C});types.push(portal?'door':'straight');bindings.push(portal?{endpointId:portal.id,kind:portal.kind}:null);
    }
  }
  for(const p of ports){
    if(!bindings.some(binding=>binding?.endpointId===p.id))throw new Error(`Port outside boundary: ${spec.key}/${p.name}`);
    const endpoint={id:p.id,name:p.label,...arrival,faceRight:p.side==='L'};
    if(p.kind==='entrance')room.entrances.push(endpoint);
    else room.exits.push({...endpoint,connection:{enabled:false,targetRoomId:null,targetEntranceId:null,type:'Passage',requiredTags:[],blockedTags:[],requiredAbilities:[],fadeDuration:.5}});
    ids.set(`${spec.key}/${p.name}`,p.id);
  }
  rooms.set(spec.key,room);doc.world.rooms.push(room);
  doc.items.push({id:room.shapeItemId,kind:'room',label:spec.name,color:colors.structure,x:spec.pos[0]*C,y:spec.pos[1]*C,w:spec.w,h:spec.h,
    polygonPoints:points,sideTypes:types,sideTransitions:bindings,layerId:'layer-shells',blocking:{roomId:room.id,mode:'outline'}});
}
specs.forEach(buildRoom);
function floor(s,x,y,w,h=1,label='Опора'){return makeItem(s,'platform',x,y,w,h,label);}
function ladder(s,x,top,bottom){return makeItem(s,'ladder',x,top,1,bottom-top,'Лестница');}
function enemy(s,x,floorY,heavy=false){return makeItem(s,'enemy',x,floorY-1,1,1,heavy?'Тяжёлый противник':'Обычный противник',{enemyType:heavy?'heavy':'normal'});}
function loot(s,x,floorY,label='Награда за исследование'){return makeItem(s,'loot',x,floorY-1,1,1,label);}
function note(s,x,y,w,label,color=colors.note){return makeItem(s,'note',x,y,w,3,label,{noteFontSize:24,color});}
function checkpoint(s,x,y,label){return makeItem(s,'checkpoint',x,y-1,3,1,label,{color:'#77c8ad'});}
function route(s,points,color=colors.main){
  for(let i=1;i<points.length;i++) doc.paths.push({id:uid(`path-${s.key}-${sequence++}`),kind:'arrow',layerId:'layer-design',color,
    from:{x:(s.pos[0]+points[i-1][0])*C,y:(s.pos[1]+points[i-1][1])*C},to:{x:(s.pos[0]+points[i][0])*C,y:(s.pos[1]+points[i][1])*C}});
}

// 01. Safe hub, lower approach and a separate upper return balcony.
{
 const s=specs[0];floor(s,0,18,48,2,'Ровный перрон');floor(s,30,10,18,1,'Балкон возврата');ladder(s,28,9,18);
 checkpoint(s,11,18,'Скамья · стартовый хаб');makeItem(s,'npc',20,16,1,2,'Смотритель депо',{npcRole:'npc'});
 const marker=makeItem(s,'transition',4,16,2,2,'Пробуждение Q',{transition:{endpointId:uid('endpoint-start'),kind:'entrance'},color:'#80ceb0'});
 rooms.get('hub').entrances.unshift({id:marker.transition.endpointId,name:'Пробуждение Q',...arrival});
 doc.world.start={roomId:rooms.get('hub').id,entranceId:marker.transition.endpointId};
 note(s,10,2,23,'ПЕРРОН ТИШИНЫ\nОтдых · ориентир · возвращение','#91c9b8');
 note(s,31,5,15,'Верхняя петля\nвозвращение из галереи',colors.loop);
 route(s,[[7,15],[22,15],[43,15]]);route(s,[[43,8],[31,8]],colors.loop);
}
// 02. Three combat bays. Floor steps stay small; high traversal is optional.
{
 const s=specs[1];floor(s,0,22,22,2);floor(s,22,21,3,3);floor(s,25,20,22,4);floor(s,47,21,3,3);floor(s,50,22,26,2);
 floor(s,0,10,7,1);floor(s,9,12,14,1);floor(s,26,10,17,1);floor(s,46,12,20,1);floor(s,69,12,7,1);
 ladder(s,7,9,22);ladder(s,67,11,22);
 enemy(s,15,22);enemy(s,35,20);enemy(s,57,22);enemy(s,64,22);
 loot(s,36,10);note(s,26,2,24,'ГАЛЕРЕЯ КОНВЕЙЕРОВ\nТри пролёта · два уровня',colors.main);
 note(s,1,5,20,'Один враг → пауза → пара');note(s,49,6,24,'Архив виден заранее\nветка после рывка',colors.secret);
 route(s,[[3,18],[20,18],[29,16],[43,16],[54,18],[72,18]]);
 route(s,[[63,9],[48,9],[39,7],[28,7],[20,9],[11,9],[4,7]],colors.loop);
}
// 03. Optional quiet reward space, with a distinct elevated memory alcove.
{
 const s=specs[2];floor(s,0,22,38,2);floor(s,0,20,10,2);floor(s,10,18,4,4);floor(s,14,16,9,6);floor(s,23,18,4,4);floor(s,27,20,11,2);
 floor(s,15,8,9,1);ladder(s,25,7,18);makeItem(s,'npc',18,14,1,2,'Свидетель · история узла',{npcRole:'npc'});loot(s,19,8,'Память узла · редкий лут');
 note(s,9,2,21,'АРХИВ ЭХА\nНеобязательная награда',colors.secret);note(s,3,10,10,'Тихая\nистория');
 route(s,[[3,17],[11,15],[18,13]],colors.secret);
}
// 04. Broad dry landings, catch platforms, an optional lower reward and a safe checkpoint.
{
 const s=specs[3];floor(s,0,31,78,1,'Дно резервуара');floor(s,0,24,16,7,'Сухой вход');floor(s,62,24,16,7,'Пост обслуживания');
 floor(s,16,18,10);floor(s,28,17,10);floor(s,40,18,10);floor(s,52,17,8);
 ladder(s,14,17,24);ladder(s,63,16,24);
 floor(s,19,24,14,1,'Страховочная площадка');floor(s,33,24,12,1,'Страховочная площадка');floor(s,45,24,17,1,'Нижняя награда');
 ladder(s,26,16,24);ladder(s,50,16,24);
 ladder(s,18,23,31);
 floor(s,62,12,16,1,'Верхний мост');ladder(s,61,11,24);
 makeItem(s,'liquid',19,28,40,3,'Технический резервуар',{color:'#548bb2',sideTypes:['waves','straight','straight','straight']});
 enemy(s,34,17);enemy(s,56,17);loot(s,46,24,'Модуль рывка · проектная награда');checkpoint(s,69,24,'Скамья · пост водосбора');
 note(s,15,2,37,'ЗАТОПЛЕННЫЙ ВОДОСБОР\nСухой путь сверху · награда снизу',colors.main);
 note(s,31,26,22,'Место выдачи Dash\nнужна игровая реализация',colors.secret);
 route(s,[[3,21],[12,21],[18,15],[33,14],[45,15],[56,14],[67,20],[74,21]]);
 route(s,[[26,21],[37,21],[49,21]],colors.secret);route(s,[[74,9],[65,9]],colors.loop);
}
// 05. Alternating ascent landings. Ladders end beside the top platform, with headroom.
{
 const s=specs[4];floor(s,0,58,42,2);floor(s,4,48,26);floor(s,10,38,22);floor(s,9,28,15);floor(s,12,18,26);
 floor(s,0,16,9,2,'Верхний мост водосбора');floor(s,12,16,5,2,'Подход к верхнему мосту');floor(s,18,10,24);
 ladder(s,31,47,58);ladder(s,9,37,48);ladder(s,25,27,38);ladder(s,10,15,28);ladder(s,17,9,18);
 enemy(s,20,48);enemy(s,26,38);enemy(s,18,28);loot(s,5,16,'Награда за осмотр башни');checkpoint(s,31,18,'Скамья · верхняя площадка');
 note(s,5,2,31,'БАШНЯ ПРОТИВОВЕСОВ\nПодъём · передышка · верхняя петля',colors.main);
 note(s,12,21,20,'Шахта с площадками\nпадение не обнуляет подъём');
 note(s,4,51,23,'Видно следующую\nбезопасную опору');
 route(s,[[3,55],[28,55],[29,45],[11,45],[11,35],[27,35],[27,25],[13,25],[13,15],[19,7],[38,7]]);
 route(s,[[12,13],[3,13]],colors.loop);
}
// 06. An encounter arena around a central machine, with a separate high bypass.
{
 const s=specs[5];floor(s,0,26,82,2,'Основание цеха');floor(s,20,24,4,2);floor(s,24,22,4,4);floor(s,28,20,18,6,'Помост тяжёлого противника');
 floor(s,46,22,4,4);floor(s,50,24,4,2);floor(s,26,12,26,1,'Верхний обход');ladder(s,24,11,22);ladder(s,53,11,24);
 enemy(s,13,26);enemy(s,35,20,true);enemy(s,63,26);enemy(s,71,26);
 loot(s,36,20,'Награда за бой на помосте');loot(s,45,12,'Лут верхнего обхода');
 note(s,28,2,29,'ЦЕХ РЕЗОНАНСА\nПрямой бой или верхний обход',colors.main);
 note(s,2,9,19,'Знакомый враг\nна ровной площадке');note(s,57,8,22,'Последняя пара\nзатем безопасный выход');
 route(s,[[3,23],[17,23],[25,18],[34,17],[43,17],[51,21],[60,23],[77,23]]);
 route(s,[[28,9],[39,9],[49,9]],colors.secret);
}
// 07. Deliberately shorter support room: a clean boss runback, not another traversal obstacle.
{
 const s=specs[6];floor(s,0,14,32,2);checkpoint(s,8,14,'Скамья · перед ареной');makeItem(s,'npc',17,12,1,2,'Наблюдатель',{npcRole:'npc'});
 note(s,8,2,17,'ПОСТ НАБЛЮДАТЕЛЯ\nОтдохнуть перед ареной','#91c9b8');route(s,[[3,11],[14,11],[28,11]]);
}
// 08. Boss silhouette and objective only; no invented runtime locks or reward logic.
{
 const s=specs[7];floor(s,0,20,52,2,'Арена без ям');floor(s,5,12,6,1,'Левая полка');floor(s,41,12,6,1,'Правая полка');
 ladder(s,3,11,20);ladder(s,48,11,20);makeItem(s,'boss',31,16,4,4,'СМОТРИТЕЛЬ РЕЗОНАТОРА');makeItem(s,'goal',47,18,2,2,'Финальный сигнал',{color:'#e7c278'});
 note(s,15,2,24,'СЕРДЦЕ РЕЗОНАТОРА\nШирокая арена · свободный центр',colors.danger);note(s,13,7,20,'36 клеток для боя\nвход вне контакта с боссом');
 route(s,[[3,17],[12,17],[23,17]],colors.main);
}
function connect(fromKey,fromPort,toKey,toPort,{color=colors.main,dashed=false,ability=null,type='Passage'}={}){
  const from=rooms.get(fromKey),to=rooms.get(toKey),exit=from.exits.find(e=>e.id===ids.get(`${fromKey}/${fromPort}`));
  exit.connection={...exit.connection,enabled:true,targetRoomId:to.id,targetEntranceId:ids.get(`${toKey}/${toPort}`),type,requiredAbilities:ability?[ability]:[]};
  exit.graphStyle={color,lineStyle:dashed?'dashed':'solid'};
}
connect('hub','out-main','gallery','in-main');connect('gallery','out-main','water','in-main');connect('water','out-main','tower','in-main');
connect('tower','out-main','forge','in-main');connect('forge','out-main','rest','in-main');connect('rest','out-main','boss','in-main',{type:'Door'});
connect('gallery','out-loop','hub','in-loop',{color:colors.loop,dashed:true});connect('tower','out-loop','water','in-loop',{color:colors.loop,dashed:true});
connect('gallery','out-secret','archive','in-secret',{color:colors.secret,dashed:true,ability:'Dash',type:'Door'});

// Every cross-room endpoint is bound to a specific three-cell opening; start is an interior marker.
const original=JSON.parse(await readFile(new URL('./До переработки — 2026-10-22.json',import.meta.url),'utf8'));
if(original.world.id===doc.world.id)throw new Error('Replacement must not reuse the old world identity.');
const normalized=normalizeDocument(doc);
const report=validateDocument(normalized);
await writeFile(new URL('./validation.json',import.meta.url),JSON.stringify({...report,document:undefined,blocking:undefined},null,2),'utf8');
if(!report.ok)throw new Error(JSON.stringify(report.errors,null,2));
const file=new URL('./Затихший узел — полный проект.json',import.meta.url);
await writeFile(file,JSON.stringify(normalized,null,2),'utf8');
console.log(JSON.stringify({file:fileURLToPath(file),stats:report.stats,warnings:report.warnings},null,2));
