import { db } from '../db'
import type { Account, AssetClass, CashTx, Currency, Dividend, Market, Region, Transaction } from '../types'
import { guessRegion, MARKET_CURRENCY, REGION_CURRENCY } from './format'

/** 태산 CSV 가져오기 — 템플릿 형식:
 *  구분,국가,계좌,날짜,종목명,코드,시장,종류,수량,단가,금액,통화,수수료,출처
 *  구분: 매수/매도/배당/입금/출금
 *  금액: 배당 실수령액 · 입출금 금액 (매수/매도는 수량×단가로 계산하므로 비움)
 */

type PendingTx = Omit<Transaction, 'id' | 'accountId'> & { accountName: string }
type PendingDiv = Omit<Dividend, 'id' | 'accountId'> & { accountName: string }
type PendingCash = Omit<CashTx, 'id' | 'accountId'> & { accountName: string }

export interface CsvImportPlan {
  accountsToCreate: { name: string; region: Region; nisa?: boolean; nisaType?: Account['nisaType'] }[]
  transactions: PendingTx[]
  dividends: PendingDiv[]
  cashTxs: PendingCash[]
  errors: string[]
  counts: { buy: number; sell: number; dividend: number; cashIn: number; cashOut: number }
}

/** CSV 바이트 디코딩 — UTF-8 우선, 깨지면 Shift_JIS(라쿠텐)·EUC-KR(한글 엑셀) 중 점수로 선택 */
export function decodeCsvBuffer(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buf)
  if (!utf8.includes('�')) return utf8
  const candidates: string[] = []
  for (const enc of ['shift_jis', 'euc-kr']) {
    try {
      candidates.push(new TextDecoder(enc).decode(buf))
    } catch {
      /* 미지원 인코딩 무시 */
    }
  }
  const scoreOf = (t: string) => {
    let s = -(t.match(/�/g)?.length ?? 0) * 5
    if (/約定日|受渡日|入金日|銘柄|口座|配当/.test(t)) s += 20
    if (/구분|계좌|날짜|종목/.test(t)) s += 20
    return s
  }
  return candidates.sort((a, b) => scoreOf(b) - scoreOf(a))[0] ?? utf8
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQuotes = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cur += '"'
          i++
        } else inQuotes = false
      } else cur += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') {
      row.push(cur)
      cur = ''
    } else if (c === '\n') {
      row.push(cur)
      rows.push(row)
      row = []
      cur = ''
    } else if (c !== '\r') cur += c
  }
  if (cur !== '' || row.length > 0) {
    row.push(cur)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

function parseRegion(s: string): Region | null {
  const v = s.trim().toUpperCase()
  if (v === 'JP' || s.includes('일본')) return 'JP'
  if (v === 'KR' || s.includes('한국')) return 'KR'
  if (v === 'US' || s.includes('미국')) return 'US'
  return null
}

function parseMarket(s: string): Market | null {
  const v = s.trim().toUpperCase()
  if (v === 'KR' || s.includes('한국')) return 'KR'
  if (v === 'US' || s.includes('미국')) return 'US'
  if (v === 'JP' || s.includes('일본')) return 'JP'
  return null
}

function parseAssetClass(s: string): AssetClass {
  const v = s.trim().toLowerCase()
  if (v === 'etf') return 'etf'
  if (v === 'fund' || s.includes('투자신탁') || s.includes('투신') || s.includes('펀드')) return 'fund'
  return 'stock'
}

function parseCurrency(s: string): Currency | null {
  const v = s.trim().toUpperCase()
  if (v === 'KRW' || v === '₩') return 'KRW'
  if (v === 'USD' || v === '$') return 'USD'
  if (v === 'JPY' || v === '¥') return 'JPY'
  return null
}

export function parseNumber(s: string): number | null {
  const cleaned = s.replace(/[₩¥$,\s]/g, '')
  if (cleaned === '') return null
  const n = Number(cleaned)
  return isNaN(n) ? null : n
}

export function parseDate(s: string): string | null {
  const m = s.trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (!m) return null
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

export function buildImportPlan(csvText: string, existingAccounts: Account[]): CsvImportPlan {
  const plan: CsvImportPlan = {
    accountsToCreate: [],
    transactions: [],
    dividends: [],
    cashTxs: [],
    errors: [],
    counts: { buy: 0, sell: 0, dividend: 0, cashIn: 0, cashOut: 0 },
  }
  const rows = parseCsv(csvText)
  if (rows.length < 2) {
    plan.errors.push('데이터 행이 없어요. 첫 줄은 머리글, 둘째 줄부터 데이터여야 합니다.')
    return plan
  }
  const header = rows[0].map((h) => h.trim())
  const col = (name: string) => header.findIndex((h) => h === name)
  const idx = {
    kind: col('구분'),
    region: col('국가'),
    account: col('계좌'),
    date: col('날짜'),
    name: col('종목명'),
    symbol: col('코드'),
    market: col('시장'),
    assetClass: col('종류'),
    qty: col('수량'),
    price: col('단가'),
    amount: col('금액'),
    currency: col('통화'),
    fee: col('수수료'),
    source: col('출처'),
  }
  if (idx.kind < 0 || idx.account < 0 || idx.date < 0) {
    plan.errors.push('머리글에 구분·계좌·날짜 열이 꼭 있어야 해요. 템플릿을 내려받아 사용해주세요.')
    return plan
  }

  const knownAccounts = new Map<string, { region: Region }>()
  for (const a of existingAccounts) knownAccounts.set(a.name, { region: a.region ?? guessRegion(a.name) })

  const get = (r: string[], i: number) => (i >= 0 && i < r.length ? r[i].trim() : '')

  for (let n = 1; n < rows.length; n++) {
    const r = rows[n]
    const rowNo = n + 1
    const kind = get(r, idx.kind)
    const accountName = get(r, idx.account)
    const date = parseDate(get(r, idx.date))
    if (!accountName) {
      plan.errors.push(`${rowNo}행: 계좌가 비어 있어요`)
      continue
    }
    if (!date) {
      plan.errors.push(`${rowNo}행: 날짜 형식을 읽지 못했어요 (YYYY-MM-DD)`)
      continue
    }

    // 계좌 등록 (없으면 생성 예약)
    if (!knownAccounts.has(accountName) && !plan.accountsToCreate.some((a) => a.name === accountName)) {
      const region = parseRegion(get(r, idx.region)) ?? guessRegion(accountName)
      const isNisa = /nisa|니사/i.test(accountName)
      plan.accountsToCreate.push({
        name: accountName,
        region,
        nisa: isNisa || undefined,
        nisaType: isNisa ? (/구|旧|old/i.test(accountName) ? 'ippan' : 'shin') : undefined,
      })
      knownAccounts.set(accountName, { region })
    }
    const accountRegion = knownAccounts.get(accountName)!.region

    if (kind === '매수' || kind === '매도') {
      const market = parseMarket(get(r, idx.market))
      const qty = parseNumber(get(r, idx.qty))
      const price = parseNumber(get(r, idx.price))
      const symbol = get(r, idx.symbol)
      const name = get(r, idx.name)
      if (!market) {
        plan.errors.push(`${rowNo}행: 시장(한국/미국/일본)을 읽지 못했어요`)
        continue
      }
      if (!name || !symbol || qty === null || price === null || qty <= 0 || price <= 0) {
        plan.errors.push(`${rowNo}행: 종목명·코드·수량·단가를 확인해주세요`)
        continue
      }
      plan.transactions.push({
        accountName,
        type: kind === '매수' ? 'buy' : 'sell',
        market,
        assetClass: parseAssetClass(get(r, idx.assetClass)),
        symbol: symbol.toUpperCase(),
        name,
        date,
        quantity: qty,
        price,
        currency: parseCurrency(get(r, idx.currency)) ?? MARKET_CURRENCY[market],
        fee: parseNumber(get(r, idx.fee)) ?? 0,
      })
      plan.counts[kind === '매수' ? 'buy' : 'sell']++
    } else if (kind === '배당') {
      const market = parseMarket(get(r, idx.market)) ?? 'KR'
      const amount = parseNumber(get(r, idx.amount))
      const symbol = get(r, idx.symbol)
      const name = get(r, idx.name)
      if (!name || amount === null || amount <= 0) {
        plan.errors.push(`${rowNo}행: 배당은 종목명과 금액(실수령)이 필요해요`)
        continue
      }
      plan.dividends.push({
        accountName,
        symbol: symbol.toUpperCase(),
        name,
        market,
        date,
        amountGross: amount,
        amountNet: amount,
        currency: parseCurrency(get(r, idx.currency)) ?? MARKET_CURRENCY[market],
      })
      plan.counts.dividend++
    } else if (kind === '입금' || kind === '출금') {
      const amount = parseNumber(get(r, idx.amount))
      if (amount === null || amount <= 0) {
        plan.errors.push(`${rowNo}행: ${kind} 금액을 읽지 못했어요`)
        continue
      }
      plan.cashTxs.push({
        accountName,
        type: kind === '입금' ? 'in' : 'out',
        source: get(r, idx.source) || (kind === '입금' ? '기존 자산' : '기타'),
        amount,
        currency: parseCurrency(get(r, idx.currency)) ?? REGION_CURRENCY[accountRegion],
        date,
      })
      plan.counts[kind === '입금' ? 'cashIn' : 'cashOut']++
    } else {
      plan.errors.push(`${rowNo}행: 구분 "${kind}"을 몰라요 (매수/매도/배당/입금/출금)`)
    }
  }
  return plan
}

/** 계획 실행: 계좌 생성 → 이름을 id로 치환해 일괄 저장 */
export async function applyImportPlan(plan: CsvImportPlan): Promise<void> {
  await db.transaction('rw', [db.accounts, db.transactions, db.dividends, db.cashTxs], async () => {
    const existing = await db.accounts.toArray()
    const idByName = new Map<string, number>(existing.map((a) => [a.name, a.id!]))
    for (const a of plan.accountsToCreate) {
      if (idByName.has(a.name)) continue
      const id = await db.accounts.add({
        name: a.name,
        kind: 'brokerage',
        region: a.region,
        nisa: a.nisa,
        nisaType: a.nisaType,
        createdAt: new Date().toISOString().slice(0, 10),
      })
      idByName.set(a.name, id as number)
    }
    const resolve = (name: string) => {
      const id = idByName.get(name)
      if (id === undefined) throw new Error(`계좌를 찾지 못했어요: ${name}`)
      return id
    }
    await db.transactions.bulkAdd(
      plan.transactions.map(({ accountName, ...t }) => ({ ...t, accountId: resolve(accountName) }))
    )
    await db.dividends.bulkAdd(
      plan.dividends.map(({ accountName, ...d }) => ({ ...d, accountId: resolve(accountName) }))
    )
    await db.cashTxs.bulkAdd(
      plan.cashTxs.map(({ accountName, ...c }) => ({ ...c, accountId: resolve(accountName) }))
    )
  })
}

export function templateCsv(): string {
  return [
    '구분,국가,계좌,날짜,종목명,코드,시장,종류,수량,단가,금액,통화,수수료,출처',
    '매수,일본,라쿠텐 신NISA,2026-03-05,eMAXIS Slim 미국S&P500,253266,일본,투자신탁,40,33000,,,0,',
    '매수,일본,라쿠텐증권,2026-04-01,VTI,VTI,미국,ETF,3,270,,USD,0.5,',
    '매수,한국,토스증권,2026-01-10,삼성전자,005930,한국,주식,10,72000,,,,',
    '매도,한국,토스증권,2026-06-02,삼성전자,005930,한국,주식,5,80000,,,,',
    '배당,한국,토스증권,2026-04-20,삼성전자,005930,한국,,,,43200,,,',
    '입금,일본,라쿠텐 신NISA,2026-01-05,,,,,,,100000,JPY,,기존 자산',
    '출금,한국,토스증권,2026-05-01,,,,,,,200000,KRW,,생활비',
  ].join('\n')
}
