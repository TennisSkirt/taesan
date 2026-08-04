import { useEffect, useState } from 'react'
import { bioAvailable, getBio, verifyBio, verifyPassword, type BioData, type LockData } from '../lib/lock'
import Icon from './Icon'

interface Props {
  lock: LockData
  onUnlock: () => void
}

export default function LockScreen({ lock, onUnlock }: Props) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [checking, setChecking] = useState(false)
  const [bio, setBio] = useState<BioData | null>(null)
  const [bioBusy, setBioBusy] = useState(false)

  useEffect(() => {
    ;(async () => {
      if (!(await bioAvailable())) return
      setBio(await getBio())
    })()
  }, [])

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

  async function tryBio() {
    if (!bio || bioBusy) return
    setBioBusy(true)
    const ok = await verifyBio(bio)
    setBioBusy(false)
    if (ok) onUnlock()
  }

  return (
    <div className="lock-screen">
      <div className={`lock-card ${error ? 'shake' : ''}`}>
        <img src={`${import.meta.env.BASE_URL}lock-art.png`} alt="태산" className="lock-art" />
        <div className="lock-title">태산</div>
        <div className="hint">
          {bio ? '생체인증 또는 비밀번호로 잠금을 해제하세요' : '비밀번호를 입력해 잠금을 해제하세요'}
        </div>

        {bio && (
          <button
            className="btn-primary"
            style={{ marginTop: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            disabled={bioBusy}
            onClick={tryBio}
          >
            <Icon name="fingerprint" size={22} />
            {bioBusy ? '확인 중…' : '생체인증으로 해제'}
          </button>
        )}

        <div className="input" style={{ marginTop: bio ? 12 : 18, width: '100%' }}>
          <input
            type="password"
            placeholder="비밀번호"
            value={password}
            autoFocus={!bio}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>
        {error && (
          <div style={{ color: 'var(--up)', fontSize: 13, fontWeight: 700, marginTop: 10 }}>
            비밀번호가 맞지 않아요
          </div>
        )}
        <button
          className={bio ? 'chip-btn' : 'btn-primary'}
          style={bio ? { marginTop: 14, width: '100%', padding: 12, borderRadius: 16 } : { marginTop: 14 }}
          disabled={!password || checking}
          onClick={submit}
        >
          {checking ? '확인 중…' : '비밀번호로 해제'}
        </button>
      </div>
    </div>
  )
}
