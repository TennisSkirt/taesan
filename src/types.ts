export type Currency = 'KRW' | 'USD' | 'JPY'
export type Market = 'KR' | 'US' | 'JP'

export type AssetClass = 'stock' | 'etf'

/** 증권사·은행 등 계좌. 주식 계좌뿐 아니라 예금/현금성 계좌도 포함 */
export interface Account {
  id?: number
  name: string // 예: 토스증권, NH투자증권, 라쿠텐증권, E*TRADE
  kind: 'brokerage' | 'bank' | 'cash' | 'other'
  /** 일본 NISA(비과세) 계좌 여부 — 세금 계산에서 비과세 처리 */
  nisa?: boolean
  createdAt: string
}

/** 매수/매도 거래 기록 — 보유 수량·평단·손익은 전부 여기서 파생 계산 */
export interface Transaction {
  id?: number
  accountId: number
  type: 'buy' | 'sell'
  market: Market
  assetClass: AssetClass
  symbol: string // KR: 6자리 코드(005930), US: 티커(AAPL), JP: 4자리 코드(7203)
  name: string
  date: string // YYYY-MM-DD
  quantity: number
  price: number // 종목 통화 기준 단가
  currency: Currency
  fee: number // 수수료 (종목 통화)
  memo?: string
}

/** 배당 수령 기록 */
export interface Dividend {
  id?: number
  accountId: number
  symbol: string
  name: string
  market: Market
  date: string
  amountGross: number // 세전 (종목 통화)
  amountNet: number // 세후 실수령 (종목 통화)
  currency: Currency
  memo?: string
}

/** 현금 입출금 · 계좌 간 이체 */
export type CashTxType = 'in' | 'out' | 'transfer'

export interface CashTx {
  id?: number
  type: CashTxType
  /** 'in'/'out': 대상 계좌, 'transfer': 받는 계좌 */
  accountId: number
  /** 'transfer'일 때 보내는 계좌 */
  fromAccountId?: number
  /** 'in': 출처(월급/용돈 등), 'out': 사용처(생활비 등) */
  source?: string
  amount: number
  currency: Currency
  date: string
  memo?: string
}

/** 주식 외 자산 (예금, 현금, 부동산 등) — 현재 가치를 직접 입력 */
export interface ManualAsset {
  id?: number
  accountId?: number
  name: string
  category: 'deposit' | 'cash' | 'realestate' | 'crypto' | 'other'
  value: number
  currency: Currency
  updatedAt: string
}

/** 시세 캐시 — key는 `${market}:${symbol}` */
export interface PriceCache {
  key: string
  price: number
  currency: Currency
  changePercent?: number
  updatedAt: string
}

/** 환율 캐시 — key는 'USD' | 'JPY' (→KRW) */
export interface FxCache {
  key: string
  rate: number // 1 단위당 KRW
  updatedAt: string
}

/** 일별 총자산 스냅샷 — 자산 추이 그래프용 */
export interface Snapshot {
  date: string // YYYY-MM-DD, unique
  totalKRW: number
  breakdown: Record<string, number> // 계좌ID → KRW 평가액
}

export interface Setting {
  key: string
  value: unknown
}
