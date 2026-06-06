'use client';

import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
  Delta,
  Field,
  FieldError,
  FieldHint,
  Input,
  Label,
  Modal,
  SegmentedControl,
  Select,
  Skeleton,
  Sparkline,
  Stat,
  Switch,
  ToastProvider,
  useToast,
} from '@/components/ui';

/* ───────────────────────── icons ───────────────────────── */
function IconSearch() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="m20 20-3.2-3.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function IconPlus() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
function IconBolt() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" fill="currentColor" />
    </svg>
  );
}

/* ───────────────────────── sample data ───────────────────────── */
const RANGES: { label: string; value: string }[] = [
  { label: '1Д', value: '1d' },
  { label: '1Н', value: '1w' },
  { label: '1М', value: '1m' },
  { label: '1Г', value: '1y' },
];

const SIDES: { label: string; value: 'buy' | 'sell' }[] = [
  { label: 'Купить', value: 'buy' },
  { label: 'Продать', value: 'sell' },
];

const MOVERS = [
  { sym: 'NVDA', name: 'NVIDIA Corp.', price: '$1 204.10', chg: 3.82, spark: [28, 30, 29, 33, 35, 34, 38, 41] },
  { sym: 'AAPL', name: 'Apple Inc.', price: '$229.87', chg: 1.24, spark: [50, 49, 51, 52, 51, 53, 54, 55] },
  { sym: 'AMZN', name: 'Amazon.com', price: '$201.45', chg: 0.62, spark: [40, 41, 40, 42, 41, 43, 43, 44] },
  { sym: 'META', name: 'Meta Platforms', price: '$512.20', chg: -0.94, spark: [60, 61, 59, 58, 59, 57, 56, 55] },
  { sym: 'TSLA', name: 'Tesla Inc.', price: '$176.30', chg: -2.15, spark: [70, 68, 69, 66, 64, 63, 61, 58] },
];

/* ───────────────────────── layout helpers ───────────────────────── */
function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <div className="mb-4 flex items-end justify-between gap-3">
        <h2 className="text-lg sm:text-xl font-semibold tracking-tight text-ink">{title}</h2>
        {hint && <span className="text-xs text-ink-3">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Swatch({ name, hex, varName }: { name: string; hex: string; varName: string }) {
  return (
    <div className="rounded-fk border border-line bg-surface-elev overflow-hidden">
      <div className="h-16" style={{ background: `var(${varName})` }} />
      <div className="px-3 py-2">
        <div className="text-sm font-semibold text-ink">{name}</div>
        <div className="text-xs text-ink-3 tabular-nums uppercase">{hex}</div>
      </div>
    </div>
  );
}

/* ───────────────────────── page ───────────────────────── */
export default function UiKitPage() {
  return (
    <ToastProvider>
      <Showcase />
    </ToastProvider>
  );
}

function Showcase() {
  const { toast } = useToast();
  const [range, setRange] = useState('1m');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [modalOpen, setModalOpen] = useState(false);
  const [alerts, setAlerts] = useState(true);
  const [margin, setMargin] = useState(false);
  const [qty, setQty] = useState('10');
  const [loading, setLoading] = useState(false);

  function fakeOrder() {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      toast({ variant: 'success', title: 'Заявка отправлена', description: `Купить ${qty} × AAPL по рынку` });
    }, 1200);
  }

  return (
    <>
      {/* top bar */}
      <header className="sticky top-0 z-30 border-b border-line bg-[rgba(255,255,255,0.82)] backdrop-blur-md">
        <div className="mx-auto flex max-w-[1200px] items-center gap-3 px-4 py-3 sm:px-6">
          <span className="h-7 w-7 rounded-fk-sm bg-gradient-to-br from-brand to-[#9b8cff] shadow-[0_4px_14px_rgba(109,91,240,0.45)]" />
          <div className="leading-tight">
            <div className="text-sm font-bold text-ink">UX Kit · Финрынки</div>
            <div className="text-[11px] text-ink-3">Светлый финтех</div>
          </div>
          <div className="ml-auto hidden sm:block">
            <Badge variant="up">● Markets open</Badge>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6 sm:py-12 space-y-12 sm:space-y-16">
        {/* hero */}
        <div className="space-y-3">
          <Badge variant="brand">UX Kit v1</Badge>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-ink max-w-2xl">
            Яркий UX-кит для финансовых рынков
          </h1>
          <p className="text-base sm:text-lg text-ink-2 max-w-2xl">
            Крупные элементы, сочные акценты, mobile-first. Палитра, типографика и базовые компоненты —
            фундамент для всех будущих экранов продукта.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button size="lg" leftIcon={<IconBolt />}>Начать</Button>
            <Button size="lg" variant="secondary">Документация</Button>
          </div>
        </div>

        {/* palette */}
        <Section id="palette" title="Палитра" hint="CSS-токены --fk-*">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Swatch name="Brand" hex="#6D5BF0" varName="--fk-brand" />
            <Swatch name="Рост" hex="#12B981" varName="--fk-up" />
            <Swatch name="Падение" hex="#F43F5E" varName="--fk-down" />
            <Swatch name="Warning" hex="#F59E0B" varName="--fk-warn" />
            <Swatch name="Ink" hex="#0F1729" varName="--fk-text" />
            <Swatch name="Surface" hex="#F4F6FB" varName="--fk-bg" />
          </div>
        </Section>

        {/* typography */}
        <Section id="type" title="Типографика" hint="Inter / system">
          <Card>
            <CardContent className="pt-5 space-y-2">
              <p className="text-4xl sm:text-5xl font-bold tracking-tight text-ink">Display 48 · Bold</p>
              <p className="text-2xl font-semibold text-ink">Heading 24 · Semibold</p>
              <p className="text-base text-ink-2">Body 16 — основной текст, описания, абзацы интерфейса.</p>
              <p className="text-sm text-ink-3">Caption 14 — подписи и вторичная информация.</p>
              <p className="text-2xl font-semibold tabular-nums text-ink pt-2">$1 204 567.89 · tabular-nums</p>
            </CardContent>
          </Card>
        </Section>

        {/* KPI stats */}
        <Section id="stats" title="Показатели">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-5">
                <Stat
                  label="Стоимость портфеля"
                  value="$128 540"
                  trend={<Delta value={2.41} percent variant="pill" />}
                  hint="за сегодня"
                />
                <div className="mt-3">
                  <Sparkline data={[20, 22, 21, 24, 26, 25, 28, 31]} width={220} height={44} className="w-full" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <Stat label="P/L за день" value="+$3 021" trend={<Delta value={1.18} percent />} />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <Stat label="Дневной убыток" value="−$842" trend={<Delta value={-0.64} percent />} />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <Stat label="Win rate" value="68%" trend={<Badge variant="up">+4 п.п.</Badge>} hint="30 сделок" />
              </CardContent>
            </Card>
          </div>
        </Section>

        {/* market movers */}
        <Section id="movers" title="Лидеры движения">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <div>
                <CardTitle>Market movers</CardTitle>
                <CardDescription>Топ по объёму торгов</CardDescription>
              </div>
              <SegmentedControl options={RANGES} value={range} onChange={setRange} size="sm" />
            </CardHeader>
            <CardContent className="pt-0 divide-y divide-line">
              {MOVERS.map((m) => (
                <div key={m.sym} className="flex items-center gap-3 sm:gap-4 py-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-fk bg-surface-2 text-xs font-bold text-ink">
                    {m.sym.slice(0, 2)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-ink">{m.sym}</div>
                    <div className="truncate text-xs text-ink-3">{m.name}</div>
                  </div>
                  <Sparkline data={m.spark} width={84} height={32} className="hidden sm:block" />
                  <div className="text-right">
                    <div className="font-semibold tabular-nums text-ink">{m.price}</div>
                    <Delta value={m.chg} percent size="sm" />
                  </div>
                </div>
              ))}
            </CardContent>
            <CardFooter>
              <Button variant="subtle" fullWidth>Показать все</Button>
            </CardFooter>
          </Card>
        </Section>

        {/* buttons */}
        <Section id="buttons" title="Кнопки">
          <Card>
            <CardContent className="pt-5 space-y-5">
              <div className="flex flex-wrap items-center gap-3">
                <Button>Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="subtle">Subtle</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="success" leftIcon={<IconPlus />}>Купить</Button>
                <Button variant="danger">Продать</Button>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm">Small</Button>
                <Button size="md">Medium</Button>
                <Button size="lg">Large</Button>
                <Button loading>Загрузка</Button>
                <Button disabled>Disabled</Button>
              </div>
            </CardContent>
          </Card>
        </Section>

        {/* form / trade ticket */}
        <Section id="forms" title="Формы">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Поля ввода</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field>
                  <Label htmlFor="f-sym">Тикер</Label>
                  <Input id="f-sym" placeholder="Например, AAPL" leftIcon={<IconSearch />} />
                  <FieldHint>Начните вводить символ или название компании.</FieldHint>
                </Field>
                <Field>
                  <Label htmlFor="f-amt">Сумма</Label>
                  <Input id="f-amt" placeholder="0.00" prefix="$" inputMode="decimal" />
                </Field>
                <Field>
                  <Label htmlFor="f-bad">Email для алертов</Label>
                  <Input id="f-bad" defaultValue="не-email" invalid />
                  <FieldError>Введите корректный email.</FieldError>
                </Field>
                <Field>
                  <Label htmlFor="f-cur">Валюта счёта</Label>
                  <Select id="f-cur" defaultValue="usd">
                    <option value="usd">USD — Доллар США</option>
                    <option value="eur">EUR — Евро</option>
                    <option value="rub">RUB — Рубль</option>
                  </Select>
                </Field>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Тикет заявки</CardTitle>
                <CardDescription>AAPL · $229.87</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <SegmentedControl options={SIDES} value={side} onChange={setSide} fullWidth />
                <Field>
                  <Label htmlFor="f-qty">Количество</Label>
                  <Input id="f-qty" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" suffix="шт" />
                </Field>
                <div className="flex items-center justify-between rounded-fk bg-surface-2 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-ink">Маржинальная торговля</div>
                    <div className="text-xs text-ink-3">Плечо до 1:5</div>
                  </div>
                  <Switch checked={margin} onCheckedChange={setMargin} aria-label="Маржа" />
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-ink-2">Оценочная стоимость</span>
                  <span className="font-semibold tabular-nums text-ink">
                    ${(Number(qty || 0) * 229.87).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </CardContent>
              <CardFooter>
                <Button variant="success" fullWidth size="lg" loading={loading} onClick={fakeOrder}>
                  {loading ? 'Отправка…' : 'Разместить заявку'}
                </Button>
              </CardFooter>
            </Card>
          </div>
        </Section>

        {/* badges */}
        <Section id="badges" title="Бейджи и статусы">
          <Card>
            <CardContent className="pt-5 flex flex-wrap items-center gap-3">
              <Badge variant="neutral">Neutral</Badge>
              <Badge variant="brand">Pro</Badge>
              <Badge variant="up">▲ +12.4%</Badge>
              <Badge variant="down">▼ −3.1%</Badge>
              <Badge variant="warn">Volatility</Badge>
              <Delta value={4.2} percent variant="pill" />
              <Delta value={-1.7} percent variant="pill" />
            </CardContent>
          </Card>
        </Section>

        {/* feedback */}
        <Section id="feedback" title="Обратная связь">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Модалка и тосты</CardTitle>
                <CardDescription>Оверлей, bottom-sheet на мобильном, авто-скрытие</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                <Button variant="secondary" onClick={() => setModalOpen(true)}>Открыть модалку</Button>
                <Button variant="success" onClick={() => toast({ variant: 'success', title: 'Успех', description: 'Сделка исполнена.' })}>Toast: success</Button>
                <Button variant="danger" onClick={() => toast({ variant: 'error', title: 'Ошибка', description: 'Недостаточно средств.' })}>Toast: error</Button>
                <Button variant="subtle" onClick={() => toast({ variant: 'info', title: 'Уведомление', description: 'Рынок закроется через 10 минут.' })}>Toast: info</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Состояние загрузки</CardTitle>
                <CardDescription>Skeleton-плейсхолдеры</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-fk-pill" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                  <Skeleton className="h-8 w-16" />
                </div>
                <Skeleton className="h-24 w-full" />
              </CardContent>
            </Card>
          </div>
        </Section>

        <footer className="pt-4 pb-2 text-center text-xs text-ink-3">
          UX Kit · светлый финтех · <code className="text-ink-2">src/components/ui</code>
        </footer>
      </main>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Подтвердите сделку"
        description="Покупка 10 акций AAPL по рыночной цене"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Отмена</Button>
            <Button
              variant="success"
              onClick={() => {
                setModalOpen(false);
                toast({ variant: 'success', title: 'Готово', description: 'Заявка принята в обработку.' });
              }}
            >
              Подтвердить
            </Button>
          </>
        }
      >
        <p>
          Будет исполнено по лучшей доступной цене. Итоговая сумма может незначительно отличаться от оценочной
          из-за движения рынка.
        </p>
      </Modal>
    </>
  );
}
