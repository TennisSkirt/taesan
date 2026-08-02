import type { Account, Currency, Market, Region } from '../types'
import { guessRegion } from './format'
import { parseCsv, parseDate, parseNumber, type CsvImportPlan } from './csvImport'

/** 라쿠텐증권 거래이력 CSV 파서
 *
 *  실파일 검증 형식:
 *  - 투자신탁 tradehistory(INVST): 約定日,受渡日,ファンド名,分配金,口座,取引,買付方法,数量[口],単価,...,受渡金額/(ポイント利用)[円],決済通貨
 *    · 単価는 1만 구좌당 기준가액 → 受渡金額÷口数(없으면 単価÷10,000)로 구좌당 단가 환산
 *    · 매도는 "解約"
 *    · 口座: 特定 / つみたてNISA(구NISA 적립) / NISAつみたて投資枠·NISA成長投資枠(신NISA)
 *  - 미국주식 tradehistory(US): ...,ティッカー,銘柄名,口座,取引区分,売買区分,...,数量[株],単価[USドル],...
 *    · 円貨결제여도 단가는 USD → 통화는 항상 USD
 *  - 국내주식·배당 CSV도 동일 별칭 체계로 지원
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

/** "20,440(440)" 같은 포인트 병기 표기에서 앞쪽 금액만 파싱 */
function parseAmount(s: string): number | null {
  return parseNumber(s.split('(')[0])
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
    find((h) => h === '売買区分') !== -1
      ? find((h) => h === '売買区分')
      : find((h) => h === '取引区分' || h === '取引')
  const qtyCol = find((h) => h.startsWith('数量'))
  const priceCol = find((h) => h.startsWith('単価') || h.startsWith('約定単価'))
  const feeCol = find((h) => h.startsWith('手数料'))
  const curCol = find((h) => h.includes('決済通貨') || h.includes('通貨'))
  // 투신 금액: 受渡金額/(ポイント利用)[円] 우선, 약정금액 계열 폴백
  const fundAmountCol =
    find((h) => h.includes('受渡金額') && h.includes('円')) !== -1
      ? find((h) => h.includes('受渡金額') && h.includes('円'))
      : find((h) => h.startsWith('約定金額') || h.startsWith('約定代金'))
  const grossCol = find((h) => h.includes('税引前') || (h.includes('配当') && h.includes('金額')))
  const netCol = find((h) => h.includes('受取金額'))

  const isFund = H.some((h) => h === 'ファンド名')
  const priceIsUSD = priceCol >= 0 && /ドル/.test(H[priceCol])
  const isUS = H.some((h) => h === 'ティッカー') || priceIsUSD
  const isDividendFile = netCol >= 0 && qtyCol < 0

  if (dateCol < 0 || nameCol < 0) {
    plan.errors.push('날짜·종목명 열을 찾지 못했어요. 파일을 공유해주시면 형식을 추가할게요.')
    return plan
  }

  // 계좌 라우팅 — 기존 계좌 우선 재사용, 없으면 생성 예약
  const jpOf = (a: Account) => (a.region ?? guessRegion(a.name)) === 'JP'
  const existingName = (pred: (a: Account) => boolean) => existingAccounts.find(pred)?.name
  const names = {
    shin: existingName((a) => jpOf(a) && !!a.nisa && (a.nisaType ?? 'shin') === 'shin') ?? '라쿠텐 신NISA',
    tsumitate: existingName((a) => jpOf(a) && !!a.nisa && a.nisaType === 'tsumitate') ?? '라쿠텐 구NISA(적립)',
    ippan: existingName((a) => jpOf(a) && !!a.nisa && a.nisaType === 'ippan') ?? '라쿠텐 구NISA(일반)',
    taxable:
      existingName((a) => jpOf(a) && !a.nisa && /라쿠텐|rakuten|楽天/i.test(a.name)) ?? '라쿠텐증권',
  }
  const ensureAccount = (name: string, nisaType: Account['nisaType'] | null) => {
    const exists =
      existingAccounts.some((a) => a.name === name) || plan.accountsToCreate.some((a) => a.name === name)
    if (!exists) {
      plan.accountsToCreate.push({
        name,
        region: 'JP' as Region,
        nisa: nisaType ? true : undefined,
        nisaType: nisaType ?? undefined,
      })
    }
    return name
  }
  const routeAccount = (acctVal: string) => {
    if (acctVal.includes('一般NISA')) return ensureAccount(names.ippan, 'ippan')
    // 「つみたてNISA」(구제도)와 「NISAつみたて投資枠」(신제도)를 枠 유무로 구분
    if (acctVal.includes('つみたて') && /NISA|ニーサ/i.test(acctVal) && !acctVal.includes('枠'))
      return ensureAccount(names.tsumitate, 'tsumitate')
    if (/NISA|ニーサ/i.test(acctVal)) return ensureAccount(names.shin, 'shin')
    return ensureAccount(names.taxable, null)
  }

  const get = (r: string[], i: number) => (i >= 0 && i < r.length ? r[i].trim() : '')

  const market: Market = isUS ? 'US' : 'JP'

  for (let n = headerIdx + 1; n < rows.length; n++) {
    const r = rows[n]
    const rowNo = n + 1
    const date = parseDate(get(r, dateCol))
    const name = get(r, nameCol)
    if (!date || !name) continue // 합계·빈 행 등
    const accountName = routeAccount(get(r, acctCol))
    const rawCode = get(r, codeCol)
    // 코드가 없는 투신은 이름으로 식별자 생성 (공백 제거 후 20자 — 유사 이름 충돌 방지)
    const symbol = (rawCode || name.replace(/\s+/g, '').slice(0, 20)).toUpperCase()

    if (isDividendFile) {
      const net = parseAmount(get(r, netCol))
      if (net === null || net <= 0) {
        plan.errors.push(`${rowNo}행: 수취금액을 읽지 못했어요`)
        continue
      }
      const gross = parseAmount(get(r, grossCol)) ?? net
      const curVal = get(r, curCol)
      plan.dividends.push({
        accountName,
        symbol,
        name,
        market: /^[0-9]+$/.test(rawCode) ? 'JP' : rawCode ? 'US' : market,
        date,
        amountGross: gross,
        amountNet: net,
        currency: curVal.includes('ドル') ? 'USD' : 'JPY',
      })
      plan.counts.dividend++
      continue
    }

    // 매매 행 — 투신 매도는 解約, 만기상환은 償還
    const side = get(r, sideCol)
    const isBuy = side.includes('買')
    const isSell = side.includes('売') || side.includes('解約') || side.includes('償還')
    if (!isBuy && !isSell) continue // 입출고·이관 등은 건너뜀
    const qty = parseNumber(get(r, qtyCol))
    if (qty === null || qty <= 0) {
      plan.errors.push(`${rowNo}행: 수량을 읽지 못했어요`)
      continue
    }
    let price = parseNumber(get(r, priceCol))
    if (isFund) {
      // 単価는 1만 구좌당 기준가액 → 구좌당 단가로 환산
      const amount = parseAmount(get(r, fundAmountCol))
      if (amount !== null && amount > 0) price = amount / qty
      else if (price !== null) price = price / 10000
    }
    if (price === null || price <= 0) {
      plan.errors.push(`${rowNo}행: 단가를 읽지 못했어요`)
      continue
    }
    // 미국주식은 円貨결제여도 단가가 USD
    const currency: Currency = isFund ? 'JPY' : priceIsUSD ? 'USD' : 'JPY'
    plan.transactions.push({
      accountName,
      type: isBuy ? 'buy' : 'sell',
      market: isFund ? 'JP' : market,
      assetClass: isFund
        ? 'fund'
        : /ETF|上場|SP ?500|S&P|NASDAQ|NQ|DIV|INCM/i.test(name)
          ? 'etf'
          : 'stock',
      symbol,
      name,
      date,
      quantity: qty,
      price,
      currency,
      fee: parseNumber(get(r, feeCol)) ?? 0,
    })
    plan.counts[isBuy ? 'buy' : 'sell']++
  }
  return plan
}
