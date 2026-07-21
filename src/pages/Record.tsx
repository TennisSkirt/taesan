import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import type { AssetClass, Currency, Market } from '../types'
import { MARKET_CURRENCY, MARKET_LABEL, CURRENCY_SYMBOL, fmtMoney, todayStr } from '../lib/format'
import Icon from '../components/Icon'

type Tab = 'buy' | 'sell' | 'dividend' | 'cash'
type CashDir = 'in' | 'out'

const ACCOUNT_SUGGESTIONS = ['토스증권', 'NH투자증권', 'E*TRADE', '라쿠텐증권', '라쿠텐 NISA']
const IN_SOURCES = ['월급', '용돈', '이자', '기존 자산', '기타']
const OUT_SOURCES = ['생활비', '경조사', '인출', '기타']

export default function Record() {
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], [])
  const [tab, setTab] = useState<Tab>('buy')
  const [accountId, setAccountId] = useState<number | ''>('')
  const [newAccount, setNewAccount] = useState('')
  const [market, setMarket] = useState<Market>('KR')
  const [assetClass, setAssetClass] = useState<AssetClass>('stock')
  const [symbol, setSymbol] = useState('')
  const [name, setName] = useState('')
  const [date, setDate] = useState(todayStr())
  const [qty, setQty] = useState('')
  const [price, setPrice] = useState('')
  const [fee, setFee] = useState('')
  const [gross, setGross] = useState('')
  const [net, setNet] = useState('')
  // 입출금
  const [cashDir, setCashDir] = useState<CashDir>('in')
  const [cashCurrency, setCashCurrency] = useState<Currency>('KRW')
  const [cashAmount, setCashAmount] = useState('')
  const [party, setParty] = useState('') // `acct:${id}` 또는 `ext:${label}`
  const [customSource, setCustomSource] = useState('')
  const [toast, setToast] = useState('')

  const currency = tab === 'cash' ? cashCurrency : MARKET_CURRENCY[market]
  const sym = CURRENCY_SYMBOL[currency]

  const recent = useLiveQuery(
    async () => {
      const [txs, divs, cash, accs] = await Promise.all([
        db.transactions.orderBy('date').reverse().limit(5).toArray(),
        db.dividends.orderBy('date').reverse().limit(5).toArray(),
        db.cashTxs.orderBy('date').reverse().limit(5).toArray(),
        db.accounts.toArray(),
      ])
      const accName = (id?: number) => accs.find((a) => a.id === id)?.name ?? '?'
      const items = [
        ...txs.map((t) => ({
          kind: t.type as string,
          name: `${t.name} · ${t.quantity}주 @ ${fmtMoney(t.price, t.currency)}`,
          date: t.date,
          amount: fmtMoney(t.quantity * t.price, t.currency),
        })),
        ...divs.map((d) => ({
          kind: 'dividend',
          name: `${d.name} 배당`,
          date: d.date,
          amount: '+' + fmtMoney(d.amountNet, d.currency),
        })),
        ...cash.map((c) => ({
          kind: c.type === 'transfer' ? 'transfer' : c.type === 'in' ? 'cash-in' : 'cash-out',
          name:
            c.type === 'transfer'
              ? `${accName(c.fromAccountId)} → ${accName(c.accountId)}`
              : c.type === 'in'
                ? `${accName(c.accountId)} 입금 · ${c.source ?? ''}`
                : `${accName(c.accountId)} 출금 · ${c.source ?? ''}`,
          date: c.date,
          amount: (c.type === 'out' ? '-' : '+') + fmtMoney(c.amount, c.currency),
        })),
      ]
      return items.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6)
    },
    [],
    []
  )

  async function addAccount() {
    const nm = newAccount.trim()
    if (!nm) return
    const id = await db.accounts.add({
      name: nm,
      kind: 'brokerage',
      // 이름에 NISA/니사가 들어가면 자동으로 비과세 계좌 표시 (설정에서 변경 가능)
      nisa: /nisa|니사/i.test(nm) || undefined,
      createdAt: todayStr(),
    })
    setAccountId(id as number)
    setNewAccount('')
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 1800)
  }

  const numOk = (s: string) => s !== '' && !isNaN(Number(s)) && Number(s) > 0

  const partyOk =
    party !== '' && (party !== 'ext:기타' || customSource.trim() !== '') && party !== `acct:${accountId}`

  const canSave =
    accountId !== '' &&
    date !== '' &&
    (tab === 'cash'
      ? numOk(cashAmount) && partyOk
      : symbol.trim() !== '' &&
        name.trim() !== '' &&
        (tab === 'dividend' ? numOk(net) : numOk(qty) && numOk(price)))

  async function save() {
    if (accountId === '' || !canSave) return
    if (tab === 'cash') {
      const amount = Number(cashAmount)
      if (party.startsWith('acct:')) {
        const other = Number(party.slice(5))
        await db.cashTxs.add({
          type: 'transfer',
          accountId: cashDir === 'in' ? accountId : other,
          fromAccountId: cashDir === 'in' ? other : accountId,
          amount,
          currency: cashCurrency,
          date,
        })
      } else {
        const label = party === 'ext:기타' ? customSource.trim() : party.slice(4)
        await db.cashTxs.add({
          type: cashDir,
          accountId,
          source: label,
          amount,
          currency: cashCurrency,
          date,
        })
      }
      setCashAmount('')
      setParty('')
      setCustomSource('')
      showToast(cashDir === 'in' ? '입금을 기록했어요' : '출금을 기록했어요')
    } else if (tab === 'dividend') {
      await db.dividends.add({
        accountId,
        symbol: symbol.trim().toUpperCase(),
        name: name.trim(),
        market,
        date,
        amountGross: numOk(gross) ? Number(gross) : Number(net),
        amountNet: Number(net),
        currency,
      })
      setGross('')
      setNet('')
      showToast('배당을 기록했어요')
    } else {
      await db.transactions.add({
        accountId,
        type: tab,
        market,
        assetClass,
        symbol: symbol.trim().toUpperCase(),
        name: name.trim(),
        date,
        quantity: Number(qty),
        price: Number(price),
        currency,
        fee: numOk(fee) ? Number(fee) : 0,
      })
      setQty('')
      setPrice('')
      setFee('')
      showToast(tab === 'buy' ? '매수를 기록했어요' : '매도를 기록했어요')
    }
  }

  const total = numOk(qty) && numOk(price) ? Number(qty) * Number(price) : 0
  const sources = cashDir === 'in' ? IN_SOURCES : OUT_SOURCES
  const otherAccounts = accounts.filter((a) => a.id !== accountId)

  return (
    <main className="page">
      <div className="page-title">기록</div>

      <div className="seg">
        {(['buy', 'sell', 'dividend', 'cash'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'buy' ? '매수' : t === 'sell' ? '매도' : t === 'dividend' ? '배당' : '입출금'}
          </button>
        ))}
      </div>

      {tab === 'cash' && (
        <div>
          <div className="field-label">방향</div>
          <div className="seg">
            <button className={cashDir === 'in' ? 'on' : ''} onClick={() => { setCashDir('in'); setParty('') }}>
              입금
            </button>
            <button className={cashDir === 'out' ? 'on' : ''} onClick={() => { setCashDir('out'); setParty('') }}>
              출금
            </button>
          </div>
        </div>
      )}

      {/* 계좌 */}
      <div>
        <div className="field-label">{tab === 'cash' ? (cashDir === 'in' ? '입금할 계좌' : '출금할 계좌') : '계좌'}</div>
        {accounts.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {accounts.map((a) => (
              <button
                key={a.id}
                className={`chip-btn ${accountId === a.id ? 'on' : ''}`}
                onClick={() => setAccountId(a.id!)}
              >
                {a.name}
              </button>
            ))}
          </div>
        )}
        <div className="input">
          <Icon name="add" size={19} color="var(--text-3)" />
          <input
            placeholder={accounts.length === 0 ? '계좌 이름 입력 (예: 토스증권)' : '새 계좌 추가'}
            value={newAccount}
            onChange={(e) => setNewAccount(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addAccount()}
          />
          {newAccount.trim() !== '' && (
            <button className="btn-ghost" onClick={addAccount}>
              추가
            </button>
          )}
        </div>
        {accounts.length === 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {ACCOUNT_SUGGESTIONS.map((s) => (
              <button key={s} className="chip-btn" onClick={() => setNewAccount(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === 'cash' ? (
        <>
          {/* 통화 + 금액 */}
          <div>
            <div className="field-label">통화</div>
            <div className="seg">
              {(['KRW', 'USD', 'JPY'] as Currency[]).map((c) => (
                <button key={c} className={cashCurrency === c ? 'on' : ''} onClick={() => setCashCurrency(c)}>
                  {CURRENCY_SYMBOL[c]} {c}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="field-label">금액</div>
            <div className="input">
              <span className="unit">{CURRENCY_SYMBOL[cashCurrency]}</span>
              <input
                type="number"
                inputMode="decimal"
                placeholder={cashCurrency === 'KRW' ? '1000000' : cashCurrency === 'USD' ? '1000' : '10000'}
                value={cashAmount}
                onChange={(e) => setCashAmount(e.target.value)}
              />
            </div>
          </div>

          {/* 상대 선택 */}
          <div>
            <div className="field-label">{cashDir === 'in' ? '어디서 온 돈인가요?' : '어디로 가는 돈인가요?'}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {otherAccounts.map((a) => (
                <button
                  key={a.id}
                  className={`chip-btn ${party === `acct:${a.id}` ? 'on' : ''}`}
                  onClick={() => setParty(`acct:${a.id}`)}
                >
                  <Icon name="account_balance" size={14} /> {a.name}
                </button>
              ))}
              {sources.map((s) => (
                <button
                  key={s}
                  className={`chip-btn ${party === `ext:${s}` ? 'on' : ''}`}
                  onClick={() => setParty(`ext:${s}`)}
                >
                  {s}
                </button>
              ))}
            </div>
            {party.startsWith('acct:') && (
              <p className="hint" style={{ marginTop: 8 }}>
                {cashDir === 'in'
                  ? '선택한 계좌에서 같은 금액이 빠져나갑니다 (계좌 간 이체)'
                  : '선택한 계좌로 같은 금액이 들어갑니다 (계좌 간 이체)'}
              </p>
            )}
            {party === 'ext:기타' && (
              <div className="input" style={{ marginTop: 10 }}>
                <input
                  placeholder={cashDir === 'in' ? '출처 직접 입력 (예: 상여금)' : '사용처 직접 입력'}
                  value={customSource}
                  onChange={(e) => setCustomSource(e.target.value)}
                />
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* 시장 */}
          <div>
            <div className="field-label">시장</div>
            <div className="seg">
              {(['KR', 'US', 'JP'] as Market[]).map((m) => (
                <button key={m} className={market === m ? 'on' : ''} onClick={() => setMarket(m)}>
                  {MARKET_LABEL[m]} {CURRENCY_SYMBOL[MARKET_CURRENCY[m]]}
                </button>
              ))}
            </div>
          </div>

          {/* 종목 */}
          <div className="grid2">
            <div>
              <div className="field-label">종목명</div>
              <div className="input">
                <input placeholder="삼성전자" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            </div>
            <div>
              <div className="field-label">코드 · 티커</div>
              <div className="input">
                <input
                  placeholder={market === 'KR' ? '005930' : market === 'US' ? 'AAPL' : '7203'}
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                />
              </div>
            </div>
          </div>

          {tab !== 'dividend' && (
            <div>
              <div className="field-label">종류</div>
              <div className="seg">
                <button className={assetClass === 'stock' ? 'on' : ''} onClick={() => setAssetClass('stock')}>
                  주식
                </button>
                <button className={assetClass === 'etf' ? 'on' : ''} onClick={() => setAssetClass('etf')}>
                  ETF
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* 날짜 */}
      <div>
        <div className="field-label">날짜</div>
        <div className="input">
          <Icon name="calendar_today" size={18} color="var(--text-3)" />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      {tab === 'buy' || tab === 'sell' ? (
        <>
          <div className="grid2">
            <div>
              <div className="field-label">수량</div>
              <div className="input">
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="10"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
                <span className="unit">주</span>
              </div>
            </div>
            <div>
              <div className="field-label">단가</div>
              <div className="input">
                <span className="unit">{sym}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder={market === 'KR' ? '72000' : market === 'US' ? '189.60' : '2840'}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </div>
            </div>
          </div>
          <div>
            <div className="field-label">수수료 (선택)</div>
            <div className="input">
              <span className="unit">{sym}</span>
              <input
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
              />
            </div>
          </div>
          <div
            className="card-sm"
            style={{
              background: 'var(--surface-2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              boxShadow: 'none',
            }}
          >
            <span className="label">총 {tab === 'buy' ? '매수' : '매도'}금액</span>
            <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em' }}>
              {fmtMoney(total, currency)}
            </span>
          </div>
        </>
      ) : tab === 'dividend' ? (
        <div className="grid2">
          <div>
            <div className="field-label">세전 금액 (선택)</div>
            <div className="input">
              <span className="unit">{sym}</span>
              <input
                type="number"
                inputMode="decimal"
                placeholder="50000"
                value={gross}
                onChange={(e) => setGross(e.target.value)}
              />
            </div>
          </div>
          <div>
            <div className="field-label">실수령액 (세후)</div>
            <div className="input">
              <span className="unit">{sym}</span>
              <input
                type="number"
                inputMode="decimal"
                placeholder="43200"
                value={net}
                onChange={(e) => setNet(e.target.value)}
              />
            </div>
          </div>
        </div>
      ) : null}

      <button className="btn-primary" disabled={!canSave} onClick={save}>
        {tab === 'buy'
          ? '매수 기록하기'
          : tab === 'sell'
            ? '매도 기록하기'
            : tab === 'dividend'
              ? '배당 기록하기'
              : cashDir === 'in'
                ? '입금 기록하기'
                : '출금 기록하기'}
      </button>

      {recent.length > 0 && (
        <>
          <div className="section-head">
            <div className="t" style={{ fontSize: 14 }}>
              최근 기록
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recent.map((r, i) => {
              const tag =
                r.kind === 'buy'
                  ? { label: '매수', bg: 'var(--up-weak)', color: 'var(--up)' }
                  : r.kind === 'sell'
                    ? { label: '매도', bg: 'var(--down-weak)', color: 'var(--down)' }
                    : r.kind === 'dividend'
                      ? { label: '배당', bg: 'var(--accent-weak)', color: 'var(--accent)' }
                      : r.kind === 'transfer'
                        ? { label: '이체', bg: 'var(--surface-3)', color: 'var(--text-2)' }
                        : r.kind === 'cash-in'
                          ? { label: '입금', bg: 'var(--accent-weak)', color: 'var(--accent)' }
                          : { label: '출금', bg: 'var(--surface-3)', color: 'var(--text-2)' }
              return (
                <div
                  key={i}
                  className="list-item"
                  style={{ borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  <div
                    className="item-icon"
                    style={{ width: 32, height: 32, borderRadius: 9, fontSize: 12, background: tag.bg, color: tag.color }}
                  >
                    {tag.label}
                  </div>
                  <div className="item-main">
                    <div className="item-name" style={{ fontSize: 14 }}>
                      {r.name}
                    </div>
                    <div className="item-sub">{r.date}</div>
                  </div>
                  <div className="item-value" style={{ fontSize: 14 }}>
                    {r.amount}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </main>
  )
}
