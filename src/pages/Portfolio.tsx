import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { setManualPrice } from '../lib/quotes'
import { usePortfolio, type HoldingView } from '../lib/usePortfolio'
import {
  ASSET_CLASS_LABEL,
  CURRENCY_SYMBOL,
  fmtMoney,
  fmtMoneyCompact,
  fmtPct,
  REGION_CURRENCY,
  REGION_FLAG,
  REGION_LABEL,
  REGIONS,
} from '../lib/format'
import Icon from '../components/Icon'
import TopBar from '../components/TopBar'
import type { Currency, Region } from '../types'

const SLICE_COLORS = ['var(--up)', 'var(--down)', 'var(--accent)', 'var(--text-3)']

export default function Portfolio() {
  const p = usePortfolio()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [editKey, setEditKey] = useState('')
  const [editVal, setEditVal] = useState('')

  async function savePrice(h: HoldingView) {
    const v = Number(editVal)
    if (isNaN(v) || v <= 0) return
    // 투자신탁은 1만 구좌당 기준가액으로 입력받아 구좌당 단가로 저장
    await setManualPrice(h, h.assetClass === 'fund' ? v / 10000 : v)
    setEditKey('')
    setEditVal('')
  }
  const region: Region = (['JP', 'KR', 'US'].includes(params.get('r') ?? '') ? params.get('r') : 'JP') as Region
  const regionCur = REGION_CURRENCY[region]
  const summary = p.byRegion[region]

  const holdings = p.holdings.filter((h) => p.regionOf(h.accountId) === region)
  const cashBalances = p.cashBalances.filter((b) => p.regionOf(b.accountId) === region)

  // 지역 내 통화별 배분 (주식 + 현금)
  const byCurrency = new Map<Currency, number>()
  for (const h of holdings) byCurrency.set(h.currency, (byCurrency.get(h.currency) ?? 0) + h.valueKRW)
  for (const b of cashBalances) byCurrency.set(b.currency, (byCurrency.get(b.currency) ?? 0) + b.amountKRW)
  const slices = [...byCurrency.entries()]
    .map(([cur, v]) => ({ cur, v, pct: summary.totalKRW > 0 ? (v / summary.totalKRW) * 100 : 0 }))
    .sort((a, b) => b.v - a.v)
  const CURRENCY_NAME: Record<Currency, string> = { KRW: '원화 ₩', USD: '달러 $', JPY: '엔화 ¥' }

  const C = 2 * Math.PI * 46
  let acc = 0
  const donut = slices.map((s, i) => {
    const len = (s.pct / 100) * C
    const seg = { len, offset: -acc, color: SLICE_COLORS[i % SLICE_COLORS.length] }
    acc += len
    return seg
  })

  // 지역 내 계좌별 집계
  const perAccount = p.accounts
    .filter((a) => (a.region ?? p.regionOf(a.id!)) === region)
    .map((a) => {
      const hs = holdings.filter((h) => h.accountId === a.id)
      const stockKRW = hs.reduce((s, h) => s + h.valueKRW, 0)
      const invested = hs.reduce((s, h) => s + h.invested * (h.valueKRW / (h.value || 1)), 0)
      const gainPct = invested > 0 ? ((stockKRW - invested) / invested) * 100 : 0
      const cash = cashBalances.filter((b) => b.accountId === a.id)
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

  return (
    <main className="page">
      <TopBar title="자산" />

      {/* 국가 선택 */}
      <div className="seg">
        {REGIONS.map((r) => (
          <button key={r} className={region === r ? 'on' : ''} onClick={() => setParams({ r }, { replace: true })}>
            {REGION_FLAG[r]} {REGION_LABEL[r]}
          </button>
        ))}
      </div>

      <div className="card">
        <div className="label">
          {REGION_FLAG[region]} {REGION_LABEL[region]} 자산 · {CURRENCY_SYMBOL[regionCur]} 기준
        </div>
        <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.03em', marginTop: 6, lineHeight: 1 }}>
          {fmtMoney(p.toCurrency(summary.totalKRW, regionCur), regionCur)}
        </div>
        {summary.holdingCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <span className={`chip ${summary.gainKRW >= 0 ? 'up' : 'down'}`}>
              {fmtPct(summary.gainPct)}
            </span>
            <span className="hint">
              주식 평가손익
              {p.main !== regionCur && ` · 메인 통화로 ${fmtMoney(p.toMain(summary.totalKRW), p.main)}`}
            </span>
          </div>
        )}
      </div>

      {!summary.hasData ? (
        <div className="list">
          <div className="empty">
            <Icon name="account_balance_wallet" size={36} />
            <div className="t">{REGION_LABEL[region]} 자산이 아직 없어요</div>
            <div className="s">기록 탭에서 {REGION_LABEL[region]} 계좌를 만들고 입력을 시작해보세요.</div>
            <Link to="/record">
              <button className="btn-primary" style={{ marginTop: 16, width: 'auto', padding: '12px 24px', fontSize: 14 }}>
                기록하러 가기
              </button>
            </Link>
          </div>
        </div>
      ) : (
        <>
          {slices.length > 1 && (
            <div className="card">
              <div className="card-title">통화별 구성</div>
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
                    {CURRENCY_SYMBOL[regionCur]} 환산
                  </text>
                  <text x="60" y="72" textAnchor="middle" style={{ fontSize: 13, fill: 'var(--text)', fontWeight: 800 }}>
                    {fmtMoneyCompact(p.toCurrency(summary.totalKRW, regionCur), regionCur)}
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
          )}

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
                        {a.nisaType === 'ippan' || a.nisaType === 'tsumitate' ? '구NISA' : '신NISA'}
                      </span>
                    )}
                  </div>
                  <div className="item-sub">
                    {a.count > 0 && `${a.count}종목`}
                    {a.tracked && (
                      <>
                        {a.count > 0 && ' · '}
                        <span style={{ color: a.cashNegative ? 'var(--up)' : undefined }}>
                          현금 {a.cashLabel || fmtMoney(0, regionCur)}
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
                  <div className="item-value">{fmtMoney(p.toCurrency(a.value, regionCur), regionCur)}</div>
                  {a.count > 0 && (
                    <div className={`item-ret ${a.gainPct >= 0 ? 'up' : 'down'}`}>{fmtPct(a.gainPct)}</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {holdings.length > 0 && (
            <>
              <div className="section-head">
                <div className="t">종목별</div>
              </div>
              <div className="list">
                {holdings.map((h) => {
                  const key = `${h.accountId}:${h.market}:${h.symbol}`
                  const editing = editKey === key
                  return (
                    <div key={key}>
                      <div
                        className="list-item"
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                          setEditKey(editing ? '' : key)
                          setEditVal('')
                        }}
                      >
                        <div className="item-icon">{h.market}</div>
                        <div className="item-main">
                          <div className="item-name">{h.name}</div>
                          <div className="item-sub">
                            {ASSET_CLASS_LABEL[h.assetClass] ?? '주식'} · 평단{' '}
                            {h.assetClass === 'fund'
                              ? `${fmtMoney(h.avgCost * 10000, h.currency)}(1만구)`
                              : fmtMoney(h.avgCost, h.currency)}{' '}
                            · {h.qty.toLocaleString('ko-KR')}
                            {h.assetClass === 'fund' ? '구' : '주'}
                          </div>
                        </div>
                        <div className="item-right">
                          <div className="item-value">{fmtMoney(h.value, h.currency)}</div>
                          <div className={`item-ret ${h.gain >= 0 ? 'up' : 'down'}`}>
                            {fmtPct(h.gainPct)} · {fmtMoney(h.gain, h.currency)}
                          </div>
                        </div>
                      </div>
                      {editing && (
                        <div className="list-item" style={{ background: 'var(--surface-2)' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                              {(
                                [
                                  ['buy', '➕ 매수 추가'],
                                  ['sell', '매도'],
                                  ['dividend', '배당'],
                                ] as const
                              ).map(([tt, label]) => (
                                <button
                                  key={tt}
                                  className="chip-btn"
                                  style={{ flex: 1, padding: '9px 0' }}
                                  onClick={() =>
                                    navigate(
                                      `/record?t=${tt}&a=${h.accountId}&mk=${h.market}&s=${encodeURIComponent(h.symbol)}`
                                    )
                                  }
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                            <div className="field-label" style={{ marginBottom: 6 }}>
                              {h.assetClass === 'fund' ? '기준가액 (1만 구좌당)' : '현재가'} · {h.currency}
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <div className="input" style={{ flex: 1, padding: '10px 12px' }}>
                                <span className="unit">{CURRENCY_SYMBOL[h.currency]}</span>
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  placeholder={String(
                                    h.assetClass === 'fund' ? Math.round(h.price * 10000) : h.price
                                  )}
                                  value={editVal}
                                  autoFocus
                                  onChange={(e) => setEditVal(e.target.value)}
                                  onKeyDown={(e) => e.key === 'Enter' && savePrice(h)}
                                />
                              </div>
                              <button
                                className="btn-primary"
                                style={{ width: 'auto', padding: '10px 18px', fontSize: 14 }}
                                onClick={() => savePrice(h)}
                              >
                                저장
                              </button>
                            </div>
                            <p className="hint" style={{ marginTop: 6 }}>
                              {h.assetClass === 'fund'
                                ? '증권사 앱에 보이는 기준가액을 그대로 입력하세요'
                                : '시세 새로고침(홈)으로도 자동 갱신됩니다'}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}
    </main>
  )
}
