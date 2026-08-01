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
}
