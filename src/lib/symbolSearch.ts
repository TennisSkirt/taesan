import type { AssetClass, Market } from '../types'
import { fetchViaProxy } from './quotes'

/** 종목 검색 — 한국은 네이버 자동완성(한글), 미국·일본은 야후 검색.
 *  일본은 야후가 일본어 질의를 거부해서 코드(7203)나 영문으로 검색해야 함 */

export interface SymbolHit {
  symbol: string
  name: string
  market: Market
  assetClass: AssetClass
  sub: string // 거래소·유형 표시용
}

/** 한국 종목·ETF는 앱에 내장한 전체 목록(public/kr-symbols.json, 약 4,200개)에서 즉시 검색.
 *  외부 API 의존이 없어 오프라인에서도 동작. 신규 상장 종목은 목록 재생성 전까지 직접 입력 */
interface KrSymbol {
  c: string // 코드
  n: string // 이름
  t: 'stock' | 'etf'
}

let krSymbolsCache: KrSymbol[] | null = null

async function loadKrSymbols(): Promise<KrSymbol[]> {
  if (krSymbolsCache) return krSymbolsCache
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}kr-symbols.json`)
    krSymbolsCache = (await res.json()) as KrSymbol[]
  } catch {
    krSymbolsCache = []
  }
  return krSymbolsCache
}

async function searchKr(q: string): Promise<SymbolHit[]> {
  const list = await loadKrSymbols()
  const needle = q.toLowerCase().replace(/\s+/g, '')
  const scored = list
    .map((it) => {
      const name = it.n.toLowerCase().replace(/\s+/g, '')
      let score = -1
      if (name.startsWith(needle) || it.c.startsWith(q.trim())) score = 2
      else if (name.includes(needle)) score = 1
      return { it, score }
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
  return scored.map(({ it }) => ({
    symbol: it.c,
    name: it.n,
    market: 'KR' as Market,
    assetClass: it.t as AssetClass,
    sub: it.t === 'etf' ? 'ETF' : '주식',
  }))
}

interface YahooQuote {
  symbol?: string
  shortname?: string
  longname?: string
  quoteType?: string
  exchDisp?: string
}

async function searchYahoo(q: string, market: Market): Promise<SymbolHit[]> {
  const data = (await fetchViaProxy(
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`
  )) as { quotes?: YahooQuote[] } | null
  return (data?.quotes ?? [])
    .filter((it) => {
      if (!it.symbol || !(it.quoteType === 'EQUITY' || it.quoteType === 'ETF')) return false
      return market === 'JP' ? it.symbol.endsWith('.T') : !it.symbol.includes('.')
    })
    .slice(0, 6)
    .map((it) => ({
      symbol: market === 'JP' ? it.symbol!.replace(/\.T$/, '') : it.symbol!,
      name: it.longname ?? it.shortname ?? it.symbol!,
      market,
      assetClass: it.quoteType === 'ETF' ? ('etf' as AssetClass) : ('stock' as AssetClass),
      sub: `${it.exchDisp ?? ''}${it.quoteType === 'ETF' ? ' · ETF' : ''}`,
    }))
}

export async function searchSymbols(market: Market, q: string): Promise<SymbolHit[]> {
  const query = q.trim()
  if (query.length < 1) return []
  try {
    return market === 'KR' ? await searchKr(query) : await searchYahoo(query, market)
  } catch {
    return []
  }
}
