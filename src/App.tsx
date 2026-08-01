import { useEffect, useRef, useState } from 'react'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { ThemeProvider } from './theme'
import type { LockData } from './lib/lock'
import LockScreen from './components/LockScreen'
import Icon from './components/Icon'
import Dashboard from './pages/Dashboard'
import Portfolio from './pages/Portfolio'
import Record from './pages/Record'
import Analysis from './pages/Analysis'
import Settings from './pages/Settings'

const tabs = [
  { to: '/', icon: 'home', label: '홈' },
  { to: '/portfolio', icon: 'account_balance_wallet', label: '자산' },
  { to: '/record', icon: 'add_circle', label: '기록' },
  { to: '/analysis', icon: 'bar_chart_4_bars', label: '분석' },
  { to: '/settings', icon: 'settings', label: '설정' },
]

/** 백그라운드로 나가 이 시간(ms)이 지나면 다시 잠김 */
const AUTO_LOCK_MS = 60_000

export default function App() {
  // undefined = 로딩 중, null = 잠금 없음
  const lockRow = useLiveQuery(() => db.settings.get('appLock').then((r) => r ?? null), [], undefined)
  const lock = (lockRow?.value as LockData | undefined) ?? null
  const [unlocked, setUnlocked] = useState(false)
  const hiddenAt = useRef<number | null>(null)

  // 잠금이 없는 상태로 시작했으면 해제 상태 유지 — 켜는 순간 바로 잠기지 않게
  useEffect(() => {
    if (lockRow === null) setUnlocked(true)
  }, [lockRow])

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt.current = Date.now()
      } else if (hiddenAt.current && Date.now() - hiddenAt.current > AUTO_LOCK_MS) {
        setUnlocked(false)
        hiddenAt.current = null
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // 잠금 여부 확인 전에는 내용을 노출하지 않음
  if (lockRow === undefined) {
    return <ThemeProvider>{null}</ThemeProvider>
  }

  if (lock && !unlocked) {
    return (
      <ThemeProvider>
        <LockScreen lock={lock} onUnlock={() => setUnlocked(true)} />
      </ThemeProvider>
    )
  }

  return (
    <ThemeProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <div className="app-shell">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/record" element={<Record />} />
            <Route path="/analysis" element={<Analysis />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
          <nav className="tabbar">
            {tabs.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.to === '/'}>
                <Icon name={t.icon} size={25} />
                <span className="lbl">{t.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      </BrowserRouter>
    </ThemeProvider>
  )
}
