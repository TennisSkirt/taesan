import type { FxCache, PriceCache, Transaction } from '../types'
import { toKRW } from './portfolio'

export interface TrendPoint {
  date: string // YYYY-MM-DD
  totalKRW: number
}

/** 거래 이력으로 자산 추이를 재구성 — 월말마다 "보유 수량 × 그 시점까지의 마지막 거래가"로 평가.
 *  마지막 포인트는 현재 시세(캐시)로 계산. 환율은 현재 환율을 적용한 추정치. */
export function computeTrendPoints(
  transactions: Transaction[],
  prices: PriceCache[],
  fx: FxCache[]
): TrendPoint[] {
  if (transactions.length === 0) return []
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date) || (a.id ?? 0) - (b.id ?? 0))

  // 첫 거래 월부터 이번 달까지 월말 날짜 목록
  const firstMonth = sorted[0].date.slice(0, 7)
  const today = new Date()
  const months: string[] = []
  const cur = new Date(Number(firstMonth.slice(0, 4)), Number(firstMonth.slice(5, 7)) - 1, 1)
  while (cur.getFullYear() < today.getFullYear() || (cur.getFullYear() === today.getFullYear() && cur.getMonth() <= today.getMonth())) {
    const lastDay = new Date(cur.getFullYear(), cur.getMonth() + 1, 0)
    months.push(
      `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`
    )
    cur.setMonth(cur.getMonth() + 1)
  }

  interface Pos {
    qty: number
    lastPrice: number
    currency: Transaction['currency']
    market: Transaction['market']
    symbol: string
  }
  const state = new Map<string, Pos>()
  const points: TrendPoint[] = []
  let i = 0
  for (const monthEnd of months) {
    while (i < sorted.length && sorted[i].date <= monthEnd) {
      const t = sorted[i]
      const key = `${t.accountId}:${t.market}:${t.symbol}`
      let pos = state.get(key)
      if (!pos) {
        pos = { qty: 0, lastPrice: t.price, currency: t.currency, market: t.market, symbol: t.symbol }
        state.set(key, pos)
      }
      pos.lastPrice = t.price
      pos.qty += t.type === 'buy' ? t.quantity : -t.quantity
      if (pos.qty < 1e-9) pos.qty = 0
      i++
    }
    let total = 0
    for (const pos of state.values()) {
      if (pos.qty <= 0) continue
      total += toKRW(pos.qty * pos.lastPrice, pos.currency, fx)
    }
    points.push({ date: monthEnd, totalKRW: total })
  }

  // 마지막 포인트는 오늘 + 현재 시세
  let totalNow = 0
  for (const pos of state.values()) {
    if (pos.qty <= 0) continue
    const cached = prices.find((p) => p.key === `${pos.market}:${pos.symbol}`)
    totalNow += toKRW(pos.qty * (cached?.price ?? pos.lastPrice), pos.currency, fx)
  }
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const last = points[points.length - 1]
  if (last) {
    last.date = todayStr
    last.totalKRW = totalNow
  }
  return points
}
