import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { db } from '../db'
import { usePortfolio } from '../lib/usePortfolio'
import { CURRENCY_LABEL, fmtMoney, fmtPct, fmtSignedMoney, todayStr } from '../lib/format'
import Icon from '../components/Icon'

function greeting(): string {
  const d = new Date()
  const days = ['일', '월', '화', '수', '목', '금', '토']
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 · ${days[d.getDay()]}`
}

export default function Dashboard() {
  const p = usePortfolio()
  const accountName = (id: number) => p.accounts.find((a) => a.id === id)?.name ?? ''

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
      <div style={{ paddingTop: 4 }}>
        <div className="label">{greeting()}</div>
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.01em', marginTop: 2 }}>
          태산 🏔️
        </div>
      </div>

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
        <div className="t">보유 종목</div>
        <Link to="/portfolio" className="btn-ghost" style={{ textDecoration: 'none' }}>
          전체보기
          <Icon name="chevron_right" size={16} />
        </Link>
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
