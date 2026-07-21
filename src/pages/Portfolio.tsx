import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { db } from '../db'
import { usePortfolio } from '../lib/usePortfolio'
import { fmtMoney, fmtMoneyCompact, fmtPct, MARKET_LABEL, CURRENCY_SYMBOL } from '../lib/format'
import Icon from '../components/Icon'
import type { Currency } from '../types'

const SLICE_COLORS = ['var(--up)', 'var(--down)', 'var(--accent)', 'var(--text-3)']

export default function Portfolio() {
  const p = usePortfolio()
  const snapshots = useLiveQuery(() => db.snapshots.orderBy('date').toArray(), [], [])

  // 통화별 배분 (주식 + 현금)
  const byCurrency = new Map<Currency, number>()
  for (const h of p.holdings) byCurrency.set(h.currency, (byCurrency.get(h.currency) ?? 0) + h.valueKRW)
  for (const b of p.cashBalances) byCurrency.set(b.currency, (byCurrency.get(b.currency) ?? 0) + b.amountKRW)
  if (p.manualKRW > 0) byCurrency.set('KRW', (byCurrency.get('KRW') ?? 0) + p.manualKRW)
  const slices = [...byCurrency.entries()]
    .map(([cur, v]) => ({ cur, v, pct: p.totalKRW > 0 ? (v / p.totalKRW) * 100 : 0 }))
    .sort((a, b) => b.v - a.v)

  const CURRENCY_NAME: Record<Currency, string> = { KRW: '한국 ₩', USD: '미국 $', JPY: '일본 ¥' }

  // 도넛 dasharray 계산 (r=46, 둘레≈289)
  const C = 2 * Math.PI * 46
  let acc = 0
  const donut = slices.map((s, i) => {
    const len = (s.pct / 100) * C
    const seg = { len, offset: -acc, color: SLICE_COLORS[i % SLICE_COLORS.length] }
    acc += len
    return seg
  })

  // 계좌별 집계 (주식 + 현금)
  const perAccount = p.accounts
    .map((a) => {
      const hs = p.holdings.filter((h) => h.accountId === a.id)
      const stockKRW = hs.reduce((s, h) => s + h.valueKRW, 0)
      const invested = hs.reduce((s, h) => s + h.invested * (h.valueKRW / (h.value || 1)), 0)
      const gainPct = invested > 0 ? ((stockKRW - invested) / invested) * 100 : 0
      const cash = p.cashBalances.filter((b) => b.accountId === a.id)
      const cashKRW = cash.reduce((s, b) => s + b.amountKRW, 0)
      const cashNegative = cash.some((b) => b.amount < 0)
      const cashLabel = cash.map((b) => fmtMoney(b.amount, b.currency)).join(' · ')
      return {
        ...a,
        count: hs.length,
        tracked: p.cashTracked.has(a.id!),
        value: stockKRW + cashKRW,
        gainPct,
        cashLabel,
        cashNegative,
      }
    })
    .filter((a) => a.count > 0 || a.tracked)
    .sort((a, b) => b.value - a.value)

  // 자산 추이 (스냅샷)
  const trend = snapshots.slice(-30)
  const maxV = Math.max(...trend.map((s) => s.totalKRW), 1)
  const minV = Math.min(...trend.map((s) => s.totalKRW), maxV)
  const points = trend.map((s, i) => {
    const x = trend.length > 1 ? (i / (trend.length - 1)) * 300 : 150
    const y = maxV > minV ? 110 - ((s.totalKRW - minV) / (maxV - minV)) * 96 : 60
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  if (!p.hasData) {
    return (
      <main className="page">
        <div className="page-title">자산</div>
        <div className="list">
          <div className="empty">
            <Icon name="account_balance_wallet" size={36} />
            <div className="t">아직 자산이 없어요</div>
            <div className="s">기록 탭에서 매수 내역을 입력하면 배분과 추이가 표시됩니다.</div>
            <Link to="/record">
              <button className="btn-primary" style={{ marginTop: 16, width: 'auto', padding: '12px 24px', fontSize: 14 }}>
                기록하러 가기
              </button>
            </Link>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="page">
      <div className="page-title">자산</div>

      <div className="card">
        <div className="card-title">국가 · 통화별 배분</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 14 }}>
          <svg viewBox="0 0 120 120" style={{ width: 120, height: 120, flex: 'none' }}>
            <circle cx="60" cy="60" r="46" fill="none" stroke="var(--surface-3)" strokeWidth="16" />
            {donut.map((d, i) => (
              <circle
                key={i}
                cx="60"
                cy="60"
                r="46"
                fill="none"
                stroke={d.color}
                strokeWidth="16"
                strokeDasharray={`${d.len} ${C - d.len}`}
                strokeDashoffset={d.offset}
                transform="rotate(-90 60 60)"
              />
            ))}
            <text x="60" y="56" textAnchor="middle" style={{ fontSize: 11, fill: 'var(--text-3)', fontWeight: 600 }}>
              {CURRENCY_SYMBOL[p.main]} 환산
            </text>
            <text x="60" y="72" textAnchor="middle" style={{ fontSize: 13, fill: 'var(--text)', fontWeight: 800 }}>
              {fmtMoneyCompact(p.toMain(p.totalKRW), p.main)}
            </text>
          </svg>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {slices.map((s, i) => (
              <div key={s.cur} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{ width: 10, height: 10, borderRadius: 3, background: SLICE_COLORS[i % SLICE_COLORS.length] }}
                />
                <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{CURRENCY_NAME[s.cur]}</span>
                <span style={{ fontSize: 13, fontWeight: 800 }}>{s.pct.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">자산 추이</div>
        {trend.length >= 2 ? (
          <>
            <svg viewBox="0 0 300 120" style={{ width: '100%', height: 120, marginTop: 12, display: 'block', overflow: 'visible' }}>
              <defs>
                <linearGradient id="trend" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="var(--accent)" stopOpacity=".2" />
                  <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={`M${points.join(' L')} L300,120 L0,120 Z`} fill="url(#trend)" />
              <path
                d={`M${points.join(' L')}`}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <span className="hint" style={{ fontSize: 10 }}>{trend[0].date.slice(2)}</span>
              <span className="hint" style={{ fontSize: 10 }}>{trend[trend.length - 1].date.slice(2)}</span>
            </div>
          </>
        ) : (
          <p className="hint" style={{ marginTop: 10, lineHeight: 1.5 }}>
            앱을 열 때마다 그날의 자산이 기록됩니다.
            <br />
            이틀째부터 추이 그래프가 그려져요.
          </p>
        )}
      </div>

      <div className="section-head">
        <div className="t">계좌별</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {perAccount.map((a) => (
          <div key={a.id} className="card-sm" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 16px' }}>
            <div className="item-icon accent" style={{ width: 38, height: 38, borderRadius: 11 }}>
              <Icon name="account_balance" size={20} />
            </div>
            <div className="item-main">
              <div className="item-name" style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                {a.name}
                {a.nisa && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      padding: '2px 7px',
                      borderRadius: 999,
                      background: 'var(--accent-weak)',
                      color: 'var(--accent)',
                    }}
                  >
                    NISA
                  </span>
                )}
              </div>
              <div className="item-sub">
                {a.count > 0 && `${a.count}종목`}
                {a.tracked && (
                  <>
                    {a.count > 0 && ' · '}
                    <span style={{ color: a.cashNegative ? 'var(--up)' : undefined }}>
                      현금 {a.cashLabel || fmtMoney(0, 'KRW')}
                    </span>
                  </>
                )}
              </div>
              {a.cashNegative && (
                <div className="item-sub" style={{ color: 'var(--up)' }}>
                  잔고가 마이너스예요 — 입금 기록을 확인해보세요
                </div>
              )}
            </div>
            <div className="item-right">
              <div className="item-value">{fmtMoney(p.toMain(a.value), p.main)}</div>
              {a.count > 0 && (
                <div className={`item-ret ${a.gainPct >= 0 ? 'up' : 'down'}`}>{fmtPct(a.gainPct)}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="section-head">
        <div className="t">종목별</div>
      </div>
      <div className="list">
        {p.holdings.map((h) => (
          <div className="list-item" key={`${h.accountId}:${h.market}:${h.symbol}`}>
            <div className="item-icon">{h.market}</div>
            <div className="item-main">
              <div className="item-name">{h.name}</div>
              <div className="item-sub">
                평단 {fmtMoney(h.avgCost, h.currency)} · {h.qty.toLocaleString('ko-KR')}주 ·{' '}
                {MARKET_LABEL[h.market]}
                {CURRENCY_SYMBOL[h.currency]}
              </div>
            </div>
            <div className="item-right">
              <div className="item-value">{fmtMoney(p.toMain(h.valueKRW), p.main)}</div>
              <div className={`item-ret ${h.gain >= 0 ? 'up' : 'down'}`}>
                {fmtPct(h.gainPct)} · {fmtMoney(h.gain, h.currency)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
