import { db } from '../db'
import { normalizeFundName } from './format'
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

export async function fetchViaProxy(url: string): Promise<unknown> {
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

/** 일본 투자신탁 기준가액 — 투자신탁협회(投信協会) 공식 데이터.
 *  키는 normalizeFundName() 결과. 새 펀드를 사면 여기에 코드를 추가해야 자동 갱신됨 (없으면 수동 입력) */
const FUND_CODES: Record<string, { isin: string; assoc: string }> = {
  'eMAXISSlim米国株式': { isin: 'JP90C000GKC6', assoc: '03311187' },
  'eMAXISSlim新興国株式インデックス': { isin: 'JP90C000F7H5', assoc: '0331C177' },
  '年金積立Jグロース': { isin: 'JP90C00021F1', assoc: '0231Q01A' },
  '楽天・全米株式インデックス・ファンド': { isin: 'JP90C000FHD2', assoc: '9I312179' },
  '楽天・オールカントリー株式インデックス・ファンド': { isin: 'JP90C000Q2W2', assoc: '9I31123A' },
  '楽天・S&P500インデックス・ファンド': { isin: 'JP90C000Q2U6', assoc: '9I31223A' },
  '楽天・シュワブ・高配当株式・米国ファンド': { isin: 'JP90C000R6N1', assoc: '9I312249' },
}

/** 협회 CSV(Shift_JIS)에서 최신 기준가액을 읽어 1구좌당 단가로 반환 */
async function fetchFundNav(code: { isin: string; assoc: string }): Promise<{ price: number; changePercent?: number } | null> {
  const url = `https://toushin-lib.fwg.ne.jp/FdsWeb/FDST030000/csv-file-download?isinCd=${code.isin}&associFundCd=${code.assoc}`
  for (const proxy of PROXIES) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 10000)
    try {
      const res = await fetch(proxy(url), { signal: ctrl.signal })
      if (!res.ok) continue
      const text = new TextDecoder('shift_jis').decode(await res.arrayBuffer())
      const lines = text.trim().split(/\r?\n/)
      if (lines.length < 2) continue
      const nav = Number(lines[lines.length - 1].split(',')[1])
      const prev = lines.length > 2 ? Number(lines[lines.length - 2].split(',')[1]) : NaN
      if (!nav || isNaN(nav)) continue
      return {
        price: nav / 10000,
        changePercent: prev && !isNaN(prev) ? ((nav - prev) / prev) * 100 : undefined,
      }
    } catch {
      continue
    } finally {
      clearTimeout(t)
    }
  }
  return null
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

  // 2) 시세 — 주식·ETF는 야후, 투자신탁은 투신협회 기준가액
  const targets = new Map<string, Holding>()
  for (const h of holdings) {
    targets.set(holdingKey(h.market, h.symbol), h)
  }
  const list = [...targets.values()]
  const BATCH = 4
  for (let i = 0; i < list.length; i += BATCH) {
    await Promise.all(
      list.slice(i, i + BATCH).map(async (h) => {
        let quote: { price: number; changePercent?: number } | null = null
        if (h.assetClass === 'fund') {
          const code = FUND_CODES[normalizeFundName(h.name)]
          if (!code) return // 코드 미등록 투신은 수동 입력 유지
          quote = await fetchFundNav(code)
        } else {
          for (const sym of yahooSymbols(h)) {
            quote = await fetchYahooPrice(sym)
            if (quote) break
          }
        }
        if (quote) {
          await db.priceCache.put({
            key: holdingKey(h.market, h.symbol),
            price: quote.price,
            currency: h.currency,
            changePercent: quote.changePercent,
            updatedAt: now,
          })
          result.updated++
        } else {
          result.failed.push(h.name)
        }
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
