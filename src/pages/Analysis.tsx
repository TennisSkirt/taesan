import { useState } from 'react'
import { usePortfolio } from '../lib/usePortfolio'
import { convert, fxRate, toKRW } from '../lib/portfolio'
import { CURRENCY_SYMBOL, fmtMoney } from '../lib/format'
import type { Currency } from '../types'
import Icon from '../components/Icon'

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

  return (
    <main className="page">
      <div className="page-title">분석</div>

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
