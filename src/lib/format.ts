import type { Currency, Market } from '../types'

export const CURRENCY_SYMBOL: Record<Currency, string> = { KRW: '₩', USD: '$', JPY: '¥' }

export const CURRENCY_LABEL: Record<Currency, string> = { KRW: '원화', USD: '달러', JPY: '엔화' }

export const MARKET_CURRENCY: Record<Market, Currency> = { KR: 'KRW', US: 'USD', JP: 'JPY' }

export const MARKET_LABEL: Record<Market, string> = { KR: '한국', US: '미국', JP: '일본' }

export function fmtMoney(v: number, c: Currency): string {
  const digits = c === 'USD' ? 2 : 0
  return (
    CURRENCY_SYMBOL[c] +
    v.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  )
}

export function fmtKRW(v: number): string {
  return fmtMoney(Math.round(v), 'KRW')
}

export function fmtSignedKRW(v: number): string {
  return (v >= 0 ? '+' : '-') + fmtKRW(Math.abs(v))
}

export function fmtSignedMoney(v: number, c: Currency): string {
  return (v >= 0 ? '+' : '-') + fmtMoney(Math.abs(v), c)
}

export function fmtPct(v: number): string {
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%'
}

/** ₩8,743만 · ¥120만 · $1.2M 같은 축약 표기 (도넛 중앙 등 좁은 곳용) */
export function fmtMoneyCompact(v: number, c: Currency): string {
  const abs = Math.abs(v)
  if (c === 'USD') {
    if (abs >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M'
    if (abs >= 1e4) return '$' + Math.round(v / 1e3).toLocaleString('ko-KR') + 'K'
    return fmtMoney(v, c)
  }
  const sym = CURRENCY_SYMBOL[c]
  if (abs >= 1e8) return sym + (v / 1e8).toFixed(1) + '억'
  if (abs >= 1e4) return sym + Math.round(v / 1e4).toLocaleString('ko-KR') + '만'
  return fmtMoney(v, c)
}

export function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
