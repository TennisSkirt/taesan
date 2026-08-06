import type { Account, Region } from '../types'
import { guessRegion } from './format'
import { parseCsv, parseNumber, type CsvImportPlan } from './csvImport'

/** E*TRADE CSV 파서 — 실파일 검증 형식:
 *  - ESPP_Sellable.csv: Record Type,Symbol,Plan Type,Date Acquired,Sellable Qty.,Expected Gain/Loss,...,Est. Market Value,...
 *    → Purchase 행을 매수로. 취득가 = (시장가치 − 평가손익) ÷ 수량 (FMV 기준)
 *  - Statements_Activity.csv: date,statement_date,account,type,symbol,description,amount_credited,amount_debited,...
 *    → Dividend 행 + 같은 날짜·심볼의 Tax Withholding 행을 짝지어 세후 실수령 계산
 *  - Statements_Holdings.csv: 월별 스냅샷 → 가져올 거래 없음(안내만)
 */

const MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
}

/** "14-AUG-2020" → "2020-08-14" */
function parseEtradeDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/)
  if (m) {
    const month = MONTHS[m[2].toUpperCase()]
    if (!month) return null
    return `${m[3]}-${month}-${m[1].padStart(2, '0')}`
  }
  const iso = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return iso ? s.trim() : null
}

export function looksLikeEtrade(rows: string[][]): boolean {
  const header = rows[0]?.map((h) => h.trim().toLowerCase()) ?? []
  const hasEspp = header.includes('record type') && header.includes('plan type')
  const hasActivity = header.includes('amount_credited') || (header.includes('statement_date') && header.includes('type'))
  const hasHoldings = header.includes('statement_date') && header.includes('market_value')
  return hasEspp || hasActivity || hasHoldings
}

function emptyPlan(): CsvImportPlan {
  return {
    accountsToCreate: [],
    transactions: [],
    dividends: [],
    cashTxs: [],
    errors: [],
    counts: { buy: 0, sell: 0, dividend: 0, cashIn: 0, cashOut: 0 },
  }
}

export function buildEtradePlan(csvText: string, existingAccounts: Account[]): CsvImportPlan {
  const plan = emptyPlan()
  const rows = parseCsv(csvText)
  if (rows.length < 2) {
    plan.errors.push('데이터 행이 없어요.')
    return plan
  }
  const header = rows[0].map((h) => h.trim().toLowerCase())
  const col = (name: string) => header.indexOf(name)
  const get = (r: string[], i: number) => (i >= 0 && i < r.length ? r[i].trim() : '')

  // 계좌: 기존 미국 지역 E*TRADE 계좌 재사용, 없으면 생성
  const usOf = (a: Account) => (a.region ?? guessRegion(a.name)) === 'US'
  const accountName =
    existingAccounts.find((a) => usOf(a) && /e\s?\*?\s?trade|이트레이드/i.test(a.name))?.name ??
    existingAccounts.find(usOf)?.name ??
    'E*TRADE'
  const ensureAccount = () => {
    const exists =
      existingAccounts.some((a) => a.name === accountName) ||
      plan.accountsToCreate.some((a) => a.name === accountName)
    if (!exists) plan.accountsToCreate.push({ name: accountName, region: 'US' as Region })
    return accountName
  }

  // ── 형식 1: ESPP_Sellable (매수 lot) ──
  if (header.includes('record type') && header.includes('plan type')) {
    const cType = col('record type')
    const cSym = col('symbol')
    const cDate = col('date acquired')
    const cQty = col('sellable qty.')
    const cGain = col('expected gain/loss')
    const cMkt = col('est. market value')
    for (let n = 1; n < rows.length; n++) {
      const r = rows[n]
      if (get(r, cType) !== 'Purchase') continue // Overall Total 등 제외
      const date = parseEtradeDate(get(r, cDate))
      const qty = parseNumber(get(r, cQty))
      const gain = parseNumber(get(r, cGain))
      const mkt = parseNumber(get(r, cMkt))
      const symbol = get(r, cSym).toUpperCase()
      if (!date || !symbol || qty === null || qty <= 0 || gain === null || mkt === null) {
        plan.errors.push(`${n + 1}행: 취득일·수량·평가액을 읽지 못했어요`)
        continue
      }
      const price = Math.round(((mkt - gain) / qty) * 100) / 100
      plan.transactions.push({
        accountName: ensureAccount(),
        type: 'buy',
        market: 'US',
        assetClass: 'stock',
        symbol,
        name: symbol,
        date,
        quantity: qty,
        price,
        currency: 'USD',
        fee: 0,
      })
      plan.counts.buy++
    }
    return plan
  }

  // ── 형식 2: Statements_Holdings (월별 스냅샷 — 가져올 거래 없음) ──
  if (header.includes('market_value')) {
    plan.errors.push(
      '이 파일은 월별 잔고 스냅샷이라 가져올 거래가 없어요. ESPP_Sellable.csv(매수)와 Statements_Activity.csv(배당)를 넣어주세요.'
    )
    return plan
  }

  // ── 형식 3: Statements_Activity (배당 + 원천징수) ──
  {
    const cDate = col('date')
    const cType = col('type')
    const cSym = col('symbol')
    const cDesc = col('description')
    const cCredit = col('amount_credited')
    const cDebit = col('amount_debited')
    // 1차: 같은 날짜·심볼의 Tax Withholding 합산
    const taxMap = new Map<string, number>()
    for (let n = 1; n < rows.length; n++) {
      const r = rows[n]
      if (get(r, cType) !== 'Tax Withholding') continue
      const key = `${get(r, cSym)}:${get(r, cDate)}`
      taxMap.set(key, (taxMap.get(key) ?? 0) + (parseNumber(get(r, cDebit)) ?? 0))
    }
    for (let n = 1; n < rows.length; n++) {
      const r = rows[n]
      if (get(r, cType) !== 'Dividend') continue
      const date = parseEtradeDate(get(r, cDate))
      const symbol = get(r, cSym).toUpperCase()
      const gross = parseNumber(get(r, cCredit))
      if (!date || !symbol || gross === null || gross <= 0) {
        plan.errors.push(`${n + 1}행: 배당 날짜·금액을 읽지 못했어요`)
        continue
      }
      const tax = (parseNumber(get(r, cDebit)) ?? 0) + (taxMap.get(`${symbol}:${get(r, cDate)}`) ?? 0)
      plan.dividends.push({
        accountName: ensureAccount(),
        symbol,
        name: get(r, cDesc) || symbol,
        market: 'US',
        date,
        amountGross: gross,
        amountNet: Math.round((gross - tax) * 100) / 100,
        currency: 'USD',
      })
      plan.counts.dividend++
    }
  }
  return plan
}
