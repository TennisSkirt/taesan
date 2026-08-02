import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { useTheme } from '../theme'
import { applyImportPlan, buildImportPlan, parseCsv, templateCsv } from '../lib/csvImport'
import { buildRakutenPlan, looksLikeRakuten } from '../lib/rakutenImport'
import { removeLock, setLockPassword, verifyPassword, type LockData } from '../lib/lock'
import { DEFAULT_FX, fxRate } from '../lib/portfolio'
import { DEFAULT_MAIN_CURRENCY } from '../lib/usePortfolio'
import {
  CURRENCY_LABEL,
  CURRENCY_SYMBOL,
  guessRegion,
  NISA_TYPE_LABEL,
  REGION_FLAG,
  REGION_LABEL,
  REGION_SUGGESTIONS,
  REGIONS,
  todayStr,
} from '../lib/format'
import type { Currency, Region } from '../types'
import Icon from '../components/Icon'
import TopBar from '../components/TopBar'

const CURRENCIES: Currency[] = ['JPY', 'KRW', 'USD']

export default function Settings() {
  const { theme, setTheme } = useTheme()
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], [])
  const fx = useLiveQuery(() => db.fxCache.toArray(), [], [])
  const mainSetting = useLiveQuery(() => db.settings.get('mainCurrency'), [], undefined)
  const main = (mainSetting?.value as Currency | undefined) ?? DEFAULT_MAIN_CURRENCY
  const lockRow = useLiveQuery(() => db.settings.get('appLock'), [], undefined)
  const lock = (lockRow?.value as LockData | undefined) ?? null
  const [showAccounts, setShowAccounts] = useState(false)
  const [newAcctRegion, setNewAcctRegion] = useState<Region>('JP')
  const [newAcctName, setNewAcctName] = useState('')
  const [showFx, setShowFx] = useState(false)
  const [showMain, setShowMain] = useState(false)
  const [showLock, setShowLock] = useState(false)
  const [curPw, setCurPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [newPw2, setNewPw2] = useState('')
  const [toast, setToast] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const csvRef = useRef<HTMLInputElement>(null)

  const usd = fxRate('USD', fx)
  const jpy = fxRate('JPY', fx)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 1800)
  }

  function clearPwInputs() {
    setCurPw('')
    setNewPw('')
    setNewPw2('')
  }

  async function enableLock() {
    if (newPw.length < 4) return showToast('비밀번호는 4자 이상으로 해주세요')
    if (newPw !== newPw2) return showToast('비밀번호 확인이 일치하지 않아요')
    await setLockPassword(newPw)
    clearPwInputs()
    setShowLock(false)
    showToast('앱 잠금을 켰어요')
  }

  async function changeLock() {
    if (!lock) return
    if (!(await verifyPassword(curPw, lock))) return showToast('현재 비밀번호가 맞지 않아요')
    if (newPw.length < 4) return showToast('새 비밀번호는 4자 이상으로 해주세요')
    if (newPw !== newPw2) return showToast('비밀번호 확인이 일치하지 않아요')
    await setLockPassword(newPw)
    clearPwInputs()
    setShowLock(false)
    showToast('비밀번호를 바꿨어요')
  }

  async function disableLock() {
    if (!lock) return
    if (!(await verifyPassword(curPw, lock))) return showToast('현재 비밀번호가 맞지 않아요')
    await removeLock()
    clearPwInputs()
    setShowLock(false)
    showToast('앱 잠금을 껐어요')
  }

  async function setFx(key: 'USD' | 'JPY', value: string) {
    const rate = Number(value)
    if (!isNaN(rate) && rate > 0) {
      await db.fxCache.put({ key, rate, updatedAt: todayStr() })
    }
  }

  async function addAccount() {
    const nm = newAcctName.trim()
    if (!nm) return
    const isNisa = /nisa|니사/i.test(nm)
    await db.accounts.add({
      name: nm,
      kind: 'brokerage',
      region: newAcctRegion,
      // 이름에 NISA/니사가 들어가면 자동으로 비과세 계좌 표시. 구NISA면 일반(5년)으로 시작
      nisa: isNisa || undefined,
      nisaType: isNisa ? (/구|旧|old/i.test(nm) ? 'ippan' : 'shin') : undefined,
      createdAt: todayStr(),
    })
    setNewAcctName('')
    showToast('계좌를 추가했어요')
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

  function downloadTemplate() {
    const blob = new Blob(['﻿' + templateCsv()], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'taesan-template.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  function decodeSmart(buf: ArrayBuffer): string {
    const utf8 = new TextDecoder('utf-8').decode(buf)
    if (!utf8.includes('�')) return utf8
    // 라쿠텐(Shift_JIS)·한글 엑셀(EUC-KR) 자동 감지
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
      if (/約定日|銘柄|口座|受渡/.test(t)) s += 20
      if (/구분|계좌|날짜|종목/.test(t)) s += 20
      return s
    }
    return candidates.sort((a, b) => scoreOf(b) - scoreOf(a))[0] ?? utf8
  }

  async function importCsv(file: File) {
    try {
      const text = decodeSmart(await file.arrayBuffer())
      const isRakuten = looksLikeRakuten(parseCsv(text))
      const plan = isRakuten ? buildRakutenPlan(text, accounts) : buildImportPlan(text, accounts)
      const total =
        plan.counts.buy + plan.counts.sell + plan.counts.dividend + plan.counts.cashIn + plan.counts.cashOut
      if (total === 0) {
        alert('가져올 수 있는 행이 없어요.\n' + plan.errors.slice(0, 5).join('\n'))
        return
      }
      const lines = [
        isRakuten ? '📄 라쿠텐증권 형식으로 인식했어요' : '📄 태산 템플릿 형식으로 인식했어요',
        `매수 ${plan.counts.buy} · 매도 ${plan.counts.sell} · 배당 ${plan.counts.dividend} · 입금 ${plan.counts.cashIn} · 출금 ${plan.counts.cashOut}`,
      ]
      if (plan.accountsToCreate.length > 0)
        lines.push(`새 계좌 생성: ${plan.accountsToCreate.map((a) => a.name).join(', ')}`)
      if (plan.errors.length > 0)
        lines.push(`⚠️ 건너뛰는 행 ${plan.errors.length}건:\n${plan.errors.slice(0, 5).join('\n')}`)
      if (!confirm(`CSV에서 ${total}건을 가져올까요?\n\n${lines.join('\n')}`)) return
      await applyImportPlan(plan)
      showToast(`${total}건을 가져왔어요`)
    } catch {
      showToast('CSV를 읽지 못했어요')
    }
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
      <TopBar title="설정" />

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
        {showAccounts && (
          <div className="list-item" style={{ background: 'var(--surface-2)' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="seg">
                {REGIONS.map((r) => (
                  <button key={r} className={newAcctRegion === r ? 'on' : ''} onClick={() => setNewAcctRegion(r)}>
                    {REGION_FLAG[r]} {REGION_LABEL[r]}
                  </button>
                ))}
              </div>
              <div className="input" style={{ padding: '10px 12px' }}>
                <input
                  placeholder={`계좌 이름 (예: ${REGION_SUGGESTIONS[newAcctRegion][0]})`}
                  value={newAcctName}
                  onChange={(e) => setNewAcctName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addAccount()}
                />
                {newAcctName.trim() !== '' && (
                  <button className="btn-ghost" onClick={addAccount}>
                    추가
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {REGION_SUGGESTIONS[newAcctRegion]
                  .filter((s) => !accounts.some((a) => a.name === s))
                  .map((s) => (
                    <button key={s} className="chip-btn" onClick={() => setNewAcctName(s)}>
                      {s}
                    </button>
                  ))}
              </div>
            </div>
          </div>
        )}
        {showAccounts &&
          accounts.map((a) => {
            const region: Region = a.region ?? guessRegion(a.name)
            return (
              <div className="list-item" key={a.id} style={{ background: 'var(--surface-2)' }}>
                <div className="item-main" style={{ paddingLeft: 46 }}>
                  <div className="item-name" style={{ fontSize: 14, fontWeight: 600 }}>{a.name}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {REGIONS.map((r) => (
                      <button
                        key={r}
                        className={`chip-btn ${region === r ? 'on' : ''}`}
                        style={{ fontSize: 11, padding: '3px 9px' }}
                        onClick={() => db.accounts.update(a.id!, { region: r })}
                      >
                        {REGION_FLAG[r]}
                      </button>
                    ))}
                    <button
                      className={`chip-btn ${a.nisa ? 'on' : ''}`}
                      style={{ fontSize: 11, padding: '3px 9px' }}
                      onClick={() => db.accounts.update(a.id!, { nisa: !a.nisa })}
                    >
                      NISA
                    </button>
                    {a.nisa &&
                      (['shin', 'ippan', 'tsumitate'] as const).map((t) => (
                        <button
                          key={t}
                          className={`chip-btn ${(a.nisaType ?? 'shin') === t ? 'on' : ''}`}
                          style={{ fontSize: 11, padding: '3px 9px' }}
                          onClick={() => db.accounts.update(a.id!, { nisaType: t })}
                        >
                          {NISA_TYPE_LABEL[t]}
                        </button>
                      ))}
                  </div>
                </div>
                <button className="btn-ghost" style={{ color: 'var(--up)' }} onClick={() => deleteAccount(a.id!, a.name)}>
                  삭제
                </button>
              </div>
            )
          })}

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

        {/* 앱 잠금 */}
        <div className="list-item" style={{ cursor: 'pointer' }} onClick={() => { setShowLock(!showLock); clearPwInputs() }}>
          <div className="item-icon" style={{ width: 34, height: 34, borderRadius: 10 }}>
            <Icon name="lock" size={19} />
          </div>
          <div className="item-main">
            <div className="item-name" style={{ fontSize: 15, fontWeight: 600 }}>앱 잠금</div>
            <div className="item-sub">{lock ? '켜짐 · 열 때 비밀번호 필요' : '꺼짐'}</div>
          </div>
          <Icon name={showLock ? 'expand_less' : 'chevron_right'} size={20} color="var(--text-3)" />
        </div>
        {showLock && (
          <div className="list-item" style={{ background: 'var(--surface-2)' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {lock && (
                <div className="input" style={{ padding: '10px 12px' }}>
                  <input
                    type="password"
                    placeholder="현재 비밀번호"
                    value={curPw}
                    onChange={(e) => setCurPw(e.target.value)}
                  />
                </div>
              )}
              <div className="input" style={{ padding: '10px 12px' }}>
                <input
                  type="password"
                  placeholder={lock ? '새 비밀번호 (4자 이상)' : '비밀번호 (4자 이상)'}
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                />
              </div>
              <div className="input" style={{ padding: '10px 12px' }}>
                <input
                  type="password"
                  placeholder="비밀번호 확인"
                  value={newPw2}
                  onChange={(e) => setNewPw2(e.target.value)}
                />
              </div>
              {lock ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-primary" style={{ flex: 1, padding: 12, fontSize: 14 }} onClick={changeLock}>
                    비밀번호 변경
                  </button>
                  <button
                    className="chip-btn"
                    style={{ flex: 1, borderRadius: 16, color: 'var(--up)' }}
                    onClick={disableLock}
                  >
                    잠금 끄기
                  </button>
                </div>
              ) : (
                <button className="btn-primary" style={{ padding: 12, fontSize: 14 }} onClick={enableLock}>
                  잠금 켜기
                </button>
              )}
              <p className="hint" style={{ lineHeight: 1.5 }}>
                앱을 열거나 1분 이상 화면을 벗어나면 비밀번호를 요구합니다. 비밀번호를 잊으면 초기화
                방법이 없으니 꼭 기억해주세요.
              </p>
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

        {/* CSV 가져오기 */}
        <div className="list-item" style={{ cursor: 'pointer' }} onClick={() => csvRef.current?.click()}>
          <div className="item-icon" style={{ width: 34, height: 34, borderRadius: 10 }}>
            <Icon name="table_view" size={19} />
          </div>
          <div className="item-main">
            <div className="item-name" style={{ fontSize: 15, fontWeight: 600 }}>CSV 가져오기</div>
            <div className="item-sub">
              라쿠텐증권 거래이력 CSV 또는 엑셀 정리본 ·{' '}
              <button
                className="btn-ghost"
                style={{ fontSize: 12 }}
                onClick={(e) => {
                  e.stopPropagation()
                  downloadTemplate()
                }}
              >
                템플릿 내려받기
              </button>
            </div>
          </div>
          <Icon name="chevron_right" size={20} color="var(--text-3)" />
          <input
            ref={csvRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) importCsv(f)
              e.target.value = ''
            }}
          />
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
