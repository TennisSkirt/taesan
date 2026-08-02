import { useState } from 'react'
import { usePortfolio } from '../lib/usePortfolio'
import { convert, fxRate, toKRW } from '../lib/portfolio'
import { CURRENCY_SYMBOL, fmtMoney, NISA_TYPE_LABEL, oldNisaExpiryYear } from '../lib/format'
import type { Currency } from '../types'
import Icon from '../components/Icon'
import TopBar from '../components/TopBar'

const CURRENCIES: Currency[] = ['KRW', 'USD', 'JPY']

function FxCalculator({ main, fx }: { main: Currency; fx: { key: string; rate: number }[] }) {
  const [from, setFrom] = useState<Currency>(main)
  const [to, setTo] = useState<Currency>(main === 'KRW' ? 'JPY' : 'KRW')
  const [amount, setAmount] = useState('')

  const v = Number(amount)
  const ok = amount !== '' && !isNaN(v) && v > 0
  const result = ok ? convert(v, from, to, fx) : 0

  function swap() {
    setFrom(to)
    setTo(from)
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="currency_exchange" size={19} color="var(--accent)" />
        <div className="card-title">환율 계산기</div>
        <div style={{ flex: 1 }} />
        <span className="hint">
          1{CURRENCY_SYMBOL[from]} = {(fxRate(from, fx) / fxRate(to, fx)).toLocaleString('ko-KR', { maximumFractionDigits: 4 })}
          {CURRENCY_SYMBOL[to]}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
        <div className="seg" style={{ flex: 1 }}>
          {CURRENCIES.map((c) => (
            <button key={c} className={from === c ? 'on' : ''} onClick={() => setFrom(c)}>
              {CURRENCY_SYMBOL[c]}
            </button>
          ))}
        </div>
        <button
          className="btn-ghost"
          onClick={swap}
          aria-label="통화 서로 바꾸기"
          style={{ padding: '6px 2px' }}
        >
          <Icon name="swap_horiz" size={22} />
        </button>
        <div className="seg" style={{ flex: 1 }}>
          {CURRENCIES.map((c) => (
            <button key={c} className={to === c ? 'on' : ''} onClick={() => setTo(c)}>
              {CURRENCY_SYMBOL[c]}
            </button>
          ))}
        </div>
      </div>

      <div className="input" style={{ marginTop: 12 }}>
        <span className="unit">{CURRENCY_SYMBOL[from]}</span>
        <input
          type="number"
          inputMode="decimal"
          placeholder={from === 'KRW' ? '1000000' : from === 'USD' ? '1000' : '10000'}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>

      <div
        style={{
          marginTop: 12,
          borderRadius: 14,
          padding: '14px 16px',
          background: 'var(--accent-weak)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span className="label" style={{ color: 'var(--accent)' }}>
          변환 결과
        </span>
        <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--accent)' }}>
          {ok ? fmtMoney(result, to) : '—'}
        </span>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        설정 → 환율 · 통화에서 적용 환율을 직접 수정할 수 있어요.
      </p>
    </div>
  )
}

export default function Analysis() {
  const p = usePortfolio()
  const year = new Date().getFullYear()

  // 월별 배당 (세후, 원화 기준으로 합산 후 메인 통화 표시)
  const monthly = Array.from({ length: 12 }, () => 0)
  for (const d of p.yearDividends) {
    const m = Number(d.date.slice(5, 7)) - 1
    if (m >= 0 && m < 12) monthly[m] += toKRW(d.amountNet, d.currency, p.fx)
  }
  const maxDiv = Math.max(...monthly, 1)
  const bars = monthly.map((v, i) => {
    const h = v === 0 ? 3 : Math.round((v / maxDiv) * 78) + 6
    return {
      x: 4 + i * 24.5,
      y: 92 - h,
      h,
      fill: v >= maxDiv * 0.5 ? 'var(--up)' : v === 0 ? 'var(--surface-3)' : 'var(--up-weak)',
    }
  })

  // 구NISA 비과세 만료 — 구NISA 계좌의 매수 기록을 (종목, 매수연도)별로 묶어 만료 연도 계산
  const nowYear = new Date().getFullYear()
  const oldNisaAccounts = p.accounts.filter(
    (a) => a.nisa && (a.nisaType === 'ippan' || a.nisaType === 'tsumitate')
  )
  const lotMap = new Map<
    string,
    { name: string; accountName: string; nisaType: 'ippan' | 'tsumitate'; buyYear: number; expiry: number; qty: number }
  >()
  for (const t of p.transactions) {
    if (t.type !== 'buy') continue
    const acct = oldNisaAccounts.find((a) => a.id === t.accountId)
    if (!acct) continue
    // 이미 전량 매도한 종목은 제외
    if (!p.holdings.some((h) => h.accountId === t.accountId && h.symbol === t.symbol && h.qty > 0)) continue
    const buyYear = Number(t.date.slice(0, 4))
    const nisaType = acct.nisaType as 'ippan' | 'tsumitate'
    const key = `${t.accountId}:${t.symbol}:${buyYear}`
    const lot = lotMap.get(key)
    if (lot) lot.qty += t.quantity
    else
      lotMap.set(key, {
        name: t.name,
        accountName: acct.name,
        nisaType,
        buyYear,
        expiry: oldNisaExpiryYear(buyYear, nisaType),
        qty: t.quantity,
      })
  }
  const nisaLots = [...lotMap.values()].sort((a, b) => a.expiry - b.expiry)

  // 신NISA 한도 — 연간 360만·생애 1,800만 (취득가 기준)
  const SHIN_ANNUAL = 3_600_000
  const SHIN_LIFETIME = 18_000_000
  const shinIds = new Set(
    p.accounts.filter((a) => a.nisa && (a.nisaType ?? 'shin') === 'shin').map((a) => a.id!)
  )
  const toJPY = (amount: number, cur: Currency) => convert(amount, cur, 'JPY', p.fx)
  const shinYearUsed = p.transactions
    .filter((t) => t.type === 'buy' && shinIds.has(t.accountId) && t.date.startsWith(String(nowYear)))
    .reduce((s, t) => s + toJPY(t.quantity * t.price, t.currency), 0)
  const shinLifetimeUsed = p.holdings
    .filter((h) => shinIds.has(h.accountId))
    .reduce((s, h) => s + toJPY(h.invested, h.currency), 0)

  return (
    <main className="page">
      <TopBar title="분석" />

      {shinIds.size > 0 && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="data_usage" size={19} color="var(--accent)" />
            <div className="card-title">신NISA 한도</div>
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span className="label-sm">올해 투자 ({nowYear})</span>
              <span style={{ fontSize: 13, fontWeight: 700 }}>
                {fmtMoney(shinYearUsed, 'JPY')}
                <span className="hint"> / {fmtMoney(SHIN_ANNUAL, 'JPY')}</span>
              </span>
            </div>
            <div className="progress" style={{ marginTop: 6 }}>
              <div
                className={shinYearUsed > SHIN_ANNUAL ? 'over' : ''}
                style={{ width: `${Math.min(100, (shinYearUsed / SHIN_ANNUAL) * 100)}%` }}
              />
            </div>
            <div className="hint" style={{ marginTop: 4 }}>
              {shinYearUsed >= SHIN_ANNUAL
                ? '올해 한도를 모두 사용했어요'
                : `올해 ${fmtMoney(SHIN_ANNUAL - shinYearUsed, 'JPY')} 더 넣을 수 있어요`}
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span className="label-sm">생애 한도</span>
              <span style={{ fontSize: 13, fontWeight: 700 }}>
                {fmtMoney(shinLifetimeUsed, 'JPY')}
                <span className="hint"> / {fmtMoney(SHIN_LIFETIME, 'JPY')}</span>
              </span>
            </div>
            <div className="progress" style={{ marginTop: 6 }}>
              <div
                className={shinLifetimeUsed > SHIN_LIFETIME ? 'over' : ''}
                style={{ width: `${Math.min(100, (shinLifetimeUsed / SHIN_LIFETIME) * 100)}%` }}
              />
            </div>
            <div className="hint" style={{ marginTop: 4 }}>
              남은 생애 한도 {fmtMoney(Math.max(0, SHIN_LIFETIME - shinLifetimeUsed), 'JPY')}
            </div>
          </div>

          <p className="hint" style={{ marginTop: 12, lineHeight: 1.5 }}>
            취득가 기준, つみたて·성장투자枠 구분 없이 합산한 추정치예요. 매도한 만큼의 생애
            한도는 다음 해에 부활합니다. 정확한 잔여 한도는 증권사 앱 기준으로 확인하세요.
          </p>
        </div>
      )}

      {nisaLots.length > 0 && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="hourglass_bottom" size={19} color="var(--accent)" />
            <div className="card-title">구NISA 비과세 만료</div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {nisaLots.map((l, i) => {
              const status =
                l.expiry < nowYear
                  ? { text: '만료됨 · 과세계좌 이관', color: 'var(--up)', bold: true }
                  : l.expiry === nowYear
                    ? { text: '올해 말 만료!', color: 'var(--up)', bold: true }
                    : { text: `${l.expiry - nowYear}년 남음`, color: 'var(--text-3)', bold: false }
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {l.name}
                    </div>
                    <div className="hint">
                      {l.accountName} · {NISA_TYPE_LABEL[l.nisaType]} · {l.buyYear}년 매수
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flex: 'none' }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{l.expiry}년 말</div>
                    <div style={{ fontSize: 12, fontWeight: status.bold ? 800 : 600, color: status.color }}>
                      {status.text}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <p className="hint" style={{ marginTop: 12, lineHeight: 1.5 }}>
            만료되면 과세계좌로 자동 이관되고, 이관 시점의 시가가 새 취득가가 됩니다. 만료 전에
            계속 보유할지 매도할지 정해두는 게 좋아요.
          </p>
        </div>
      )}

      <FxCalculator key={p.main} main={p.main} fx={p.fx} />

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div className="card-title">배당 캘린더</div>
          <div className="label-sm">
            {year} · 총{' '}
            <span className="up" style={{ fontWeight: 700 }}>
              {fmtMoney(p.toMain(p.divYearKRW), p.main)}
            </span>
          </div>
        </div>
        {p.yearDividends.length > 0 ? (
          <>
            <svg viewBox="0 0 300 96" style={{ width: '100%', height: 96, marginTop: 14, display: 'block' }}>
              {bars.map((b, i) => (
                <rect key={i} x={b.x} y={b.y} width="16" height={b.h} rx="4" fill={b.fill} />
              ))}
            </svg>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2, padding: '0 2px' }}>
              {Array.from({ length: 12 }, (_, i) => (
                <span key={i} className="hint" style={{ fontSize: 9 }}>
                  {i + 1}
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="hint" style={{ marginTop: 12, lineHeight: 1.5 }}>
            기록 탭에서 배당을 입력하면 월별 배당 그래프가 그려집니다.
          </p>
        )}
      </div>

      <div className="card" style={{ opacity: 0.75 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="calculate" size={19} color="var(--accent)" />
          <div className="card-title">매도 세금 계산기</div>
        </div>
        <p className="hint" style={{ marginTop: 8, lineHeight: 1.5 }}>
          "지금 팔면 세금 얼마, 실수령 얼마" — NISA 비과세, 국내 거래세, 해외 양도세 공제까지
          계산해주는 기능. 다음 업데이트에서 제공됩니다.
        </p>
      </div>

      <div className="card" style={{ opacity: 0.75 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="ac_unit" size={19} color="var(--accent)" fill />
          <div className="card-title">배당 스노우볼</div>
        </div>
        <p className="hint" style={{ marginTop: 8, lineHeight: 1.5 }}>
          배당 재투자 + 월 적립 시 10년 뒤 월 배당 시뮬레이션. 다음 업데이트에서 제공됩니다.
        </p>
      </div>
    </main>
  )
}
