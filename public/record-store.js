const DATABASE_NAME = 'suiye-network-cache'
const DATABASE_VERSION = 1
const RECORD_STORE = 'records'
const encoder = new TextEncoder()

let databasePromise

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB 请求失败'))
  })
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB 事务失败'))
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB 事务已中止'))
  })
}

export function recordStorageKey(record) {
  return record.storageKey || `${record.tabId}:${record.id}:${record.startedAt}`
}

export function recordByteSize(record) {
  const { _cacheBytes, ...serializable } = record
  return encoder.encode(JSON.stringify(serializable)).byteLength
}

export function prepareStoredRecord(record) {
  const prepared = { ...record, storageKey: recordStorageKey(record) }
  prepared._cacheBytes = recordByteSize(prepared)
  return prepared
}

export function openRecordDatabase() {
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      const store = database.createObjectStore(RECORD_STORE, { keyPath: 'storageKey' })
      store.createIndex('startedAt', 'startedAt')
      store.createIndex('tabId', 'tabId')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('无法打开请求缓存'))
  })
  return databasePromise
}

export async function putStoredRecord(record) {
  const database = await openRecordDatabase()
  const transaction = database.transaction(RECORD_STORE, 'readwrite')
  const done = transactionDone(transaction)
  transaction.objectStore(RECORD_STORE).put(prepareStoredRecord(record))
  await done
}

export async function putStoredRecords(records) {
  if (!records.length) return
  const database = await openRecordDatabase()
  const transaction = database.transaction(RECORD_STORE, 'readwrite')
  const done = transactionDone(transaction)
  const store = transaction.objectStore(RECORD_STORE)
  records.forEach(record => store.put(prepareStoredRecord(record)))
  await done
}

export async function getStoredRecord(storageKey) {
  const database = await openRecordDatabase()
  const transaction = database.transaction(RECORD_STORE, 'readonly')
  const done = transactionDone(transaction)
  const record = await requestResult(transaction.objectStore(RECORD_STORE).get(storageKey))
  await done
  if (!record) return null
  const { _cacheBytes, ...result } = record
  return result
}

export async function getAllStoredRecords() {
  const database = await openRecordDatabase()
  const transaction = database.transaction(RECORD_STORE, 'readonly')
  const done = transactionDone(transaction)
  const records = await requestResult(transaction.objectStore(RECORD_STORE).getAll())
  await done
  return records.sort((left, right) => right.startedAt - left.startedAt)
}

export async function deleteStoredRecords(tabId = null) {
  const database = await openRecordDatabase()
  const records = await getAllStoredRecords()
  const targets = tabId == null ? records : records.filter(record => record.tabId === tabId)
  if (!targets.length) return 0
  const transaction = database.transaction(RECORD_STORE, 'readwrite')
  const done = transactionDone(transaction)
  const store = transaction.objectStore(RECORD_STORE)
  targets.forEach(record => store.delete(record.storageKey))
  await done
  return targets.length
}

export async function pruneStoredRecords({ maxRecords, maxBytes, retentionMinutes }) {
  const database = await openRecordDatabase()
  const records = await getAllStoredRecords()
  const cutoff = retentionMinutes > 0 ? Date.now() - retentionMinutes * 60_000 : 0
  const kept = []
  const removed = []
  let bytes = 0

  for (const record of records) {
    const recordBytes = record._cacheBytes || recordByteSize(record)
    const expired = cutoff > 0 && record.startedAt < cutoff
    const countExceeded = kept.length >= maxRecords
    const capacityExceeded = bytes + recordBytes > maxBytes
    if (expired || countExceeded || capacityExceeded) {
      removed.push(record)
      continue
    }
    kept.push(record)
    bytes += recordBytes
  }

  if (removed.length) {
    const transaction = database.transaction(RECORD_STORE, 'readwrite')
    const done = transactionDone(transaction)
    const store = transaction.objectStore(RECORD_STORE)
    removed.forEach(record => store.delete(record.storageKey))
    await done
  }

  const bodyBytes = kept.reduce((total, record) => total + (record.requestBody ? (record.requestBodyBytes || 0) : 0) + (record.responseBody ? (record.responseBodyBytes || 0) : 0), 0)
  return { bytes, bodyBytes, recordCount: kept.length, removedCount: removed.length, removedKeys: removed.map(record => record.storageKey), lastCleanupAt: Date.now() }
}

export async function getRecordCacheStats() {
  const records = await getAllStoredRecords()
  return {
    bytes: records.reduce((total, record) => total + (record._cacheBytes || recordByteSize(record)), 0),
    bodyBytes: records.reduce((total, record) => total + (record.requestBody ? (record.requestBodyBytes || 0) : 0) + (record.responseBody ? (record.responseBodyBytes || 0) : 0), 0),
    recordCount: records.length,
    lastCleanupAt: 0,
  }
}
