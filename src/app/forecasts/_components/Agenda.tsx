'use client';

import { COUNTRIES, YEARS } from '../mock';

// Секция 1 — Повестка: постановка задачи, модель данных, методология.
export default function Agenda() {
  return (
    <div className="fc-goal">
      <div className="q">
        Стоит ли отбирать страны по прогнозам инвестбанков (вайт-лист), или проще
        держать всю вселенную равновесно?
      </div>
      <div>
        Прогноз ИБ — это <b>сигнал с источником</b>, а не обязательно число: банки
        говорят разным языком (<b>overweight/underweight</b>, buy/hold, ожидаемая
        доходность, просто текст). Сводим любой формат к общей шкале (−2…+2),
        храним <b>исходную цитату и ссылку</b>, и проверяем связь <b>сигнал → факт</b>.
      </div>
      <ul>
        <li><b>Вселенная:</b> {COUNTRIES.length} стран — {COUNTRIES.map((c) => c.flag + ' ' + c.name).join(', ')}.</li>
        <li><b>Окно:</b> {YEARS[0]}–{YEARS[YEARS.length - 1]} + поквартальная раскадровка факта.</li>
        <li><b>Прогноз:</b> консенсус нескольких банков на ячейку; чип показывает медиану сигнала, по клику — все цитаты с источниками и датами.</li>
        <li><b>Пропуски — явно:</b> «нет прогноза» / «нет факта» не выдумываем; метрики считаем по парам, где есть оба, и показываем покрытие.</li>
        <li><b>Анализ результата:</b> кросс-секционный <b>Rank IC</b>, спред <b>OW−UW</b>, матрица тиров; числовые метрики — только где банк дал число.</li>
        <li><b>Источник прогнозов (в проде):</b> отдельный англоязычный веб-запрос на каждую (страна×год) через Perplexity Sonar (aimlapi) → текст + ссылки, кэш в БД.</li>
      </ul>
      <div className="fc-pipe">
        <span className="step"><b>1</b> Повестка</span><span className="arr">→</span>
        <span className="step"><b>2</b> Сигнал vs факт (год / кварталы)</span><span className="arr">→</span>
        <span className="step"><b>3</b> Анализ результата</span><span className="arr">→</span>
        <span className="step"><b>4</b> Вайт-лист vs вселенная</span><span className="arr">→</span>
        <span className="step"><b>5</b> AI-резюме</span>
      </div>
    </div>
  );
}
