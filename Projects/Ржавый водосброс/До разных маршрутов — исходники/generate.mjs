import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { normalizeDocument, validateDocument } from '../Затихший узел/tools/model-tools.mjs';

// A hand-authored region. Coordinates are cells; this never opens Unreal or browser storage.
const C=32;
const id=k=>{const s=createHash('sha1').update(`RustSpillway:2026-10-25:${k}`).digest('hex');return `${s.slice(0,8)}-${s.slice(8,12)}-5${s.slice(13,16)}-a${s.slice(17,20)}-${s.slice(20,32)}`;};
const col={solid:'#648d89',oneway:'#7db8ee',spike:'#ec866c',main:'#e3c27c',secret:'#ba8edb',loop:'#75c4bb',note:'#b2b5c0'};
const regionId=id('region');
const specs=[
 {key:'intake',name:'01 · Разбитый перегрузочный зал',pos:[0,0],graph:[0,0],w:64,h:40,type:'Normal',
 poly:[[0,4],[10,4],[14,0],[54,0],[58,4],[64,4],[64,40],[0,40]],
 ports:[['out','R',6,10,'exit','В серпантин']],
 description:'Введение в платформинг региона. Нижняя серия прыжков вправо начинается над безопасным дном; опасность появляется позже. В правом окне подъём через OneWay, затем возврат влево над прежним маршрутом. Слева второй подъём и верхний траверс к выходу. Два сплошных перекрытия задают три яруса. Лестниц на основном маршруте нет. Промежутки, шипы и посадки требуют проверки персонажем.'},
 {key:'serpent',name:'02 · Трёхъярусный серпантин',pos:[76,0],graph:[440,0],w:96,h:48,type:'Normal',
 poly:[[0,0],[96,0],[96,48],[0,48]],
 ports:[['in','L',38,42,'entrance','Из перегрузочного зала'],['out','R',10,14,'exit','В шахту перекрытий'],['secret','L',26,30,'exit','Треснувший фильтр']],
 description:'Длинная S-образная комната из трёх самостоятельных секций: нижние островки над шипами, подъём в правом окне, обратный средний путь по OneWay над зубчатыми участками, передышка и секрет слева, затем подъём и верхняя комбинация прыжков под нависающим массивом. Перекрытия доходят до противоположных стен, поэтому нельзя просто пройти от входа к выходу. Секретная стена закрывает боковой выход; её разрушение обозначено в блокинге, не симулируется приложением.'},
 {key:'shaft',name:'03 · Шахта перекрытий',pos:[188,0],graph:[880,0],w:48,h:70,type:'Normal',
 poly:[[0,0],[48,0],[48,70],[0,70]],
 ports:[['in','L',60,64,'entrance','Из серпантина'],['out','L',8,12,'exit','К ломаному сбросу']],
 description:'Вертикальное испытание без лестниц. Четыре массивных выступа чередуются слева и справа, перекрывая прямой подъём и длинное падение. В торцевых окнах — смещённые OneWay; на выступах — короткие траверсы через шипы. Скамья в среднем левом кармане, передышка наверху перед финалом региона. Боковые шипы показывают опасные границы; рабочий маршрут оставляет место для тела персонажа.'},
 {key:'spillway',name:'04 · Ломаный сброс',pos:[188,86],graph:[880,450],w:92,h:54,type:'Normal',
 poly:[[0,0],[92,0],[92,54],[0,54]],
 ports:[['in','L',6,10,'entrance','С вершины шахты']],
 description:'Финальная комбинация региона. Сначала разорванный верхний мост над шипами, затем спуск через смещённые полки справа. Средний путь идёт обратно влево, за ним второй контролируемый спуск и нижняя серия прыжков вправо к сигнальному посту. Два сплошных перекрытия не дают упасть прямо к цели. OneWay в обоих окнах оставляют путь назад; возврат отмечен бирюзовыми стрелками. Последняя площадка безопасна; следующая область здесь пока не проектируется.'},
 {key:'filter',name:'05 · Слепой фильтр',pos:[124,64],graph:[440,450],w:40,h:32,type:'Secret',
 poly:[[0,4],[8,4],[12,0],[32,0],[36,4],[40,4],[40,32],[0,32]],
 ports:[['in','R',22,26,'entrance','За треснувшим фильтром']],
 description:'Необязательная полноценная комната за секретной стеной среднего яруса. Нижние островки ведут влево, OneWay поднимают по левой стороне к главной награде. Вторая треснувшая перегородка прячет боковую нишу справа. Можно вернуться к тому же входу через промежуточные платформы; нет обязательного рывка или выпадения вниз через OneWay.'},
];
const layers=[{id:'shell',name:'01 · Контуры',visible:true,locked:false},{id:'solid',name:'02 · Массивы и опоры',visible:true,locked:false},{id:'play',name:'03 · Платформинг и опасности',visible:true,locked:false},{id:'actor',name:'04 · Встречи и награды',visible:true,locked:false},{id:'design',name:'05 · Маршруты и пояснения',visible:true,locked:false}];
const doc={version:2,name:'Ржавый водосброс · один регион',grid:C,items:[],paths:[],layers,inactiveLayerOpacity:.8,
 blocking:{version:1,enabled:false,centimetersPerCell:100,depthCm:200,wallThicknessCm:20},
 world:{id:id('world'),regions:[{id:regionId,name:'Ржавый водосброс',description:'Один регион: четыре больших платформенных комнаты и скрытый фильтр. Развитие приёмов: прыжки → OneWay → шипы → смена направления → сочетание в финале.',color:'#628d90',graphPosition:{x:0,y:0}}],rooms:[],start:null,startGraphPosition:{x:-300,y:30},settings:{assetFolder:'/Game/Worlds',transitionTimeout:45,useRoomGraphForPlayerMap:true}}};
const arrival={preservePlayerDepth:true,overrideFacing:false,faceRight:true,maximumPlacementAdjustmentCm:50};
const rooms=new Map();
for(const s of specs){
 const r={id:id(`room:${s.key}`),name:s.name,description:s.description,regionId,graphPosition:{x:s.graph[0],y:s.graph[1]},roomType:s.type,status:'Blockout',designSizeCm:{x:s.w*100,z:s.h*100},tags:[],environmentTags:[],shapeItemId:id(`shape:${s.key}`),blockingOrigin:{x:s.pos[0]*C,y:(s.pos[1]+s.h)*C},entrances:[],exits:[]};
 const ports=s.ports.map(([key,side,top,bottom,kind,name])=>({key,side,top,bottom,kind,name,id:id(`${s.key}:port:${key}`)}));
 const pts=[],types=[],bindings=[];
 for(let i=0;i<s.poly.length;i++){
  const a=s.poly[i],b=s.poly[(i+1)%s.poly.length];
  const ps=ports.filter(p=>a[0]===b[0]&&a[0]===(p.side==='L'?0:s.w)&&p.top>=Math.min(a[1],b[1])&&p.bottom<=Math.max(a[1],b[1]));
  const cuts=[a,...ps.flatMap(p=>[[a[0],p.top],[a[0],p.bottom]]),b].filter((p,i,l)=>l.findIndex(q=>p[0]===q[0]&&p[1]===q[1])===i).sort((p,q)=>(p[0]-q[0])*(b[0]-a[0])+(p[1]-q[1])*(b[1]-a[1]));
  for(let j=0;j<cuts.length-1;j++){
   const p=cuts[j],q=cuts[j+1],port=ps.find(v=>Math.min(p[1],q[1])===v.top&&Math.max(p[1],q[1])===v.bottom);
   pts.push({x:p[0]*C,y:p[1]*C});types.push(port?'opening':'straight');bindings.push(port?{endpointId:port.id,kind:port.kind}:null);
  }
 }
 for(const p of ports){
  if(!bindings.some(v=>v?.endpointId===p.id))throw Error('Port missed '+s.key+p.key);
  const v={id:p.id,name:p.name,...arrival,faceRight:p.side==='L'};
  if(p.kind==='entrance')r.entrances.push(v);else r.exits.push({...v,connection:{enabled:false,targetRoomId:null,targetEntranceId:null,type:'Passage',requiredTags:[],blockedTags:[],requiredAbilities:[],fadeDuration:.5}});
 }
 rooms.set(s.key,r);doc.world.rooms.push(r);
 doc.items.push({id:r.shapeItemId,kind:'room',label:s.name,color:'#91a7ac',x:s.pos[0]*C,y:s.pos[1]*C,w:s.w,h:s.h,polygonPoints:pts,sideTypes:types,sideTransitions:bindings,layerId:'shell',blocking:{roomId:r.id,mode:'outline'}});
}
function item(s,key,kind,x,y,w,h,label,extra={}){
 const room=rooms.get(s.key),mode=kind==='platform'?'solid':['note','comment','transition'].includes(kind)?'none':'blueprint';
 const v={id:id(`${s.key}:item:${key}`),kind,x:(s.pos[0]+x)*C,y:(s.pos[1]+y)*C,w,h,label,color:col.note,layerId:'actor',attachedRoomId:room.shapeItemId,blocking:{roomId:room.id,mode},...extra};doc.items.push(v);return v;
}
const solid=(s,k,x,y,w,h=1,label='Опора')=>item(s,k,'platform',x,y,w,h,label,{color:col.solid,layerId:'solid',platformMode:'normal'});
const ow=(s,k,x,y,w=5)=>item(s,k,'platform',x,y,w,.5,'OneWay',{color:col.oneway,layerId:'play',platformMode:'oneway',blocking:{roomId:rooms.get(s.key).id,mode:'blueprint'}});
const spike=(s,k,x,y,w,h=1,dir='up')=>item(s,k,'hazard',x,y,w,h,'Шипы',{color:col.spike,layerId:'play',hazardDirection:dir});
const note=(s,k,x,y,w,label)=>item(s,k,'note',x,y,w,2,label,{noteFontSize:22,layerId:'design',color:col.note});
const loot=(s,k,x,y,label='Награда')=>item(s,k,'loot',x,y-1,1,1,label,{color:col.secret});
const enemy=(s,k,x,y,heavy=false)=>item(s,k,'enemy',x,y-1,1,1,heavy?'Страж':'Дозорный',{color:'#de7884',enemyType:heavy?'heavy':'normal'});
const bench=(s,k,x,y)=>item(s,k,'checkpoint',x,y-1,3,1,'Тихий пост',{color:'#8dc5a6'});
const secret=(s,k,x,y,w,h)=>item(s,k,'secret',x,y,w,h,'Треснувшая перегородка',{color:col.secret,layerId:'play'});
function route(s,key,points,color=col.main){for(let i=1;i<points.length;i++)doc.paths.push({id:id(`${s.key}:route:${key}:${i}`),kind:'arrow',color,layerId:'design',from:{x:(s.pos[0]+points[i-1][0])*C,y:(s.pos[1]+points[i-1][1])*C},to:{x:(s.pos[0]+points[i][0])*C,y:(s.pos[1]+points[i][1])*C}});}

// INTAKE: three lanes, progressively changing from a safe broken floor to hazard crossings.
{
 const s=specs[0];
 solid(s,'bottom',0,39,64,1,'Дно и страховка');solid(s,'start',0,36,12,3);solid(s,'island-a',15,35,6,4);ow(s,'hop-a',24,33,6);solid(s,'island-b',33,35,7,4);ow(s,'hop-b',43,33,5);solid(s,'right-turn',51,34,13,5);
 solid(s,'lower-baffle',0,22,48,4,'Перекрытие · обход справа');solid(s,'upper-baffle',16,10,48,4,'Перекрытие · обход слева');
 [[54,31,5],[58,28,5],[53,25,5],[49,22,7]].forEach((p,i)=>ow(s,`turn-r-${i}`,...p));
 spike(s,'pit',24,38,9);spike(s,'mid-a',27,21,7);spike(s,'mid-b',8,21,7);ow(s,'over-mid-a',28,19,6);ow(s,'over-mid-b',9,19,5);
 [[3,19,5],[8,16,5],[3,13,5],[9,10,6]].forEach((p,i)=>ow(s,`turn-l-${i}`,...p));
 spike(s,'upper-bed',33,9,8);ow(s,'over-upper',34,7,6);
 // Recover from the first pit without using a ladder or an assumed wall jump.
 ow(s,'recover-first',10,38,4);ow(s,'recover-middle',21,37,3);ow(s,'recover-last',46,37,4);
 bench(s,'bench',3,36);enemy(s,'watcher',55,10);loot(s,'upper-loot',38,7,'Награда за верхний прыжок');
 const start=item(s,'start-marker','transition',1,34,2,2,'Вход Q',{transition:{endpointId:id('start-port'),kind:'entrance'},color:'#8dc5a6'});
 rooms.get(s.key).entrances.push({id:start.transition.endpointId,name:'Вход Q',...arrival});doc.world.start={roomId:rooms.get(s.key).id,entranceId:start.transition.endpointId};
 note(s,'title',17,1,34,'01  ПЕРЕГРУЗОЧНЫЙ ЗАЛ');note(s,'first-beat',2,27,20,'I  Прыжки → первый риск');note(s,'second-beat',4,23,35,'II  Возврат над пройденным');note(s,'third-beat',20,11,30,'III  Шипы + OneWay');
 route(s,'low',[[8,32],[21,31],[37,31],[48,30]]);route(s,'right',[[56,29],[56,24],[47,19]]);route(s,'mid',[[43,17],[35,17],[23,17],[16,17]]);route(s,'left',[[5,20],[6,14],[15,7]]);route(s,'high',[[20,5],[29,5],[44,5],[59,5]]);
}
// SERPENT: the two connected solid baffles force right-left-right traversal.
{
 const s=specs[1];solid(s,'bottom',0,47,96,1,'Основание');solid(s,'low-baffle',0,30,78,4,'Нижнее перекрытие · окно справа');solid(s,'high-baffle',18,14,78,4,'Верхнее перекрытие · окно слева');
 solid(s,'entry',0,42,12,5);solid(s,'low-a',15,40,6,7);ow(s,'low-b',24,38,6);solid(s,'low-c',33,40,6,7);ow(s,'low-d',42,38,6);solid(s,'low-e',51,40,8,7);ow(s,'low-f',62,38,6);solid(s,'low-g',71,40,7,7);solid(s,'low-rest',82,40,14,7);
 spike(s,'low-bed-a',21,46,12);spike(s,'low-bed-b',39,46,12);spike(s,'low-bed-c',59,46,12);
 ow(s,'recovery-entry-1',12,44,3);ow(s,'recovery-entry-2',12,41,3);ow(s,'recovery-turn-1',78,44,4);ow(s,'recovery-turn-2',78,41,4);
 [[84,37,6],[89,34,6],[83,31,6],[76,28,6]].forEach((p,i)=>ow(s,`right-rise-${i}`,...p));
 spike(s,'mid-bed-a',61,29,8);ow(s,'mid-over-a',62,27,6);
 spike(s,'mid-bed-b',40,29,11);ow(s,'mid-over-b',44,27,6);ow(s,'mid-over-c',38,27,5);
 spike(s,'mid-bed-c',19,29,9);ow(s,'mid-over-d',21,27,6);
 [[5,27,6],[10,24,6],[4,21,6],[9,18,6],[3,15,6],[10,12,7]].forEach((p,i)=>ow(s,`left-rise-${i}`,...p));
 spike(s,'upper-bed-a',26,13,10);ow(s,'upper-over-a',28,11,6);
 solid(s,'hanging-machine',43,0,14,6,'Нависающий массив');solid(s,'upper-step',49,11,5,3);
 spike(s,'upper-bed-b',58,13,14);ow(s,'upper-over-b',60,11,5);ow(s,'upper-over-c',68,10,4);
 secret(s,'secret-gate',0,26,1,4);bench(s,'bench',3,30);enemy(s,'upper-guard',82,14);loot(s,'right-pause',90,40,'Запас перед подъёмом');loot(s,'upper-risk',70,10,'Награда за серию');
 note(s,'title',2,1,36,'02  ТРЁХЪЯРУСНЫЙ СЕРПАНТИН');note(s,'baffle-low-label',20,31,42,'I  Островки над шипами → разворот');note(s,'baffle-high-label',23,15,47,'II  Обратный траверс → передышка слева');note(s,'last-label',62,2,30,'III  Комбинация → выход');
 route(s,'low',[[5,37],[20,36],[36,36],[54,36],[75,36],[85,35]]);route(s,'turn-r',[[91,33],[87,29],[76,25]]);route(s,'middle',[[73,25],[57,24],[36,24],[17,24]]);route(s,'turn-l',[[6,25],[7,19],[8,13],[19,9]]);route(s,'upper',[[22,7],[38,7],[48,7],[58,7],[75,7],[90,7]]);route(s,'secret',[[10,27],[2,27]],col.secret);
}
// SHAFT: overlapping fins catch falls and move the ascent window to the opposite side.
{
 const s=specs[2];solid(s,'base',0,68,48,2,'Дно шахты');solid(s,'entry',0,64,14,4);
 solid(s,'fin-1',16,54,32,4,'Перекрытие I');solid(s,'fin-2',0,40,32,4,'Перекрытие II');solid(s,'fin-3',16,26,32,4,'Перекрытие III');solid(s,'fin-4',0,12,32,4,'Верхний карман');
 [[4,61,6],[10,58,5],[4,55,6],[10,52,7]].forEach((p,i)=>ow(s,`rise-1-${i}`,...p));
 [[37,51,6],[42,48,4],[36,45,6],[42,42,4],[35,39,6]].forEach((p,i)=>ow(s,`rise-2-${i}`,...p));
 [[4,37,6],[10,34,5],[4,31,6],[10,28,5],[4,25,6],[11,23,6]].forEach((p,i)=>ow(s,`rise-3-${i}`,...p));
 [[37,23,6],[42,20,4],[36,17,6],[42,14,4],[35,11,6]].forEach((p,i)=>ow(s,`rise-4-${i}`,...p));
 spike(s,'fin-bed-1',24,53,8);ow(s,'fin-over-1',25,51,6);spike(s,'fin-bed-2',14,39,8);ow(s,'fin-over-2',15,37,6);spike(s,'fin-bed-3',22,25,10);ow(s,'fin-over-3',24,23,6);
 spike(s,'left-wall',0,29,1,6,'right');spike(s,'right-wall',47,43,1,5,'left');spike(s,'under-fin',24,58,6,1,'down');
 // A low safety shelf gives a way back from a failed first ascent.
 ow(s,'first-recovery',14,66,5);ow(s,'first-recovery-2',12,63,5);
 bench(s,'middle-bench',4,40);bench(s,'summit-bench',4,12);enemy(s,'landing-guard',36,54);loot(s,'third-ledge-loot',40,26,'Промежуточная находка');
 note(s,'title',5,1,38,'03  ШАХТА ПЕРЕКРЫТИЙ');note(s,'fin-label-1',20,55,24,'I  Смена стороны');note(s,'fin-label-2',2,41,27,'II  Тихий карман');note(s,'fin-label-3',19,27,26,'III  Боковые шипы');
 route(s,'ascent',[[5,60],[8,53],[20,50],[35,50],[40,44],[35,36],[26,35],[9,35],[8,29],[15,21],[32,20],[40,19],[38,8],[25,7],[5,7]]);
}
// SPILLWAY: a descent, reverse traverse, then a lower rising finish; no direct fall to the goal.
{
 const s=specs[3];solid(s,'base',0,52,92,2,'Основание сброса');solid(s,'upper-baffle',0,20,74,4,'Первый отбойник');solid(s,'middle-baffle',18,36,74,4,'Второй отбойник');
 solid(s,'entry',0,10,14,4);ow(s,'bridge-a',17,11,5);solid(s,'bridge-b',25,10,6,3);ow(s,'bridge-c',34,12,5);solid(s,'bridge-d',42,10,6,3);ow(s,'bridge-e',51,11,5);solid(s,'bridge-f',59,12,7,2);ow(s,'bridge-g',67,12,3);solid(s,'bridge-end',72,10,8,4);
 spike(s,'under-bridge',14,19,60);solid(s,'drop-1',84,15,8,3);solid(s,'drop-2',74,24,12,2);solid(s,'drop-3',84,31,8,3);spike(s,'drop-teeth',84,30,2);
 ow(s,'entry-recovery-1',10,17,4);ow(s,'entry-recovery-2',14,14,5);
 // The room connection is reversible: these shelves allow climbing back up both drops.
 [[79,32,4],[89,28,3],[88,25,4],[78,21,5],[78,18,5],[80,12,4]].forEach((p,i)=>ow(s,`right-return-${i}`,...p));
 spike(s,'mid-bed-a',65,35,11);ow(s,'mid-over-a',71,33,6);ow(s,'mid-over-b',64,33,5);spike(s,'mid-bed-b',43,35,12);ow(s,'mid-over-c',49,33,6);ow(s,'mid-over-d',42,33,5);spike(s,'mid-bed-c',23,35,9);ow(s,'mid-over-e',24,33,6);
 solid(s,'drop-left-1',8,38,10,2);solid(s,'drop-left-2',0,43,9,2);solid(s,'drop-left-3',9,47,9,3);
 ow(s,'left-return-low',11,44,5);ow(s,'left-return-high',2,40,5);
 ow(s,'bottom-hop-a',22,47,6);solid(s,'bottom-island-a',32,48,6,4);ow(s,'bottom-hop-b',41,46,6);solid(s,'bottom-island-b',50,47,7,5);ow(s,'bottom-hop-c',60,47,6);solid(s,'bottom-island-c',70,49,7,3);solid(s,'finish',80,48,12,4);
 spike(s,'bottom-bed-a',20,51,10);spike(s,'bottom-bed-b',38,51,12);spike(s,'bottom-bed-c',58,51,12);
 solid(s,'left-catch',0,50,20,2,'Безопасный пол под спуском');ow(s,'bottom-recovery',30,50,2);
 bench(s,'finish-bench',82,48);item(s,'signal','goal',87,46,2,2,'Сигнальный пост',{color:col.main});loot(s,'bridge-loot',45,10,'Награда на разорванном мосту');loot(s,'middle-loot',40,36,'Награда за обратный путь');
 note(s,'title',17,1,53,'04  ЛОМАНЫЙ СБРОС');note(s,'baffle-1-label',12,21,50,'I  Разорванный мост → управляемый спуск');note(s,'baffle-2-label',24,37,51,'II  Обратно влево → нижняя серия прыжков');
 route(s,'top',[[6,6],[23,6],[40,6],[57,7],[75,6],[86,11]]);route(s,'drop-r',[[88,19],[81,21],[89,28],[86,32]]);route(s,'mid',[[82,30],[62,29],[40,29],[20,30],[11,34]]);route(s,'drop-l',[[6,39],[12,44]]);route(s,'bottom',[[16,43],[30,44],[46,42],[62,43],[76,45],[87,44]]);
 route(s,'return-l',[[14,46],[12,42],[4,37],[17,34]],col.loop);route(s,'return-r',[[80,32],[90,27],[88,23],[80,19],[81,12]],col.loop);
}
// FILTER: optional full-height loop, a visible reward and a second breakable niche.
{
 const s=specs[4];solid(s,'base',0,31,40,1);solid(s,'entry',32,26,8,5);solid(s,'low-island',24,25,5,6);ow(s,'low-hop',16,23,5);solid(s,'left-plinth',8,24,5,7);
 spike(s,'lower-pit',13,30,11);ow(s,'pit-recovery',3,28,5);ow(s,'pit-recovery-upper',3,25,5);ow(s,'entry-recovery',29,28,3);
 [[3,21,4],[8,18,5],[3,15,5],[10,13,5]].forEach((p,i)=>ow(s,`rise-${i}`,...p));
 solid(s,'reward',17,12,7,2);ow(s,'return-step',25,20,5);ow(s,'return-step-2',31,23,5);
 solid(s,'secret-ceiling',28,0,2,12);secret(s,'inner-secret',28,12,2,4);solid(s,'secret-base',28,16,12,2,'Ниша за второй стеной');
 // Open space under the niche reconnects to the lower route, without drop-through input.
 loot(s,'main-loot',20,12,'Сердечник фильтра');loot(s,'hidden-loot',35,16,'Тайник за второй стеной');
 note(s,'title',4,5,21,'05  СЛЕПОЙ ФИЛЬТР');note(s,'niche-note',31,6,8,'Тайник');
 route(s,'lower',[[36,22],[25,21],[11,20]],col.secret);route(s,'rise',[[5,20],[6,14],[18,9]],col.secret);route(s,'return',[[21,16],[26,17],[36,22]],col.loop);
}
function connect(a,b,port='out',target='in',color=col.main){const r=rooms.get(a),v=r.exits.find(e=>e.id===id(`${a}:port:${port}`));v.connection={...v.connection,enabled:true,targetRoomId:rooms.get(b).id,targetEntranceId:id(`${b}:port:${target}`)};v.graphStyle={color,lineStyle:port==='secret'?'dashed':'solid'};}
connect('intake','serpent');connect('serpent','shaft');connect('shaft','spillway');connect('serpent','filter','secret','in',col.secret);
const normalized=normalizeDocument(doc), report=validateDocument(normalized);
await writeFile(new URL('./validation.json',import.meta.url),JSON.stringify({...report,document:undefined,blocking:undefined},null,2));
if(!report.ok)throw Error(JSON.stringify(report.errors,null,2));
await writeFile(new URL('./Ржавый водосброс — полный проект.json',import.meta.url),JSON.stringify(normalized,null,2));
console.log(JSON.stringify({rooms:normalized.world.rooms.length,regions:normalized.world.regions.length,items:normalized.items.length,oneway:normalized.items.filter(x=>x.platformMode==='oneway').length,hazards:normalized.items.filter(x=>x.kind==='hazard').length,secrets:normalized.items.filter(x=>x.kind==='secret').length,errors:report.errors.length},null,2));
