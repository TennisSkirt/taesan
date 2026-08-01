import { useState } from 'react'
import { verifyPassword, type LockData } from '../lib/lock'

interface Props {
  lock: LockData
  onUnlock: () => void
}

export default function LockScreen({ lock, onUnlock }: Props) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [checking, setChecking] = useState(false)

  async function submit() {
    if (!password || checking) return
    setChecking(true)
    const ok = await verifyPassword(password, lock)
    setChecking(false)
    if (ok) {
      setPassword('')
      onUnlock()
    } else {
      setError(true)
      setPassword('')
      setTimeout(() => setError(false), 1200)
    }
  }

  return (
    <div className="lock-screen">
      <div className={`lock-card ${error ? 'shake' : ''}`}>
        <img src={`${import.meta.env.BASE_URL}lock-art.png`} alt="태산" className="lock-art" />
        <div className="lock-title">태산</div>
        <div className="hint">비밀번호를 입력해 잠금을 해제하세요</div>
        <div className="input" style={{ marginTop: 18, width: '100%' }}>
          <input
            type="password"
            placeholder="비밀번호"
            value={password}
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>
        {error && (
          <div style={{ color: 'var(--up)', fontSize: 13, fontWeight: 700, marginTop: 10 }}>
            비밀번호가 맞지 않아요
          </div>
        )}
        <button className="btn-primary" style={{ marginTop: 14 }} disabled={!password || checking} onClick={submit}>
          {checking ? '확인 중…' : '잠금 해제'}
        </button>
      </div>
    </div>
  )
}
