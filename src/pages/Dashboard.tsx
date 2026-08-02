import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { usePortfolio } from '../lib/usePortfolio'
import {
  CURRENCY_LABEL,
  fmtMoney,
  fmtPct,
  fmtSignedMoney,
  REGION_CURRENCY,
  REGION_FLAG,
  REGION_LABEL,
  REGIONS,
  todayStr,
} from '../lib/format'
import Icon from '../components/Icon'
import TopBar from '../components/TopBar'

function greeting(): string {
  const d = new Date()
  const days = ['일', '월', '화', '수', '목', '금', '토']
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 · ${days[d.getDay()]}`
}

export default function Dashboard() {
  const p = usePortfolio()
  const accountName = (id: number) => p.accounts.find((a) => a.id === id)?.name ?? ''
  const snapshots = useLiveQuery(() => db.snapshots.orderBy('date').toArray(), [], [])

  const trend = snapshots.slice(-30)
  const maxV = Math.max(...trend.map((s) => s.totalKRW), 1)
  const minV = Math.min(...trend.map((s) => s.totalKRW), maxV)
  const points = trend.map((s, i) => {
    const x = trend.length > 1 ? (i / (trend.length - 1)) * 300 : 150
    const y = maxV > minV ? 110 - ((s.totalKRW - minV) / (maxV - minV)) * 96 : 60
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  // 데이터가 있으면 오늘 자산 스냅샷 기록 (자산 추이 그래프용)
  useEffect(() => {
    if (!p.hasData || p.totalKRW <= 0) return
    const breakdown: Record<string, number> = {}
    for (const h of p.holdings) {
      breakdown[h.accountId] = (breakdown[h.accountId] ?? 0) + h.valueKRW
    }
    db.snapshots.put({ date: todayStr(), totalKRW: Math.round(p.totalKRW), breakdown })
  }, [p.hasData, p.totalKRW]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="page">
      <TopBar title="태산 🏔️" right={<span className="hint">{greeting()}</span>} />

      <div className="card">
        <div className="label">총자산 · {CURRENCY_LABEL[p.main]} 환산</div>
        <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: '-0.03em', marginTop: 6, lineHeight: 1 }}>
          {fmtMoney(p.toMain(p.totalKRW), p.main)}
        </div>
        {p.hasData ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
            <span className={`chip ${p.totalGainKRW >= 0 ? 'up' : 'down'}`}>
              <Icon name={p.totalGainKRW >= 0 ? 'arrow_drop_up' : 'arrow_drop_down'} size={15} fill />
              {fmtSignedMoney(p.toMain(p.totalGainKRW), p.main)}
            </span>
            <span className="hint">배당 포함 · 전체 기간</span>
          </div>
        ) : (
          <p className="hint" style={{ marginTop: 10, lineHeight: 1.5 }}>
            아직 기록이 없어요. 기록 탭에서 첫 매수를 입력하면
            <br />
            여기에 자산이 쌓이기 시작합니다.
          </p>
        )}
      </div>

      <div className="grid2">
        <div className="card-sm">
          <div className="label-sm">총수익률 · 배당 포함</div>
          <div
            className={p.totalGainKRW >= 0 ? 'up' : 'down'}
            style={{ fontSize: 24, fontWeight: 800, marginTop: 6, letterSpacing: '-0.02em' }}
          >
            {p.hasData ? fmtPct(p.totalGainPct) : '—'}
          </div>
          <div className="hint" style={{ marginTop: 2 }}>
            {p.hasData ? fmtSignedMoney(p.toMain(p.totalGainKRW), p.main) : '기록 후 표시'}
          </div>
        </div>
        <div className="card-sm">
          <div className="label-sm">올해 받은 배당</div>
          <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6, letterSpacing: '-0.02em' }}>
            {fmtMoney(p.toMain(p.divYearKRW), p.main)}
          </div>
          <div className="hint" style={{ marginTop: 2 }}>
            세후 · {p.yearDividends.length}건
          </div>
        </div>
      </div>

      <div className="section-head">
        <div className="t">국가별 자산</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {REGIONS.map((r) => {
          const s = p.byRegion[r]
          const cur = REGION_CURRENCY[r]
          return (
            <Link key={r} to={`/portfolio?r=${r}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="card-sm" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 16px' }}>
                <div className="item-icon" style={{ fontSize: 20, background: 'var(--surface-3)' }}>
                  {REGION_FLAG[r]}
                </div>
                <div className="item-main">
                  <div className="item-name" style={{ fontSize: 14 }}>{REGION_LABEL[r]}</div>
                  <div className="item-sub">
                    {s.hasData
                      ? `${s.holdingCount}종목${p.main !== cur ? ' · ' + fmtMoney(p.toMain(s.totalKRW), p.main) : ''}`
                      : '기록 없음'}
                  </div>
                </div>
                <div className="item-right">
                  <div className="item-value">{fmtMoney(p.toCurrency(s.totalKRW, cur), cur)}</div>
                  {s.holdingCount > 0 && (
                    <div className={`item-ret ${s.gainPct >= 0 ? 'up' : 'down'}`}>{fmtPct(s.gainPct)}</div>
                  )}
                </div>
                <Icon name="chevron_right" size={18} color="var(--text-3)" />
              </div>
            </Link>
          )
        })}
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
            앱을 열 때마다 그날의 자산이 기록됩니다. 이틀째부터 추이 그래프가 그려져요.
          </p>
        )}
      </div>

      <div className="section-head">
        <div className="t">보유 종목</div>
      </div>

      {p.holdings.length > 0 ? (
        <div className="list">
          {p.holdings.map((h) => (
            <div className="list-item" key={`${h.accountId}:${h.market}:${h.symbol}`}>
              <div className="item-icon">{h.market}</div>
              <div className="item-main">
                <div className="item-name">{h.name}</div>
                <div className="item-sub">
                  <b>{accountName(h.accountId)}</b> · {h.qty.toLocaleString('ko-KR')}주
                </div>
              </div>
              <div className="item-right">
                <div className="item-value">{fmtMoney(h.value, h.currency)}</div>
                <div className={`item-ret ${h.gain >= 0 ? 'up' : 'down'}`}>{fmtPct(h.gainPct)}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="list">
          <div className="empty">
            <Icon name="landscape" size={36} fill />
            <div className="t">티끌 모아 태산</div>
            <div className="s">
              기록 탭에서 보유 종목의 매수 내역을 입력해보세요.
              <br />
              수익률과 배당이 자동으로 계산됩니다.
            </div>
            <Link to="/record">
              <button className="btn-primary" style={{ marginTop: 16, width: 'auto', padding: '12px 24px', fontSize: 14 }}>
                첫 기록 남기기
              </button>
            </Link>
          </div>
        </div>
      )}
    </main>
  )
}
