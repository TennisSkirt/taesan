import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { ThemeProvider } from './theme'
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

export default function App() {
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
