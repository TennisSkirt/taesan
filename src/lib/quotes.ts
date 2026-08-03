import { db } from '../db'
import { holdingKey, type Holding } from './portfolio'

/** 시세 자동 갱신 — 야후 파이낸스(주식·ETF) + 무료 환율 API.
 *  정적 호스팅(PWA)이라 야후는 CORS 프록시 체인으로 우회한다.
 *  투자신탁 기준가액은 무료 소스가 없어 수동 입력(자산 탭에서 종목 탭). */

const PROXIES: ((url: string) => string)[] = [
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
]

async function fetchJson(url: string, timeoutMs = 8000): Promise<unknown> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

async function fetchViaProxy(url: string): Promise<unknown> {
  for (const proxy of PROXIES) {
    const data = await fetchJson(proxy(url))
    if (data) return data
  }
  return null
}

interface YahooMeta {
  regularMarketPrice?: number
  chartPreviousClose?: number
  currency?: string
}

async function fetchYahooPrice(symbol: string): Promise<{ price: number; changePercent?: number } | null> {
  const data = (await fetchViaProxy(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`
  )) as { chart?: { result?: { meta?: YahooMeta }[] } } | null
  const meta = data?.chart?.result?.[0]?.meta
  if (!meta?.regularMarketPrice) return null
  const prev = meta.chartPreviousClose
  return {
    price: meta.regularMarketPrice,
    changePercent: prev ? ((meta.regularMarketPrice - prev) / prev) * 100 : undefined,
  }
}

/** 시장별 야후 심볼 후보 (한국은 코스피 → 코스닥 순서로 시도) */
function yahooSymbols(h: Holding): string[] {
  if (h.market === 'US') return [h.symbol]
  if (h.market === 'JP') return [`${h.symbol}.T`]
  return [`${h.symbol}.KS`, `${h.symbol}.KQ`]
}

export interface RefreshResult {
  updated: number
  failed: string[]
  fxUpdated: boolean
}

export async function refreshQuotes(holdings: Holding[]): Promise<RefreshResult> {
  const result: RefreshResult = { updated: 0, failed: [], fxUpdated: false }
  const now = new Date().toISOString()

  // 1) 환율 (CORS 허용 API라 직접 호출)
  const fx = (await fetchJson('https://open.er-api.com/v6/latest/USD')) as {
    rates?: { KRW?: number; JPY?: number }
  } | null
  if (fx?.rates?.KRW && fx?.rates?.JPY) {
    await db.fxCache.put({ key: 'USD', rate: fx.rates.KRW, updatedAt: now })
    await db.fxCache.put({ key: 'JPY', rate: fx.rates.KRW / fx.rates.JPY, updatedAt: now })
    result.fxUpdated = true
  }

  // 2) 주식·ETF 시세 (투자신탁은 수동)
  const targets = new Map<string, Holding>()
  for (const h of holdings) {
    if (h.assetClass === 'fund') continue
    targets.set(holdingKey(h.market, h.symbol), h)
  }
  const list = [...targets.values()]
  const BATCH = 4
  for (let i = 0; i < list.length; i += BATCH) {
    await Promise.all(
      list.slice(i, i + BATCH).map(async (h) => {
        for (const sym of yahooSymbols(h)) {
          const q = await fetchYahooPrice(sym)
          if (q) {
            await db.priceCache.put({
              key: holdingKey(h.market, h.symbol),
              price: q.price,
              currency: h.currency,
              changePercent: q.changePercent,
              updatedAt: now,
            })
            result.updated++
            return
          }
        }
        result.failed.push(h.name)
      })
    )
  }

  await db.settings.put({ key: 'quotesRefreshedAt', value: Date.now() })
  return result
}

/** 수동 시세 입력 (투자신탁 기준가액 등) */
export async function setManualPrice(h: Holding, price: number): Promise<void> {
  await db.priceCache.put({
    key: holdingKey(h.market, h.symbol),
    price,
    currency: h.currency,
    updatedAt: new Date().toISOString(),
  })
}
