// A horizontal fork-and-rejoin around the freight machine, not a forced serpentine.
export default function build(s,h) {
  const {solid,ow,spike,note,loot,enemy,bench,secret,route,col}=h;
  solid(s,'courtyard-base',0,37,80,1,'Основание двора');
  solid(s,'west-floor',0,30,24,7,'Входной двор');
  solid(s,'combat-floor',30,30,22,7,'Нижний боевой проход');
  solid(s,'east-floor',58,30,22,7,'Выходной двор');
  solid(s,'freight-machine',32,13,20,6,'Грузовая машина · обход сверху или снизу');
  spike(s,'west-gap',24,36,6);spike(s,'east-gap',52,36,6);
  ow(s,'west-gap-support',25,31,4);ow(s,'east-gap-support',53,31,4);
  // The upper branch is optional; the lower route trades climbing for a stronger encounter.
  [[14,27,6],[18,24,6],[22,21,6],[26,18,5],[26,15,5]].forEach((p,i)=>ow(s,`west-ascent-${i}`,...p));
  [[53,15,5],[57,18,6],[63,21,6],[68,24,6],[71,27,5]].forEach((p,i)=>ow(s,`east-ascent-${i}`,...p));
  enemy(s,'lower-patrol',36,30);
  enemy(s,'lower-heavy',44,30,true);
  enemy(s,'roof-guard',41,13);
  enemy(s,'exit-patrol',69,30);
  loot(s,'roof-chest',48,13,'Сундук на крыше машины');
  bench(s,'entry-bench',16,30);
  // The cache lies behind the start, with a cap joined to the room ceiling.
  solid(s,'cache-cap',10,6,2,20,'Стена грузового склада');
  secret(s,'cache-wall',10,26,2,4);
  loot(s,'cache-chest',4,30,'Сундук в старом складе');
  note(s,'identity',29,2,24,'01  ГРУЗОВОЙ ДВОР');
  note(s,'fork',33,15,18,'Бой снизу / обход по крыше');
}
