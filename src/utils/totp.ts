export type TotpAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-512'

export interface TotpConfig {
  secret: string
  algorithm: TotpAlgorithm
  digits: 6 | 8
  period: number
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function normalizeBase32Secret(secret: string) {
  return secret.toUpperCase().replace(/[\s\-=]/g, '')
}

export function decodeBase32(secret: string) {
  const normalized = normalizeBase32Secret(secret)
  if (!normalized) throw new Error('请输入 Base32 密钥')
  if (!/^[A-Z2-7]+$/.test(normalized)) throw new Error('密钥只能包含 A-Z 和 2-7')

  let bits = ''
  for (const character of normalized) {
    bits += BASE32_ALPHABET.indexOf(character).toString(2).padStart(5, '0')
  }

  const bytes = new Uint8Array(Math.floor(bits.length / 8))
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2)
  }
  if (!bytes.length) throw new Error('Base32 密钥长度不足')
  return bytes
}

export async function generateTotpCode(config: TotpConfig, timestamp = Date.now()) {
  if (!Number.isFinite(config.period) || config.period <= 0) throw new Error('刷新周期必须大于 0')
  const secretBytes = decodeBase32(config.secret)
  const counter = Math.floor(timestamp / 1000 / config.period)
  const counterBytes = new ArrayBuffer(8)
  const counterView = new DataView(counterBytes)
  counterView.setUint32(0, Math.floor(counter / 0x1_0000_0000), false)
  counterView.setUint32(4, counter >>> 0, false)

  const key = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(secretBytes),
    { name: 'HMAC', hash: config.algorithm },
    false,
    ['sign'],
  )
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes))
  const offset = signature[signature.length - 1] & 0x0f
  const binary = (
    ((signature[offset] & 0x7f) << 24)
    | ((signature[offset + 1] & 0xff) << 16)
    | ((signature[offset + 2] & 0xff) << 8)
    | (signature[offset + 3] & 0xff)
  ) >>> 0
  return String(binary % (10 ** config.digits)).padStart(config.digits, '0')
}
