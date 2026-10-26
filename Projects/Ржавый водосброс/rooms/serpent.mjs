// Two ferry crossings and a reward detour. The previous serpent topology is removed.
export default function build(s,h) {
  const {solid,ow,spike,note,loot,enemy,bench,secret,moving,item,col}=h;
  solid(s,'basin-base',0,48,78,2,'Дно резервуара');
  solid(s,'west-dock',0,28,10,3,'Причал');
  solid(s,'dock-lip',12,28,2,3,'Кромка причала');
  solid(s,'middle-island',30,28,14,20,'Сервисный остров');
  solid(s,'east-dock',64,28,14,20,'Дальний причал');
  spike(s,'west-basin',14,47,16);spike(s,'east-basin',44,47,20);
  moving(s,'west-ferry',17,27.5,10,1,'Паром I','horizontal',4,.5);
  moving(s,'east-ferry',47,27.5,14,1,'Паром II','horizontal',4,.5);
  bench(s,'dock-bench',3,28);
  enemy(s,'island-patrol',37,28);
  enemy(s,'east-heavy',71,28,true);
  loot(s,'east-supplies',75,28,'Сундук на дальнем причале');
  // Optional high branch ends in a sealed reward niche, not at the main exit.
  [[10,25,4],[14,22,4],[20,19,4],[26,16,4]].forEach((p,i)=>ow(s,`roof-route-${i}`,...p));
  solid(s,'upper-walkway',32,15,11,2,'Верхний сервисный мост');
  enemy(s,'upper-patrol',38,15);
  solid(s,'cache-roof-wall',43,0,2,11,'Перегородка до потолка');
  solid(s,'cache-back-wall',56,0,1,15,'Задняя стенка тайника');
  secret(s,'upper-cache-wall',43,11,2,4);
  solid(s,'cache-floor',43,15,14,3,'Пол закрытого тайника');
  loot(s,'upper-cache',52,15,'Сундук за сервисной стеной');
  // One service ladder gives a straightforward return from the hidden lower port.
  solid(s,'filter-landing',0,43,10,5,'Подпричальный карман');
  item(s,'service-ladder','ladder',10,28,2,20,'Сервисная лестница',{layerId:'play',color:col.loop});
  secret(s,'secret-gate',0,39,1,4);
  loot(s,'under-dock-chest',6,43,'Сундук под причалом');
  note(s,'identity',17,5,23,'02  РЕЗЕРВУАР ПАРОМОВ');
  note(s,'ferry-hint',31,34,12,'Остров: бой и ожидание');
}
