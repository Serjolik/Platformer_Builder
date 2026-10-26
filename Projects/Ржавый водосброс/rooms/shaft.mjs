// Room C: one open lift shaft with optional side stops, rather than an alternating ascent.
// All coordinates are cells. The moving platform sweeps x22..26, top y10..70.
export default function build(s, h) {
  const { solid, ow, spike, note, loot, enemy, bench, secret, moving, col } = h;

  // A missed boarding lands on a safe base. The lowest lift top is three cells above it.
  solid(s, 'lift-base', 0, 73, 48, 1, 'Дно подъёмника · безопасная страховка');
  solid(s, 'entry-quay', 0, 66, 21, 7, 'Вход и площадка ожидания');
  solid(s, 'lower-right-quay', 27, 66, 21, 7, 'Нижняя сервисная площадка');

  // No fixed geometry enters x21..27: a four-cell lift has a cell of clearance on each side.
  moving(s, 'core-lift', 22, 10.25, 4, 60, 'Подъёмник сердечника · туда и обратно', 'vertical', 4, .5);
  solid(s, 'upper-exit-balcony', 27, 10, 21, 3, 'Верхняя остановка · выход справа');
  solid(s, 'lift-head', 19, 0, 10, 5, 'Кожух привода над ходом подъёмника');

  // First optional stop: a short outward jump, combat on a broad floor, and a catch below the gap.
  solid(s, 'right-boarding', 27, 50, 7, 3, 'Правый карман · ожидание подъёмника');
  solid(s, 'right-workshop', 38, 48, 10, 4, 'Мастерская стража');
  ow(s, 'right-gap-catch', 34, 52, 4);
  enemy(s, 'workshop-guard', 42, 48);
  loot(s, 'workshop-supply', 45, 48, 'Припасы в мастерской');
  spike(s, 'workshop-wall-teeth', 47, 43, 1, 4, 'left');

  // Middle stop: the waiting area and checkpoint stay outside the secret compartment.
  // The compartment is sealed by the room wall, roof, floor and full-height breakable wall.
  solid(s, 'middle-landing', 0, 36, 21, 3, 'Средняя остановка · тихий пост');
  bench(s, 'middle-checkpoint', 15, 36);
  solid(s, 'secret-roof', 0, 27, 11, 3, 'Крыша скрытого отсека');
  secret(s, 'sealed-service-wall', 10, 30, 1, 6);
  loot(s, 'sealed-cache', 4, 36, 'Сундук · запасной сердечник');

  // Upper optional stop: dismount through a OneWay lip, then a two-cell hop onto the gallery.
  solid(s, 'upper-left-gallery', 0, 22, 18, 2, 'Галерея настройщика');
  ow(s, 'upper-left-transfer', 18, 24, 3);
  enemy(s, 'gallery-guard', 8, 22);
  loot(s, 'gallery-cache', 3, 22, 'Награда за верхний карман');
  spike(s, 'gallery-wall-teeth', 0, 17, 1, 4, 'right');

  note(s, 'title', 1, 4, 17, '03  ПОДЪЁМНИК\nСЕРДЕЧНИКА');
  note(s, 'lift-rule', 28, 58, 18, 'Главный путь — подъёмник\nНа площадке можно дождаться возврата');
  note(s, 'middle-stop-label', 1, 41, 18, 'Тихий пост и тайник\nБоковая ветка возвращается к подъёмнику');
  note(s, 'workshop-label', 29, 40, 17, 'Необязательная мастерская\nПрыжок → страж → припасы');
  note(s, 'upper-gallery-label', 1, 12, 17, 'Верхний карман\nСтраж и награда');

}
