import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { useTheme } from '../theme'
import { DEFAULT_FX, fxRate } from '../lib/portfolio'
import { DEFAULT_MAIN_CURRENCY } from '../lib/usePortfolio'
import { CURRENCY_LABEL, CURRENCY_SYMBOL, todayStr } from '../lib/format'
import type { Currency } from '../types'
import Icon from '../components/Icon'

const CURRENCIES: Currency[] = ['JPY', 'KRW', 'USD']

export default function Settings() {
  const { theme, setTheme } = useTheme()
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], [])
  const fx = useLiveQuery(() => db.fxCache.toArray(), [], [])
  const mainSetting = useLiveQuery(() => db.settings.get('mainCurrency'), [], undefined)
  const main = (mainSetting?.value as Currency | undefined) ?? DEFAULT_MAIN_CURRENCY
  const [showAccounts, setShowAccounts] = useState(false)
  const [showFx, setShowFx] = useState(false)
  const [showMain, setShowMain] = useState(false)
  const [toast, setToast] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const usd = fxRate('USD', fx)
  const jpy = fxRate('JPY', fx)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 1800)
  }

  async function setFx(key: 'USD' | 'JPY', value: string) {
    const rate = Number(value)
    if (!isNaN(rate) && rate > 0) {
      await db.fxCache.put({ key, rate, updatedAt: todayStr() })
    }
  }

  async function deleteAccount(id: number, name: string) {
    const [txCount, cashCount] = await Promise.all([
      db.transactions.where('accountId').equals(id).count(),
      db.cashTxs.where('accountId').equals(id).count(),
    ])
    if (txCount + cashCount > 0) {
      if (!confirm(`${name} 계좌에 기록 ${txCount + cashCount}건이 있어요. 계좌와 기록을 모두 삭제할까요?`))
        return
      await db.transactions.where('accountId').equals(id).delete()
      await db.dividends.where('accountId').equals(id).delete()
      await db.cashTxs.where('accountId').equals(id).delete()
      await db.cashTxs.where('fromAccountId').equals(id).delete()
    }
    await db.accounts.delete(id)
    showToast('계좌를 삭제했어요')
  }

  async function exportData() {
    const data = {
      app: '태산',
      version: 1,
      exportedAt: new Date().toISOString(),
      accounts: await db.accounts.toArray(),
      transactions: await db.transactions.toArray(),
      dividends: await db.dividends.toArray(),
      cashTxs: await db.cashTxs.toArray(),
      manualAssets: await db.manualAssets.toArray(),
      snapshots: await db.snapshots.toArray(),
      fxCache: await db.fxCache.toArray(),
      settings: await db.settings.toArray(),
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `taesan-backup-${todayStr()}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    showToast('백업 파일을 내보냈어요')
  }

  async function importData(file: File) {
    try {
      const data = JSON.parse(await file.text())
      if (data.app !== '태산') throw new Error('형식이 다른 파일')
      if (!confirm('백업을 불러오면 현재 데이터에 백업 내용을 덮어씁니다. 계속할까요?')) return
      await db.transaction(
        'rw',
        [db.accounts, db.transactions, db.dividends, db.cashTxs, db.manualAssets, db.snapshots, db.fxCache, db.settings],
        async () => {
          if (data.accounts) await db.accounts.bulkPut(data.accounts)
          if (data.transactions) await db.transactions.bulkPut(data.transactions)
          if (data.dividends) await db.dividends.bulkPut(data.dividends)
          if (data.cashTxs) await db.cashTxs.bulkPut(data.cashTxs)
          if (data.manualAssets) await db.manualAssets.bulkPut(data.manualAssets)
          if (data.snapshots) await db.snapshots.bulkPut(data.snapshots)
          if (data.fxCache) await db.fxCache.bulkPut(data.fxCache)
          if (data.settings) await db.settings.bulkPut(data.settings)
        }
      )
      showToast('백업을 불러왔어요')
    } catch {
      showToast('백업 파일을 읽지 못했어요')
    }
  }

  return (
    <main className="page">
      <div className="page-title">설정</div>

      <div className="list">
        {/* 메인 통화 */}
        <div className="list-item" style={{ cursor: 'pointer' }} onClick={() => setShowMain(!showMain)}>
          <div className="item-icon" style={{ width: 34, height: 34, borderRadius: 10 }}>
            <Icon name="payments" size={19} />
          </div>
          <div className="item-main">
            <div className="item-name" style={{ fontSize: 15, fontWeight: 600 }}>메인 통화</div>
            <div className="item-sub">
              {CURRENCY_SYMBOL[main]} {CURRENCY_LABEL[main]} — 총자산·수익을 이 통화로 표시
            </div>
          </div>
          <Icon name={showMain ? 'expand_less' : 'chevron_right'} size={20} color="var(--text-3)" />
        </div>
        {showMain && (
          <div className="list-item" style={{ background: 'var(--surface-2)' }}>
            <div className="seg" style={{ flex: 1 }}>
              {CURRENCIES.map((c) => (
                <button
                  key={c}
                  className={main === c ? 'on' : ''}
                  onClick={async () => {
                    await db.settings.put({ key: 'mainCurrency', value: c })
                    showToast(`메인 통화를 ${CURRENCY_LABEL[c]}로 바꿨어요`)
                  }}
                >
                  {CURRENCY_SYMBOL[c]} {CURRENCY_LABEL[c]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 계좌 관리 */}
        <div className="list-item" style={{ cursor: 'pointer' }} onClick={() => setShowAccounts(!showAccounts)}>
          <div className="item-icon" style={{ width: 34, height: 34, borderRadius: 10 }}>
            <Icon name="account_balance" size={19} />
          </div>
          <div className="item-main">
            <div className="item-name" style={{ fontSize: 15, fontWeight: 600 }}>계좌 관리</div>
            <div className="item-sub">{accounts.length}개 계좌</div>
          </div>
          <Icon name={showAccounts ? 'expand_less' : 'chevron_right'} size={20} color="var(--text-3)" />
        </div>
        {showAccounts &&
          accounts.map((a) => (
            <div className="list-item" key={a.id} style={{ background: 'var(--surface-2)' }}>
              <div className="item-main" style={{ paddingLeft: 46 }}>
                <div className="item-name" style={{ fontSize: 14, fontWeight: 600 }}>{a.name}</div>
              </div>
              <button
                className={`chip-btn ${a.nisa ? 'on' : ''}`}
                style={{ fontSize: 11, padding: '4px 10px' }}
                onClick={() => db.accounts.update(a.id!, { nisa: !a.nisa })}
              >
                NISA
              </button>
              <button className="btn-ghost" style={{ color: 'var(--up)' }} onClick={() => deleteAccount(a.id!, a.name)}>
                삭제
              </button>
            </div>
          ))}

        {/* 환율 */}
        <div className="list-item" style={{ cursor: 'pointer' }} onClick={() => setShowFx(!showFx)}>
          <div className="item-icon" style={{ width: 34, height: 34, borderRadius: 10 }}>
            <Icon name="currency_exchange" size={19} />
          </div>
          <div className="item-main">
            <div className="item-name" style={{ fontSize: 15, fontWeight: 600 }}>환율 · 통화</div>
            <div className="item-sub">
              USD {usd.toLocaleString('ko-KR')} · JPY {jpy}
            </div>
          </div>
          <Icon name={showFx ? 'expand_less' : 'chevron_right'} size={20} color="var(--text-3)" />
        </div>
        {showFx && (
          <div className="list-item" style={{ background: 'var(--surface-2)' }}>
            <div style={{ flex: 1, display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div className="field-label" style={{ marginBottom: 6 }}>1 USD = ₩</div>
                <div className="input" style={{ padding: '10px 12px' }}>
                  <input type="number" inputMode="decimal" defaultValue={usd} onBlur={(e) => setFx('USD', e.target.value)} />
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <div className="field-label" style={{ marginBottom: 6 }}>1 JPY = ₩</div>
                <div className="input" style={{ padding: '10px 12px' }}>
                  <input type="number" inputMode="decimal" step="0.01" defaultValue={jpy} onBlur={(e) => setFx('JPY', e.target.value)} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 다크 모드 */}
        <div className="list-item">
          <div className="item-icon" style={{ width: 34, height: 34, borderRadius: 10 }}>
            <Icon name="dark_mode" size={19} />
          </div>
          <div className="item-main">
            <div className="item-name" style={{ fontSize: 15, fontWeight: 600 }}>다크 모드</div>
            <div className="item-sub">{theme === 'dark' ? '켜짐' : '꺼짐'}</div>
          </div>
          <button
            className={`switch ${theme === 'dark' ? 'on' : ''}`}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label="다크 모드 전환"
          >
            <span className="knob" />
          </button>
        </div>

        {/* 백업 */}
        <div className="list-item" style={{ cursor: 'pointer' }} onClick={exportData}>
          <div className="item-icon" style={{ width: 34, height: 34, borderRadius: 10 }}>
            <Icon name="download" size={19} />
          </div>
          <div className="item-main">
            <div className="item-name" style={{ fontSize: 15, fontWeight: 600 }}>백업 내보내기</div>
            <div className="item-sub">모든 기록을 JSON 파일로 저장</div>
          </div>
          <Icon name="chevron_right" size={20} color="var(--text-3)" />
        </div>
        <div className="list-item" style={{ cursor: 'pointer' }} onClick={() => fileRef.current?.click()}>
          <div className="item-icon" style={{ width: 34, height: 34, borderRadius: 10 }}>
            <Icon name="upload" size={19} />
          </div>
          <div className="item-main">
            <div className="item-name" style={{ fontSize: 15, fontWeight: 600 }}>백업 불러오기</div>
            <div className="item-sub">다른 기기의 백업 파일 복원</div>
          </div>
          <Icon name="chevron_right" size={20} color="var(--text-3)" />
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) importData(f)
              e.target.value = ''
            }}
          />
        </div>
      </div>

      <div className="hint" style={{ textAlign: 'center', marginTop: 8 }}>
        태산 1.0 · 환율 기본값 USD {DEFAULT_FX.USD} · JPY {DEFAULT_FX.JPY}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </main>
  )
}
