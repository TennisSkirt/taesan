import type { AssetClass, CashTx, Currency, Dividend, Market, PriceCache, Transaction } from '../types'

export interface Holding {
  accountId: number
  market: Market
  symbol: string
  name: string
  currency: Currency
  assetClass: AssetClass
  qty: number
  avgCost: number
  /** 현재 보유분 취득원가 (수수료 포함) */
  invested: number
  /** 실현손익 (수수료 차감, 종목 통화) */
  realized: number
  /** 최근 거래 단가 — 시세 캐시가 있으면 그걸로 대체 */
  lastPrice: number
}

export function holdingKey(market: Market, symbol: string): string {
  return `${market}:${symbol}`
}

/** 거래 내역에서 보유 현황 파생 계산 (이동평균법) */
export function computeHoldings(txs: Transaction[]): Holding[] {
  const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date) || (a.id ?? 0) - (b.id ?? 0))
  const map = new Map<string, Holding>()
  for (const t of sorted) {
    const key = `${t.accountId}:${t.market}:${t.symbol}`
    let h = map.get(key)
    if (!h) {
      h = {
        accountId: t.accountId,
        market: t.market,
        symbol: t.symbol,
        name: t.name,
        currency: t.currency,
        assetClass: t.assetClass,
        qty: 0,
        avgCost: 0,
        invested: 0,
        realized: 0,
        lastPrice: t.price,
      }
      map.set(key, h)
    }
    h.name = t.name
    h.lastPrice = t.price
    if (t.type === 'buy') {
      h.invested += t.quantity * t.price + (t.fee || 0)
      h.qty += t.quantity
      h.avgCost = h.qty > 0 ? h.invested / h.qty : 0
    } else {
      h.realized += t.quantity * (t.price - h.avgCost) - (t.fee || 0)
      h.qty -= t.quantity
      if (h.qty < 1e-9) h.qty = 0
      h.invested = h.qty * h.avgCost
    }
  }
  return [...map.values()]
}

/** 현재가: 시세 캐시 우선, 없으면 최근 거래가 */
export function currentPrice(h: Holding, prices: PriceCache[]): number {
  const cached = prices.find((p) => p.key === holdingKey(h.market, h.symbol))
  return cached?.price ?? h.lastPrice
}

/** 계좌별·통화별 현금 잔고. key: `${accountId}:${currency}`
 *
 *  현금 추적은 계좌별 옵트인: 입출금 기록이 하나라도 있는 계좌만 장부 방식이 적용된다.
 *  추적 중인 계좌는 매수에 현금이 쓰이고 매도·배당으로 다시 들어오며,
 *  입출금을 안 쓰는 계좌는 기존처럼 현금 0으로 취급된다. */
export function computeCash(
  cashTxs: CashTx[],
  transactions: Transaction[],
  dividends: Dividend[]
): { balances: Map<string, number>; tracked: Set<number> } {
  const tracked = new Set<number>()
  for (const c of cashTxs) {
    tracked.add(c.accountId)
    if (c.fromAccountId != null) tracked.add(c.fromAccountId)
  }
  const balances = new Map<string, number>()
  const add = (accountId: number, currency: Currency, amount: number) => {
    const key = `${accountId}:${currency}`
    balances.set(key, (balances.get(key) ?? 0) + amount)
  }
  for (const c of cashTxs) {
    if (c.type === 'in') add(c.accountId, c.currency, c.amount)
    else if (c.type === 'out') add(c.accountId, c.currency, -c.amount)
    else {
      add(c.accountId, c.currency, c.amount)
      if (c.fromAccountId != null) add(c.fromAccountId, c.currency, -c.amount)
    }
  }
  for (const t of transactions) {
    if (!tracked.has(t.accountId)) continue
    const amount = t.quantity * t.price
    if (t.type === 'buy') add(t.accountId, t.currency, -(amount + (t.fee || 0)))
    else add(t.accountId, t.currency, amount - (t.fee || 0))
  }
  for (const d of dividends) {
    if (tracked.has(d.accountId)) add(d.accountId, d.currency, d.amountNet)
  }
  return { balances, tracked }
}

export const DEFAULT_FX: Record<Currency, number> = { KRW: 1, USD: 1378, JPY: 8.72 }

export function fxRate(currency: Currency, fxRows: { key: string; rate: number }[]): number {
  if (currency === 'KRW') return 1
  return fxRows.find((r) => r.key === currency)?.rate ?? DEFAULT_FX[currency]
}

export function toKRW(amount: number, currency: Currency, fxRows: { key: string; rate: number }[]): number {
  return amount * fxRate(currency, fxRows)
}

export function fromKRW(amountKRW: number, currency: Currency, fxRows: { key: string; rate: number }[]): number {
  return amountKRW / fxRate(currency, fxRows)
}

/** 임의 통화 간 변환 (내부 기준 통화는 KRW) */
export function convert(
  amount: number,
  from: Currency,
  to: Currency,
  fxRows: { key: string; rate: number }[]
): number {
  return fromKRW(toKRW(amount, from, fxRows), to, fxRows)
}
