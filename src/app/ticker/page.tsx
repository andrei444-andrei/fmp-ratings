import TickerSearch from './_components/TickerSearch';

const POPULAR: { group: string; items: { s: string; l: string }[] }[] = [
  {
    group: 'Мегакэпы',
    items: [
      { s: 'AAPL', l: 'Apple' }, { s: 'MSFT', l: 'Microsoft' }, { s: 'NVDA', l: 'Nvidia' },
      { s: 'GOOGL', l: 'Alphabet' }, { s: 'AMZN', l: 'Amazon' }, { s: 'META', l: 'Meta' },
      { s: 'TSLA', l: 'Tesla' }, { s: 'BRK-B', l: 'Berkshire' },
    ],
  },
  {
    group: 'Прочие популярные',
    items: [
      { s: 'JPM', l: 'JPMorgan' }, { s: 'V', l: 'Visa' }, { s: 'NFLX', l: 'Netflix' },
      { s: 'AMD', l: 'AMD' }, { s: 'COIN', l: 'Coinbase' }, { s: 'PLTR', l: 'Palantir' },
      { s: 'DIS', l: 'Disney' }, { s: 'KO', l: 'Coca-Cola' },
    ],
  },
  {
    group: 'Индексы / ETF',
    items: [
      { s: 'SPY', l: 'S&P 500' }, { s: 'QQQ', l: 'Nasdaq 100' }, { s: 'IWM', l: 'Russell 2000' },
      { s: 'DIA', l: 'Dow Jones' }, { s: 'GLD', l: 'Золото' }, { s: 'TLT', l: 'Treasuries 20Y' },
    ],
  },
];

export default function TickerLanding() {
  return (
    <main>
      <div className="tk-landing">
        <div className="h">Анализ <b>тикера</b></div>
        <div className="sub">
          Доходность и сравнение с бенчмарком, события (отчётности, дивиденды, макро)
          и summary компании в стиле Bloomberg DES. Введите тикер или название.
        </div>
        <TickerSearch autoFocus />

        <div className="tk-pop">
          {POPULAR.map(g => (
            <div key={g.group}>
              <div className="tk-pop-h">{g.group}</div>
              <div className="tk-pop-grid">
                {g.items.map(it => (
                  <a key={it.s} href={`/ticker/${it.s}`} className="tk-pop-chip">
                    <span className="s">{it.s}</span>
                    <span className="l">{it.l}</span>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
