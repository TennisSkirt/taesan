import { db } from '../db'

/** 앱 잠금 — WebCrypto PBKDF2-SHA256 해시 검증.
 *  접근 차단용 잠금이며, 저장 데이터 암호화는 동기화 단계에서 추가 예정. */

export interface LockData {
  salt: string // base64
  hash: string // base64
  iterations: number
}

const ITERATIONS = 300_000

function b64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}

function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256
  )
  return b64(bits)
}

export async function getLock(): Promise<LockData | null> {
  const row = await db.settings.get('appLock')
  return (row?.value as LockData | undefined) ?? null
}

export async function setLockPassword(password: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(password, salt, ITERATIONS)
  await db.settings.put({ key: 'appLock', value: { salt: b64(salt.buffer), hash, iterations: ITERATIONS } })
}

export async function verifyPassword(password: string, lock: LockData): Promise<boolean> {
  const hash = await derive(password, unb64(lock.salt), lock.iterations)
  return hash === lock.hash
}

export async function removeLock(): Promise<void> {
  await db.settings.delete('appLock')
  await db.settings.delete('bioUnlock')
}

/* ── 생체인증(WebAuthn) 잠금 해제 ──
 * 접근 차단용 잠금이므로 플랫폼 인증기(Face ID/Touch ID)의 본인 확인 성공 여부만 사용.
 * 등록 정보는 기기별(IndexedDB)이라 폰·노트북 각각 켜야 한다. */

export interface BioData {
  credId: string // base64
}

export async function bioAvailable(): Promise<boolean> {
  if (!('PublicKeyCredential' in window)) return false
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

export async function getBio(): Promise<BioData | null> {
  const row = await db.settings.get('bioUnlock')
  return (row?.value as BioData | undefined) ?? null
}

export async function enrollBio(): Promise<boolean> {
  try {
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: '태산' },
        user: {
          id: crypto.getRandomValues(new Uint8Array(16)),
          name: 'taesan',
          displayName: '태산',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null
    if (!cred) return false
    await db.settings.put({ key: 'bioUnlock', value: { credId: b64(cred.rawId) } })
    return true
  } catch {
    return false
  }
}

export async function verifyBio(bio: BioData): Promise<boolean> {
  try {
    const res = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: unb64(bio.credId) as BufferSource }],
        userVerification: 'required',
        timeout: 60_000,
      },
    })
    return !!res
  } catch {
    return false
  }
}

export async function removeBio(): Promise<void> {
  await db.settings.delete('bioUnlock')
}
