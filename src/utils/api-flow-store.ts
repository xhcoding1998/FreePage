import type { ApiFlow } from '../types'

export const API_FLOW_STORAGE_KEY = 'suiye-api-flows-v1'

const DATABASE_NAME = 'suiye-api-flow-store'
const DATABASE_VERSION = 1
const STORE_NAME = 'flows'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('updatedAt', 'updatedAt')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('流程数据库打开失败'))
    request.onblocked = () => reject(new Error('流程数据库正在被其他页面占用'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('流程数据库写入失败'))
    transaction.onabort = () => reject(transaction.error || new Error('流程数据库写入已中止'))
  })
}

async function readDatabaseFlows(): Promise<ApiFlow[]> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).getAll()
    const flows = await new Promise<ApiFlow[]>((resolve, reject) => {
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : [])
      request.onerror = () => reject(request.error || new Error('流程数据读取失败'))
    })
    return flows.sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
  } finally {
    database.close()
  }
}

async function replaceDatabaseFlows(flows: ApiFlow[]): Promise<void> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    store.clear()
    flows.forEach(flow => store.put(flow))
    await transactionDone(transaction)
  } finally {
    database.close()
  }
}

async function readLegacyFlows(): Promise<ApiFlow[]> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return []
  const stored = await chrome.storage.local.get(API_FLOW_STORAGE_KEY)
  return Array.isArray(stored[API_FLOW_STORAGE_KEY]) ? stored[API_FLOW_STORAGE_KEY] : []
}

export async function loadStoredApiFlows(): Promise<ApiFlow[]> {
  try {
    const flows = await readDatabaseFlows()
    if (flows.length) return flows
    const legacyFlows = await readLegacyFlows()
    if (!legacyFlows.length) return []
    await replaceDatabaseFlows(legacyFlows)
    await chrome.storage.local.remove(API_FLOW_STORAGE_KEY)
    return legacyFlows.sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
  } catch (error) {
    const legacyFlows = await readLegacyFlows().catch(() => [])
    if (legacyFlows.length) return legacyFlows
    throw error
  }
}

export async function saveStoredApiFlows(flows: ApiFlow[]): Promise<void> {
  await replaceDatabaseFlows(flows)
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.remove(API_FLOW_STORAGE_KEY).catch(() => {})
  }
}

export async function countStoredApiFlows(): Promise<number> {
  try {
    const database = await openDatabase()
    try {
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const request = transaction.objectStore(STORE_NAME).count()
      const count = await new Promise<number>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error || new Error('流程数量读取失败'))
      })
      if (count) return count
    } finally {
      database.close()
    }
    return (await readLegacyFlows()).length
  } catch {
    return (await readLegacyFlows().catch(() => [])).length
  }
}
