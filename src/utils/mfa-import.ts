import { decodeBase32, normalizeBase32Secret, type TotpAlgorithm } from './totp'

export type MfaImportSource = 'otpauth' | 'base32' | 'json'

export interface ParsedMfaImport {
  issuer: string
  account: string
  secret: string
  algorithm: TotpAlgorithm
  digits: 6 | 8
  period: number
  source: MfaImportSource
}

export interface MfaImportIssue {
  index: number
  input: string
  message: string
}

export interface ParsedMfaImportBatch {
  accounts: ParsedMfaImport[]
  errors: MfaImportIssue[]
}

function readText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function parseAlgorithm(value: unknown): TotpAlgorithm {
  const normalized = readText(value).toUpperCase().replace(/[_\s-]/g, '')
  if (!normalized || normalized === 'SHA1') return 'SHA-1'
  if (normalized === 'SHA256') return 'SHA-256'
  if (normalized === 'SHA512') return 'SHA-512'
  throw new Error(`暂不支持 ${readText(value)} 算法`)
}

function parseDigits(value: unknown): 6 | 8 {
  if (value === undefined || value === null || value === '') return 6
  const parsed = Number(value)
  if (parsed === 6 || parsed === 8) return parsed
  throw new Error('验证码位数仅支持 6 位或 8 位')
}

function parsePeriod(value: unknown) {
  if (value === undefined || value === null || value === '') return 30
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3600) throw new Error('验证码刷新周期无效')
  return parsed
}

function parseLabel(label: string) {
  const separator = label.indexOf(':')
  if (separator < 0) return { issuer: '', account: label.trim() }
  return {
    issuer: label.slice(0, separator).trim(),
    account: label.slice(separator + 1).trim(),
  }
}

function validateImportedSecret(value: string) {
  const secret = normalizeBase32Secret(value)
  decodeBase32(secret)
  if (secret.length < 16) throw new Error('Base32 密钥长度至少需要 16 个字符')
  return secret
}

function parseOtpAuthUri(value: string): ParsedMfaImport {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('otpauth 地址格式不正确')
  }
  if (url.protocol !== 'otpauth:') throw new Error('不是有效的 otpauth 地址')
  if (url.hostname.toLowerCase() !== 'totp') throw new Error('当前仅支持 TOTP，暂不支持 HOTP')

  let decodedLabel = url.pathname.replace(/^\/+/, '')
  try {
    decodedLabel = decodeURIComponent(decodedLabel)
  } catch {
    throw new Error('otpauth 账户名称编码不正确')
  }
  const label = parseLabel(decodedLabel)
  const secret = validateImportedSecret(url.searchParams.get('secret') || '')
  const issuer = (url.searchParams.get('issuer') || label.issuer || 'MFA 账户').trim()
  const account = label.account || label.issuer || issuer

  return {
    issuer,
    account,
    secret,
    algorithm: parseAlgorithm(url.searchParams.get('algorithm')),
    digits: parseDigits(url.searchParams.get('digits')),
    period: parsePeriod(url.searchParams.get('period')),
    source: 'otpauth',
  }
}

function parseJsonObject(value: Record<string, unknown>): ParsedMfaImport {
  const nestedUri = readText(value.uri) || readText(value.otpauth) || readText(value.url)
  if (nestedUri.toLowerCase().startsWith('otpauth://')) return parseOtpAuthUri(nestedUri)

  const secret = validateImportedSecret(readText(value.secret) || readText(value.key))
  const rawLabel = readText(value.label)
  const label = parseLabel(rawLabel)
  const issuer = readText(value.issuer) || readText(value.provider) || readText(value.service) || label.issuer || 'MFA 账户'
  const account = readText(value.account) || readText(value.email) || readText(value.name) || label.account || issuer
  return {
    issuer,
    account,
    secret,
    algorithm: parseAlgorithm(value.algorithm),
    digits: parseDigits(value.digits),
    period: parsePeriod(value.period),
    source: 'json',
  }
}

function parseJsonValue(value: unknown): ParsedMfaImport {
  if (typeof value === 'string') return parseMfaImport(value)
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('JSON 中没有可识别的 MFA 数据')
  return parseJsonObject(value as Record<string, unknown>)
}

export function parseMfaImport(input: string): ParsedMfaImport {
  const value = input.trim()
  if (!value) throw new Error('请粘贴 MFA 密钥或 otpauth 地址')

  const uriStart = value.toLowerCase().indexOf('otpauth://')
  if (uriStart >= 0) {
    const uri = value.slice(uriStart).split(/\s/)[0]
    return parseOtpAuthUri(uri)
  }

  if (value.startsWith('{') || value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value) as unknown
      return parseJsonValue(parsed)
    } catch (reason) {
      if (reason instanceof SyntaxError) throw new Error('JSON 格式不正确')
      throw reason
    }
  }

  const secret = validateImportedSecret(value)
  return {
    issuer: 'MFA 账户',
    account: '',
    secret,
    algorithm: 'SHA-1',
    digits: 6,
    period: 30,
    source: 'base32',
  }
}

function summarizeInput(value: unknown) {
  if (typeof value === 'string') return value.trim().slice(0, 90)
  try {
    return JSON.stringify(value).slice(0, 90)
  } catch {
    return '无法读取的项目'
  }
}

export function parseMfaImports(input: string): ParsedMfaImportBatch {
  const value = input.trim()
  if (!value) return { accounts: [], errors: [] }

  const accounts: ParsedMfaImport[] = []
  const errors: MfaImportIssue[] = []
  let entries: unknown[]

  if (value.startsWith('[')) {
    try {
      const parsed = JSON.parse(value) as unknown
      if (!Array.isArray(parsed)) throw new Error('批量 JSON 必须是数组')
      entries = parsed
    } catch (reason) {
      return {
        accounts,
        errors: [{
          index: 0,
          input: value.slice(0, 90),
          message: reason instanceof SyntaxError ? 'JSON 数组格式不正确' : reason instanceof Error ? reason.message : 'JSON 数组格式不正确',
        }],
      }
    }
  } else if (value.startsWith('{') || value.startsWith('"')) {
    entries = [value]
  } else {
    const otpAuthUris = value.match(/otpauth:\/\/[^\s]+/gi) || []
    const lines = value.split(/\r?\n/).map(item => item.trim()).filter(Boolean)
    entries = lines.length > 1 ? lines : otpAuthUris.length > 1 ? otpAuthUris : [value]
  }

  entries.forEach((entry, index) => {
    try {
      accounts.push(typeof entry === 'string' && (entry.trim().startsWith('{') || entry.trim().startsWith('"'))
        ? parseMfaImport(entry)
        : parseJsonValue(entry))
    } catch (reason) {
      errors.push({
        index,
        input: summarizeInput(entry),
        message: reason instanceof Error ? reason.message : '无法识别这条 MFA 数据',
      })
    }
  })

  return { accounts, errors }
}
