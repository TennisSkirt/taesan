import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { computeCash, computeHoldings, currentPrice, fromKRW, toKRW, type Holding } from './portfolio'
import type { Currency } from '../types'

/** 메인(표시) 통화 — 기본값 엔화 */
export const DEFAULT_MAIN_CURRENCY: Currency = 'JPY'

export interface CashBalance {
  accountId: number
  currency: Currency
  amount: number
  amountKRW: number
}

export interface HoldingView extends Holding {
  price: number
  value: number // 종목 통화 평가액
  valueKRW: number
  gain: number // 미실현 손익 (종목 통화)
  gainPct: number
}

export function usePortfolio() {
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], [])
  const transactions = useLiveQuery(() => db.transactions.toArray(), [], [])
  const dividends = useLiveQuery(() => db.dividends.toArray(), [], [])
  const cashTxs = useLiveQuery(() => db.cashTxs.toArray(), [], [])
  const manualAssets = useLiveQuery(() => db.manualAssets.toArray(), [], [])
  const prices = useLiveQuery(() => db.priceCache.toArray(), [], [])
  const fx = useLiveQuery(() => db.fxCache.toArray(), [], [])
  const mainSetting = useLiveQuery(() => db.settings.get('mainCurrency'), [], undefined)
  const main = (mainSetting?.value as Currency | undefined) ?? DEFAULT_MAIN_CURRENCY

  const holdings: HoldingView[] = computeHoldings(transactions)
    .filter((h) => h.qty > 0)
    .map((h) => {
      const price = currentPrice(h, prices)
      const value = h.qty * price
      const gain = value - h.invested
      return {
        ...h,
        price,
        value,
        valueKRW: toKRW(value, h.currency, fx),
        gain,
        gainPct: h.invested > 0 ? (gain / h.invested) * 100 : 0,
      }
    })
    .sort((a, b) => b.valueKRW - a.valueKRW)

  const stockValueKRW = holdings.reduce((s, h) => s + h.valueKRW, 0)
  const manualKRW = manualAssets.reduce((s, a) => s + toKRW(a.value, a.currency, fx), 0)

  // 현금 잔고 (입출금 기록이 있는 계좌만 추적)
  const { balances, tracked } = computeCash(cashTxs, transactions, dividends)
  const cashBalances: CashBalance[] = [...balances.entries()]
    .map(([key, amount]) => {
      const [accountId, currency] = key.split(':') as [string, Currency]
      return { accountId: Number(accountId), currency, amount, amountKRW: toKRW(amount, currency, fx) }
    })
    .filter((b) => Math.abs(b.amount) > 1e-9)
  const cashKRW = cashBalances.reduce((s, b) => s + b.amountKRW, 0)

  const totalKRW = stockValueKRW + cashKRW + manualKRW

  const investedKRW = holdings.reduce((s, h) => s + toKRW(h.invested, h.currency, fx), 0)
  const unrealizedKRW = holdings.reduce((s, h) => s + toKRW(h.gain, h.currency, fx), 0)

  const divNetKRW = dividends.reduce((s, d) => s + toKRW(d.amountNet, d.currency, fx), 0)
  const year = String(new Date().getFullYear())
  const yearDividends = dividends.filter((d) => d.date.startsWith(year))
  const divYearKRW = yearDividends.reduce((s, d) => s + toKRW(d.amountNet, d.currency, fx), 0)

  // 배당 포함 총수익 = 미실현 + 배당(세후). 수익률 분모는 현재 보유분 투자원금
  const totalGainKRW = unrealizedKRW + divNetKRW
  const totalGainPct = investedKRW > 0 ? (totalGainKRW / investedKRW) * 100 : 0

  // 내부 계산은 KRW 기준, 표시할 때 메인 통화로 환산
  const toMain = (amountKRW: number) => fromKRW(amountKRW, main, fx)

  return {
    main,
    toMain,
    accounts,
    transactions,
    dividends,
    yearDividends,
    cashTxs,
    cashBalances,
    cashTracked: tracked,
    cashKRW,
    manualAssets,
    prices,
    fx,
    holdings,
    stockValueKRW,
    manualKRW,
    totalKRW,
    investedKRW,
    unrealizedKRW,
    divNetKRW,
    divYearKRW,
    totalGainKRW,
    totalGainPct,
    hasData: transactions.length > 0 || manualAssets.length > 0 || cashTxs.length > 0,
  }
}
