import type { ApiFlow, ApiFlowExtractor, ApiFlowRequest, ApiFlowStep, ApiFlowVariable, NetworkRecord } from '../types'

type Scalar = string | number | boolean | null
type ScalarEntry = { path: string; key: string; value: Scalar; arrayPath?: string; valueField?: string }
type RequestTarget = { kind: 'query' | 'body'; path: string; key: string; value: Scalar }

const ignoredHeaders = new Set([
  'accept-encoding',
  'connection',
  'content-length',
  'cookie',
  'host',
  'origin',
  'referer',
  'user-agent',
])

function restoreEncodedTemplateTokens(value: string) {
  return value.replace(/%7B%7B(?:%20|\+)*([a-zA-Z_$][\w$]*)(?:%20|\+)*%7D%7D/gi, '{{$1}}')
}

function parseJson(value?: string) {
  if (!value?.trim()) return undefined
  try { return JSON.parse(value) } catch { return undefined }
}

function parseEmbeddedJson(value: unknown): unknown {
  let current = value
  for (let depth = 0; depth < 4 && typeof current === 'string'; depth += 1) {
    const trimmed = current.trim().replace(/^\uFEFF/, '')
    if (!trimmed || !/^[{[]/.test(trimmed)) break
    try {
      current = JSON.parse(trimmed)
    } catch {
      break
    }
  }
  return current
}

export function parseApiFlowResponse(value = ''): unknown {
  let normalized = value.trim().replace(/^\uFEFF/, '')
  normalized = normalized.replace(/^\)\]\}',?\s*/, '').replace(/^while\s*\(\s*1\s*\)\s*;?\s*/, '')
  const direct = parseJson(normalized)
  if (direct !== undefined) return parseEmbeddedJson(direct)
  const jsonp = normalized.match(/^[\w$.]+\s*\(([\s\S]*)\)\s*;?\s*$/)
  if (jsonp) {
    const parsed = parseJson(jsonp[1])
    if (parsed !== undefined) return parseEmbeddedJson(parsed)
  }
  return value
}

function responseSample(value?: string) {
  if (!value) return undefined
  const parsed = parseApiFlowResponse(value)
  return (typeof parsed === 'string' && parsed === value ? value : JSON.stringify(parsed, null, 2)).slice(0, 200_000)
}

function safeName(value: string, fallback = 'value') {
  const normalized = value
    .replace(/^[^a-zA-Z_$]+/, '')
    .replace(/[^a-zA-Z0-9_$]+(.)?/g, (_, next = '') => next.toUpperCase())
  return normalized || fallback
}

function uniqueVariableName(preferred: string, names: Set<string>) {
  const base = safeName(preferred)
  let name = base
  let index = 2
  while (names.has(name)) name = `${base}${index++}`
  names.add(name)
  return name
}

function flattenScalars(value: unknown, path = '$', output: ScalarEntry[] = [], arrayRoot?: string, valueField?: string) {
  if (output.length > 5000) return output
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    const key = path.match(/(?:\.([^.[\]]+)|\[['"]?([^'"\]]+)['"]?\])$/)?.slice(1).find(Boolean) || 'value'
    output.push({ path, key, value: value as Scalar, arrayPath: arrayRoot, valueField })
    return output
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenScalars(item, `${path}[${index}]`, output, path, undefined))
    return output
  }
  if (value && typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
      const childPath = /^[a-zA-Z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`
      const nextValueField = arrayRoot ? (valueField ? `${valueField}.${key}` : key) : undefined
      flattenScalars(child, childPath, output, arrayRoot, nextValueField)
    })
  }
  return output
}

function meaningfulLinkTarget(target: RequestTarget) {
  const key = target.key.toLowerCase()
  if (/(^|_)(id|token|code|url|key)$/.test(key) || /(id|token|code|url|key)$/.test(key)) return true
  if (typeof target.value === 'string') return target.value.length >= 8
  return typeof target.value === 'number' && Math.abs(target.value) >= 100
}

function findRequestTargets(step: ApiFlowStep): RequestTarget[] {
  const targets: RequestTarget[] = []
  const parsedUrl = new URL(step.url.replace('{{baseApi}}', 'https://flow.local'))
  parsedUrl.searchParams.forEach((value, key) => {
    targets.push({ kind: 'query', path: key, key, value })
  })
  const body = parseJson(step.body)
  if (body !== undefined) {
    flattenScalars(body).forEach(entry => {
      targets.push({ kind: 'body', path: entry.path, key: entry.key, value: entry.value })
    })
  }
  return targets
}

function replaceBodyPath(value: unknown, path: string, replacement: string) {
  const tokens = path.replace(/^\$\.?/, '').match(/[^.[\]]+|\[(\d+)\]/g)?.map(token => token.replace(/^\[(\d+)\]$/, '$1')) || []
  if (!tokens.length) return value
  let current: any = value
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (current == null) return value
    current = current[tokens[index]]
  }
  if (current != null) current[tokens[tokens.length - 1]] = replacement
  return value
}

function replaceTarget(step: ApiFlowStep, target: RequestTarget, variableName: string) {
  const placeholder = `{{${variableName}}}`
  if (target.kind === 'query') {
    const parsed = new URL(step.url.replace('{{baseApi}}', 'https://flow.local'))
    parsed.searchParams.set(target.path, placeholder)
    step.url = restoreEncodedTemplateTokens(step.url.startsWith('{{baseApi}}')
      ? `{{baseApi}}${parsed.pathname}${parsed.search}${parsed.hash}`
      : parsed.toString())
    return
  }
  const body = parseJson(step.body)
  if (body !== undefined) step.body = JSON.stringify(replaceBodyPath(body, target.path, placeholder), null, 2)
}

function sanitizeHeaders(headers: Record<string, string>) {
  return Object.fromEntries(Object.entries(headers || {}).filter(([name]) => {
    const normalized = name.toLowerCase()
    return !ignoredHeaders.has(normalized) && !normalized.startsWith('sec-') && !normalized.startsWith(':')
  }))
}

function suggestedStepName(record: NetworkRecord, index: number) {
  try {
    const path = new URL(record.url).pathname.split('/').filter(Boolean)
    return path.slice(-2).join(' / ') || `请求 ${index + 1}`
  } catch {
    return `请求 ${index + 1}`
  }
}

function addQueryVariables(step: ApiFlowStep, variables: ApiFlowVariable[], names: Set<string>) {
  const parsed = new URL(step.url.replace('{{baseApi}}', 'https://flow.local'))
  const ignored = /^(?:_|v|t|ts|timestamp|cache|cachebuster|callback)$/i
  parsed.searchParams.forEach((value, key) => {
    if (ignored.test(key) || /^\d{11,}$/.test(value) || value.includes('{{')) return
    const name = uniqueVariableName(key, names)
    variables.push({ id: crypto.randomUUID(), name, value })
    parsed.searchParams.set(key, `{{${name}}}`)
  })
  step.url = restoreEncodedTemplateTokens(step.url.startsWith('{{baseApi}}')
    ? `{{baseApi}}${parsed.pathname}${parsed.search}${parsed.hash}`
    : parsed.toString())
}

function outputExtractors(step: ApiFlowStep) {
  const response = parseJson(step.sampleResponse)
  if (response === undefined) return
  const existing = new Set(step.extractors.map(item => item.path))
  const candidate = flattenScalars(response).find(entry =>
    !entry.arrayPath
    && !existing.has(entry.path)
    && (/(?:pay|payment|checkout|redirect)?url$/i.test(entry.key) || (typeof entry.value === 'string' && /^https?:\/\//.test(entry.value)))
  )
  if (!candidate) return
  step.extractors.push({
    id: crypto.randomUUID(),
    name: safeName(candidate.key, 'resultUrl'),
    path: candidate.path,
    output: true,
    required: true,
  })
}

export function createApiFlowFromRecords(records: NetworkRecord[]): ApiFlow {
  const ordered = [...records].sort((left, right) => left.startedAt - right.startedAt)
  const origins = ordered.map(record => {
    try { return new URL(record.url).origin } catch { return '' }
  })
  const sharedOrigin = origins.length && origins.every(origin => origin === origins[0]) ? origins[0] : origins[0]
  const names = new Set<string>(['baseApi'])
  const variables: ApiFlowVariable[] = [
    { id: crypto.randomUUID(), name: 'baseApi', value: sharedOrigin || '' },
  ]
  const steps: ApiFlowStep[] = ordered.map((record, index) => {
    const parsed = new URL(record.url)
    return {
      id: crypto.randomUUID(),
      name: suggestedStepName(record, index),
      method: record.method,
      url: parsed.origin === sharedOrigin ? `{{baseApi}}${parsed.pathname}${parsed.search}${parsed.hash}` : record.url,
      headers: sanitizeHeaders(record.requestHeaders),
      body: record.requestBody ? (parseJson(record.requestBody) !== undefined ? JSON.stringify(parseJson(record.requestBody), null, 2) : record.requestBody) : '',
      extractors: [],
      sampleResponse: responseSample(record.responseBody),
    }
  })

  if (steps[0]) addQueryVariables(steps[0], variables, names)

  for (let targetIndex = 1; targetIndex < steps.length; targetIndex += 1) {
    const targetStep = steps[targetIndex]
    for (const target of findRequestTargets(targetStep).filter(meaningfulLinkTarget)) {
      let matched: { step: ApiFlowStep; entry: ScalarEntry } | undefined
      for (let sourceIndex = targetIndex - 1; sourceIndex >= 0 && !matched; sourceIndex -= 1) {
        const response = parseJson(steps[sourceIndex].sampleResponse)
        if (response === undefined) continue
        const entries = flattenScalars(response)
        const candidates = entries.filter(entry => entry.value === target.value)
        const entry = candidates.find(item => item.key.toLowerCase() === target.key.toLowerCase()) || candidates[0]
        if (entry) matched = { step: steps[sourceIndex], entry }
      }
      if (!matched) continue
      const variableName = uniqueVariableName(target.key, names)
      replaceTarget(targetStep, target, variableName)
      if (matched.entry.arrayPath && matched.entry.valueField) {
        if (!matched.step.selection) {
          matched.step.selection = {
            sourcePath: matched.entry.arrayPath,
            valueField: matched.entry.valueField,
            variableName,
            labelFields: ['name', 'title', 'label', 'price', 'amount', 'currency'],
            mode: 'manual',
          }
        } else {
          const extractor: ApiFlowExtractor = {
            id: crypto.randomUUID(),
            name: variableName,
            path: matched.entry.path,
            required: true,
          }
          matched.step.extractors.push(extractor)
        }
      } else {
        matched.step.extractors.push({
          id: crypto.randomUUID(),
          name: variableName,
          path: matched.entry.path,
          required: true,
        })
      }
    }
  }

  if (steps.length) outputExtractors(steps[steps.length - 1])

  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    name: `${ordered[0]?.pageDomain || '接口'}流程`,
    variables,
    steps,
    createdAt: now,
    updatedAt: now,
    sourceTabId: ordered[0]?.tabId,
  }
}

export type ApiFlowPathResolution = {
  found: boolean
  value?: unknown
  resolvedPath?: string
}

function normalizeValuePath(path: string) {
  return path
    .trim()
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/．/g, '.')
}

function pathTokens(path: string): Array<string | number> {
  let source = normalizeValuePath(path)
  if (source.startsWith('$')) source = source.slice(1)
  const tokens: Array<string | number> = []
  let cursor = 0
  while (cursor < source.length) {
    while (/\s/.test(source[cursor] || '')) cursor += 1
    if (source[cursor] === '.') {
      cursor += 1
      continue
    }
    if (source[cursor] === '[') {
      let end = cursor + 1
      let quote = ''
      let escaped = false
      for (; end < source.length; end += 1) {
        const character = source[end]
        if (escaped) {
          escaped = false
          continue
        }
        if (character === '\\') {
          escaped = true
          continue
        }
        if (quote) {
          if (character === quote) quote = ''
          continue
        }
        if (character === '"' || character === "'") {
          quote = character
          continue
        }
        if (character === ']') break
      }
      if (end >= source.length) return []
      const rawToken = source.slice(cursor + 1, end).trim()
      if (/^\d+$/.test(rawToken)) {
        tokens.push(Number(rawToken))
      } else if (/^"(?:\\.|[^"])*"$/.test(rawToken)) {
        try { tokens.push(JSON.parse(rawToken)) } catch { return [] }
      } else if (/^'(?:\\.|[^'])*'$/.test(rawToken)) {
        tokens.push(rawToken.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\'))
      } else if (rawToken) {
        tokens.push(rawToken)
      } else {
        return []
      }
      cursor = end + 1
      continue
    }
    const start = cursor
    while (cursor < source.length && source[cursor] !== '.' && source[cursor] !== '[') cursor += 1
    const token = source.slice(start, cursor).trim()
    if (!token) return []
    tokens.push(token)
  }
  return tokens
}

function resolveTokens(source: unknown, tokens: Array<string | number>): ApiFlowPathResolution {
  let current = parseEmbeddedJson(source)
  for (const token of tokens) {
    current = parseEmbeddedJson(current)
    if (current == null || (typeof current !== 'object' && !Array.isArray(current))) return { found: false }
    if (!Object.prototype.hasOwnProperty.call(current, token)) return { found: false }
    current = (current as any)[token]
  }
  return { found: true, value: current }
}

export function resolveValueAtPath(value: unknown, path: string): ApiFlowPathResolution {
  const normalizedPath = normalizeValuePath(path)
  if (!normalizedPath || normalizedPath === '$') return { found: true, value, resolvedPath: '$' }
  const tokens = pathTokens(normalizedPath)
  if (!tokens.length) return { found: false }
  const direct = resolveTokens(value, tokens)
  if (direct.found) return { ...direct, resolvedPath: normalizedPath }
  const root = parseEmbeddedJson(value)
  if (!root || typeof root !== 'object' || Array.isArray(root)) return { found: false }
  for (const wrapper of ['data', 'payload', 'body', 'response']) {
    if (!(wrapper in root)) continue
    const wrapped = resolveTokens((root as Record<string, unknown>)[wrapper], tokens)
    if (wrapped.found) return { ...wrapped, resolvedPath: `$.${wrapper}.${normalizedPath.replace(/^\$\.?/, '')}` }
  }
  return { found: false }
}

export function getValueAtPath(value: unknown, path: string): unknown {
  return resolveValueAtPath(value, path).value
}

export function suggestValuePaths(value: unknown, requestedPath: string, limit = 3): string[] {
  const requestedTokens = pathTokens(requestedPath)
  const wantedKey = [...requestedTokens].reverse().find(token => typeof token === 'string')
  if (!wantedKey) return []
  const matches: string[] = []
  let visited = 0
  const walk = (source: unknown, path: string) => {
    if (matches.length >= limit || visited++ > 3000) return
    const current = parseEmbeddedJson(source)
    if (Array.isArray(current)) {
      current.forEach((child, index) => walk(child, `${path}[${index}]`))
      return
    }
    if (!current || typeof current !== 'object') return
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      const childPath = /^[a-zA-Z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`
      if (key === wantedKey) matches.push(childPath)
      if (matches.length >= limit) return
      walk(child, childPath)
    }
  }
  walk(parseEmbeddedJson(value), '$')
  return matches
}

export function renderApiFlowRequest(step: ApiFlowStep, variables: Record<string, unknown>): ApiFlowRequest {
  const variableValue = (name: string) => {
    if (!(name in variables)) throw new Error(`变量 ${name} 尚未赋值`)
    const value = variables[name]
    return value == null ? '' : String(value)
  }
  const replaceText = (text: string) => restoreEncodedTemplateTokens(text).replace(/\{\{\s*([\w$]+)\s*\}\}/g, (_match, name) => variableValue(name))
  const replaceUrl = (text: string) => {
    const template = restoreEncodedTemplateTokens(text)
    return template.replace(/\{\{\s*([\w$]+)\s*\}\}/g, (_match, name) => {
      const value = variableValue(name)
      if (name === 'baseApi') return value.replace(/\/+$/, '')
      return encodeURIComponent(value)
    })
  }
  const renderValue = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const exact = value.match(/^\{\{\s*([\w$]+)\s*\}\}$/)
      if (exact) {
        if (!(exact[1] in variables)) throw new Error(`变量 ${exact[1]} 尚未赋值`)
        return variables[exact[1]]
      }
      return replaceText(value)
    }
    if (Array.isArray(value)) return value.map(renderValue)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, renderValue(child)]))
    }
    return value
  }

  const parsedBody = parseJson(step.body)
  const body = !step.body.trim()
    ? undefined
    : parsedBody === undefined
      ? replaceText(step.body)
      : JSON.stringify(renderValue(parsedBody))
  return {
    method: step.method,
    url: replaceUrl(step.url),
    headers: Object.fromEntries(Object.entries(step.headers).map(([name, value]) => [name, replaceText(value)])),
    body,
    timeoutMs: 15_000,
  }
}
