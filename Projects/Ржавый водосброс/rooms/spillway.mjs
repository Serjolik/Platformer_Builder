// A descending fork joins a shared combat finish; the outer balconies also carry the return route.
export default function build(s, h) {
  const { solid, ow, spike, note, loot, enemy, bench, secret, item, col } = h;

  solid(s, 'arena-floor', 0, 54, 84, 4, 'Основание разлома и нижний зал');
  spike(s, 'left-pit-floor', 0, 53, 49);
  solid(s, 'entry', 0, 10, 17, 2, 'Вход и обзор разлома');
  ow(s, 'entry-hop', 20, 11, 4);
  // The four-cell opening is the intentional entrance to the inner descent.
  // The outside route jumps across it; the inner route drops without reversing in midair.
  solid(s, 'overlook', 27, 13, 6, 3, 'Развилка двух спусков');
  solid(s, 'outer-approach', 37, 13, 3, 3, 'Выход на внешние балконы');

  // Broad outer landings describe a curved descent around the central pit.
  solid(s, 'outer-1', 44, 19, 14, 2, 'Внешний балкон · первый дозор');
  solid(s, 'outer-2', 60, 27, 14, 2, 'Внешний балкон · передышка');
  solid(s, 'outer-3', 55, 35, 16, 2, 'Внешний балкон · боковой тайник');
  solid(s, 'outer-4', 50, 43, 16, 2, 'Схождение двух маршрутов');
  ow(s, 'common-landing', 49, 50, 10);
  enemy(s, 'outer-watch', 54, 19);
  bench(s, 'outer-rest', 64, 27);
  loot(s, 'outer-find', 69, 35, 'Находка на внешнем балконе');

  // The inner descent is shorter and narrower. Teeth restrict the side margins,
  // while each intended landing stays clear of spikes and combat actors.
  solid(s, 'pit-left-pier', 25, 18, 2, 11, 'Левый край разлома');
  solid(s, 'pit-right-pier', 46, 21, 3, 12, 'Правый край разлома');
  spike(s, 'pit-left-teeth', 27, 19, 1, 7, 'right');
  spike(s, 'pit-right-teeth', 45, 22, 1, 7, 'left');
  ow(s, 'inner-1', 34, 20, 4);
  ow(s, 'inner-2', 30, 26, 4);
  solid(s, 'pit-tooth', 27, 32, 6, 3, 'Камень под внутренним маршрутом');
  spike(s, 'pit-tooth-tip', 27, 31, 6);
  ow(s, 'inner-3', 37, 32, 5);
  solid(s, 'inner-reward', 32, 40, 10, 2, 'Площадка награды в разломе');
  loot(s, 'inner-cache', 36, 40, 'Сундук разлома · награда за риск');
  ow(s, 'inner-out', 45, 45, 5);

  // A roof, floor and breakable front enclose the optional right-hand niche.
  solid(s, 'niche-roof', 76, 6, 8, 26, 'Массив над запечатанной нишей');
  solid(s, 'niche-floor', 75, 38, 9, 2, 'Основание тайника');
  ow(s, 'niche-step', 72, 37, 3);
  secret(s, 'niche-front', 75, 32, 1, 6);
  loot(s, 'niche-cache', 81, 38, 'Тайник за треснувшей стеной');

  // Return around the outer balcony edges rather than through a full-height bypass.
  // The two right-edge steps extend beyond the balcony above for takeoff headroom.
  ow(s, 'return-bottom', 59, 52, 5);
  // Keep the return climb beyond the solid balcony edge, with full jump headroom.
  ow(s, 'return-boarding', 66, 50, 4);
  ow(s, 'return-lower', 66, 47, 4);
  ow(s, 'return-lower-edge', 66, 44, 4);
  ow(s, 'return-niche-edge', 68, 40, 4);
  ow(s, 'return-middle', 55, 32, 4);
  ow(s, 'return-middle-upper', 55, 29, 4);
  ow(s, 'return-upper', 60, 24, 4);
  ow(s, 'return-upper-edge', 60, 21, 4);
  ow(s, 'return-overlook', 41, 16, 3);

  // Both authored descents arrive left of this encounter, with room to retreat.
  enemy(s, 'arena-watch', 64, 54);
  enemy(s, 'arena-guard', 71, 54, true);
  bench(s, 'finish-rest', 78, 54);
  item(s, 'signal', 'goal', 81, 52, 2, 2, 'Сигнальный пост', { color: col.main });

  note(s, 'title', 2, 1, 25, '04  РАЗЛОМ ДВУХ ПУТЕЙ');
  note(s, 'fork-note', 26, 7, 20, 'Развилка: балконы или разлом');
  note(s, 'outside-note', 58, 18, 16, 'Внешний спуск\nШирокие посадки');
  note(s, 'inside-note', 28, 44, 16, 'Короткий путь\nСундук за риск');
  note(s, 'fall-note', 2, 24, 14, 'Падение здесь\nопасно');

}
