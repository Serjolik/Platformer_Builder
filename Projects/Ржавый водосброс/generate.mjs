import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { normalizeDocument, validateDocument } from '../Затихший узел/tools/model-tools.mjs';
import specs from './region-specs.mjs';
import routeDefinitions from './route-definitions.mjs';
import buildIntake from './rooms/intake.mjs';
import buildReservoir from './rooms/serpent.mjs';
import buildShaft from './rooms/shaft.mjs';
import buildRift from './rooms/spillway.mjs';

// A hand-authored region. Coordinates are cells; this never opens Unreal or browser storage.
const C=32;
const id=k=>{const s=createHash('sha1').update(`RustSpillway:2026-10-25:${k}`).digest('hex');return `${s.slice(0,8)}-${s.slice(8,12)}-5${s.slice(13,16)}-a${s.slice(17,20)}-${s.slice(20,32)}`;};
const col={solid:'#648d89',oneway:'#7db8ee',spike:'#ec866c',main:'#e3c27c',secret:'#ba8edb',loop:'#75c4bb',note:'#b2b5c0'};
const regionId=id('region');
const layers=[{id:'shell',name:'01 · Контуры',visible:true,locked:false},{id:'solid',name:'02 · Массивы и опоры',visible:true,locked:false},{id:'play',name:'03 · Платформинг и опасности',visible:true,locked:false},{id:'actor',name:'04 · Встречи и награды',visible:true,locked:false},{id:'design',name:'05 · Маршруты и пояснения',visible:true,locked:false}];
const doc={version:2,name:'Ржавый водосброс · один регион',grid:C,items:[],paths:[],routes:[],layers,inactiveLayerOpacity:.8,
 blocking:{version:1,enabled:false,centimetersPerCell:100,depthCm:200,wallThicknessCm:20},
 world:{id:id('world'),regions:[{id:regionId,name:'Ржавый водосброс',description:'Один регион с разными маршрутами: развилка вокруг машины, горизонтальные паромы, центральный подъёмник, разветвлённый спуск и секретный фильтр. Враги, сундуки и тайники привязаны к конкретным площадкам.',color:'#628d90',graphPosition:{x:0,y:0}}],rooms:[],start:null,startGraphPosition:{x:-300,y:30},settings:{assetFolder:'/Game/Worlds',transitionTimeout:45,useRoomGraphForPlayerMap:true}}};
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
const note=(s,k,x,y,w,label)=>item(s,k,'note',x,y,w,label.includes('\n')?3:2,label,{noteFontSize:22,layerId:'design',color:col.note});
const loot=(s,k,x,y,label='Сундук с лутом')=>item(s,k,'loot',x,y-1,1,1,label,{color:col.secret});
const enemy=(s,k,x,y,heavy=false)=>item(s,k,'enemy',x,y-1,1,1,heavy?'Страж':'Дозорный',{color:'#de7884',enemyType:heavy?'heavy':'normal'});
const bench=(s,k,x,y)=>item(s,k,'checkpoint',x,y-1,3,1,'Тихий пост',{color:'#8dc5a6'});
const secret=(s,k,x,y,w,h)=>item(s,k,'secret',x,y,w,h,'Треснувшая перегородка',{color:col.secret,layerId:'play'});

const moving=(s,k,x,y,w,h,label,orientation,platformWidth=4,platformHeight=.5)=>item(s,k,'moving',x,y,w,h,label,{color:'#f2b84b',layerId:'play',trackOrientation:orientation,trackPosition:.5,movingPlatformWidth:platformWidth,movingPlatformHeight:platformHeight});
const helpers={solid,ow,spike,note,loot,enemy,bench,secret,moving,item,col};
[buildIntake,buildReservoir,buildShaft,buildRift].forEach((build,i)=>build(specs[i],helpers));
{
 const s=specs[0];
 const start=item(s,'start-marker','transition',13,28,2,2,'Вход Q',{transition:{endpointId:id('start-port'),kind:'entrance'},color:'#8dc5a6'});
 rooms.get(s.key).entrances.push({id:start.transition.endpointId,name:'Вход Q',...arrival});
 doc.world.start={roomId:rooms.get(s.key).id,entranceId:start.transition.endpointId};
}
// FILTER: optional full-height loop, a visible reward and a second breakable niche.
{
 const s=specs[4];solid(s,'base',0,31,40,1);solid(s,'entry',32,26,8,5);solid(s,'low-island',24,25,5,6);ow(s,'low-hop',16,23,5);solid(s,'left-plinth',8,24,5,7);
 spike(s,'lower-pit',13,30,11);ow(s,'pit-recovery',3,28,5);ow(s,'pit-recovery-upper',3,25,5);ow(s,'entry-recovery',29,28,3);
 [[3,21,4],[8,18,5],[3,15,5],[10,13,5]].forEach((p,i)=>ow(s,`rise-${i}`,...p));
 solid(s,'reward',17,12,7,2);ow(s,'return-step',25,20,5);ow(s,'return-step-2',31,23,5);
 solid(s,'secret-ceiling',28,0,2,12);secret(s,'inner-secret',28,12,2,4);solid(s,'secret-base',28,16,12,2,'Ниша за второй стеной');
 // Open space under the niche reconnects to the lower route, without drop-through input.
 enemy(s,'filter-guard',20,12);loot(s,'main-loot',23,12,'Сундук с сердечником фильтра');loot(s,'hidden-loot',35,16,'Тайник за второй стеной');
 note(s,'title',4,5,21,'05  СЛЕПОЙ ФИЛЬТР');note(s,'niche-note',31,6,8,'Тайник');
}
function connect(a,b,port='out',target='in',color=col.main){const r=rooms.get(a),v=r.exits.find(e=>e.id===id(`${a}:port:${port}`));v.connection={...v.connection,enabled:true,targetRoomId:rooms.get(b).id,targetEntranceId:id(`${b}:port:${target}`)};v.graphStyle={color,lineStyle:port==='secret'?'dashed':'solid'};}
connect('intake','serpent');connect('serpent','shaft');connect('shaft','spillway');connect('serpent','filter','secret','in',col.secret);
for(const s of specs) for(const route of routeDefinitions[s.key] ?? []) {
 const colors={main:col.main,optional:'#7db8ee',secret:col.secret,return:col.loop};
 doc.routes.push({id:id(`${s.key}:route:${route.key}`),roomId:rooms.get(s.key).id,name:route.name,kind:route.kind,color:colors[route.kind],visible:route.visible ?? true,points:route.points.map(([x,y])=>({x:x*C,y:y*C}))});
}
const normalized=normalizeDocument(doc), report=validateDocument(normalized);
await writeFile(new URL('./validation.json',import.meta.url),JSON.stringify({...report,document:undefined,blocking:undefined},null,2));
if(!report.ok)throw Error(JSON.stringify(report.errors,null,2));
await writeFile(new URL('./Ржавый водосброс — полный проект.json',import.meta.url),JSON.stringify(normalized,null,2));
console.log(JSON.stringify({rooms:normalized.world.rooms.length,regions:normalized.world.regions.length,items:normalized.items.length,oneway:normalized.items.filter(x=>x.platformMode==='oneway').length,hazards:normalized.items.filter(x=>x.kind==='hazard').length,secrets:normalized.items.filter(x=>x.kind==='secret').length,errors:report.errors.length},null,2));
