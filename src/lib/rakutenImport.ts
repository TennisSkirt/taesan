import type { Account, Currency, Market, Region } from '../types'
import { guessRegion } from './format'
import { parseCsv, parseDate, parseNumber, type CsvImportPlan } from './csvImport'

/** 라쿠텐증권 거래이력 CSV 파서 (베타)
 *
 *  국내주식·미국주식 약정이력, 투자신탁 거래이력, 배당·분배금 이력을 지원.
 *  파일 종류마다 머리글이 달라서 일본어 머리글을 별칭으로 탐지한다.
 *  口座区分이 NISA면 NISA 계좌로, 特定·一般이면 과세 계좌로 자동 분류.
 */

export function looksLikeRakuten(rows: string[][]): boolean {
  return rows
    .slice(0, 10)
    .some((r) => r.some((c) => /約定日|銘柄名|ファンド名|ティッカー|口座区分|受渡日/.test(c)))
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

export function buildRakutenPlan(csvText: string, existingAccounts: Account[]): CsvImportPlan {
  const plan = emptyPlan()
  const rows = parseCsv(csvText)

  // 머리글 행 찾기 (안내 문구가 위에 붙는 파일도 있음)
  const score = (r: string[]) =>
    r.filter((c) => /約定日|受渡日|銘柄名|ファンド名|ティッカー|銘柄コード|口座|数量|単価|受取金額/.test(c)).length
  let headerIdx = -1
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if (score(rows[i]) >= 3) {
      headerIdx = i
      break
    }
  }
  if (headerIdx < 0) {
    plan.errors.push('라쿠텐 CSV의 머리글을 찾지 못했어요. 파일을 그대로 공유해주시면 형식을 추가할게요.')
    return plan
  }
  const H = rows[headerIdx].map((h) => h.replace(/[\s"]/g, ''))
  const find = (pred: (h: string) => boolean) => H.findIndex(pred)

  const dateCol =
    find((h) => h === '約定日') !== -1
      ? find((h) => h === '約定日')
      : find((h) => h.includes('約定日')) !== -1
        ? find((h) => h.includes('約定日'))
        : find((h) => h === '入金日' || h === '支払日' || h.includes('受渡日'))
  const codeCol = find((h) => h === '銘柄コード' || h === 'ティッカー' || h === 'コード')
  const nameCol =
    find((h) => h === '銘柄名' || h === 'ファンド名') !== -1
      ? find((h) => h === '銘柄名' || h === 'ファンド名')
      : find((h) => h.includes('銘柄') && !h.includes('コード'))
  const acctCol = find((h) => h.includes('口座'))
  const sideCol =
    find((h) => h === '売買区分') !== -1 ? find((h) => h === '売買区分') : find((h) => h === '取引区分' || h === '取引')
  const qtyCol = find((h) => h.startsWith('数量'))
  const priceCol = find((h) => h.startsWith('単価') || h.startsWith('約定単価'))
  const feeCol = find((h) => h.startsWith('手数料'))
  const curCol = find((h) => h.includes('通貨'))
  const amountCol = find((h) => h.startsWith('約定金額') || h.startsWith('約定代金') || h.startsWith('買付金額'))
  const grossCol = find((h) => h.includes('税引前') || (h.includes('配当') && h.includes('金額')))
  const netCol = find((h) => h.includes('受取金額'))

  const isFund = H.some((h) => h === 'ファンド名')
  const isUS = H.some((h) => h === 'ティッカー') || H.some((h) => h.includes('ドル'))
  const isDividendFile = netCol >= 0 && qtyCol < 0

  if (dateCol < 0 || nameCol < 0) {
    plan.errors.push('날짜·종목명 열을 찾지 못했어요. 파일을 공유해주시면 형식을 추가할게요.')
    return plan
  }

  // 계좌 라우팅: 기존 계좌를 우선 사용
  const jpOf = (a: Account) => (a.region ?? guessRegion(a.name)) === 'JP'
  const nisaName = existingAccounts.find((a) => jpOf(a) && a.nisa)?.name ?? '라쿠텐 신NISA'
  const taxableName =
    existingAccounts.find((a) => jpOf(a) && !a.nisa && /라쿠텐|rakuten|楽天/i.test(a.name))?.name ?? '라쿠텐증권'
  const ensureAccount = (name: string, nisa: boolean) => {
    const exists = existingAccounts.some((a) => a.name === name) || plan.accountsToCreate.some((a) => a.name === name)
    if (!exists) {
      plan.accountsToCreate.push({
        name,
        region: 'JP' as Region,
        nisa: nisa || undefined,
        nisaType: nisa ? 'shin' : undefined,
      })
    }
    return name
  }
  const routeAccount = (acctVal: string) => {
    const isNisa = /nisa|ニーサ|つみたて/i.test(acctVal)
    return ensureAccount(isNisa ? nisaName : taxableName, isNisa)
  }

  const get = (r: string[], i: number) => (i >= 0 && i < r.length ? r[i].trim() : '')

  const market: Market = isUS ? 'US' : 'JP'
  const headerCurrency: Currency = isUS && !isFund ? 'USD' : 'JPY'

  for (let n = headerIdx + 1; n < rows.length; n++) {
    const r = rows[n]
    const rowNo = n + 1
    const date = parseDate(get(r, dateCol))
    const name = get(r, nameCol)
    if (!date || !name) continue // 합계·빈 행 등
    const acctVal = get(r, acctCol)
    const accountName = routeAccount(acctVal)
    const curVal = get(r, curCol)
    const currency: Currency = curVal.includes('ドル') ? 'USD' : curVal.includes('円') ? 'JPY' : headerCurrency
    const rawCode = get(r, codeCol)
    const symbol = (rawCode || name.slice(0, 12).trim()).toUpperCase()

    if (isDividendFile) {
      const net = parseNumber(get(r, netCol))
      if (net === null || net <= 0) {
        plan.errors.push(`${rowNo}행: 수취금액을 읽지 못했어요`)
        continue
      }
      const gross = parseNumber(get(r, grossCol)) ?? net
      plan.dividends.push({
        accountName,
        symbol,
        name,
        market: /^[0-9]+$/.test(rawCode) ? 'JP' : rawCode ? 'US' : market,
        date,
        amountGross: gross,
        amountNet: net,
        currency,
      })
      plan.counts.dividend++
      continue
    }

    // 매매 행
    const side = get(r, sideCol)
    const isBuy = side.includes('買')
    const isSell = side.includes('売')
    if (!isBuy && !isSell) continue // 입출고·이관 등은 건너뜀
    const qty = parseNumber(get(r, qtyCol))
    if (qty === null || qty <= 0) {
      plan.errors.push(`${rowNo}행: 수량을 읽지 못했어요`)
      continue
    }
    // 투자신탁은 기준가액이 1만구 기준이라 단가 대신 약정금액÷구수로 계산
    let price = parseNumber(get(r, priceCol))
    const amount = parseNumber(get(r, amountCol))
    if (isFund && amount !== null && amount > 0) price = amount / qty
    if (price === null || price <= 0) {
      plan.errors.push(`${rowNo}행: 단가를 읽지 못했어요`)
      continue
    }
    plan.transactions.push({
      accountName,
      type: isBuy ? 'buy' : 'sell',
      market: isFund ? 'JP' : market,
      assetClass: isFund ? 'fund' : /ETF|上場/i.test(name) ? 'etf' : 'stock',
      symbol,
      name,
      date,
      quantity: qty,
      price,
      currency: isFund ? 'JPY' : currency,
      fee: parseNumber(get(r, feeCol)) ?? 0,
    })
    plan.counts[isBuy ? 'buy' : 'sell']++
  }
  return plan
}
