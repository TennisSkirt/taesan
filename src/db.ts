import Dexie, { type EntityTable } from 'dexie'
import { guessRegion } from './lib/format'
import type {
  Account,
  CashTx,
  Transaction,
  Dividend,
  ManualAsset,
  PriceCache,
  FxCache,
  Snapshot,
  Setting,
} from './types'

const db = new Dexie('wealth-tracker') as Dexie & {
  accounts: EntityTable<Account, 'id'>
  transactions: EntityTable<Transaction, 'id'>
  dividends: EntityTable<Dividend, 'id'>
  cashTxs: EntityTable<CashTx, 'id'>
  manualAssets: EntityTable<ManualAsset, 'id'>
  priceCache: EntityTable<PriceCache, 'key'>
  fxCache: EntityTable<FxCache, 'key'>
  snapshots: EntityTable<Snapshot, 'date'>
  settings: EntityTable<Setting, 'key'>
}

db.version(1).stores({
  accounts: '++id, name, kind',
  transactions: '++id, accountId, symbol, date, [market+symbol]',
  dividends: '++id, accountId, symbol, date, [market+symbol]',
  manualAssets: '++id, category',
  priceCache: 'key, updatedAt',
  fxCache: 'key',
  snapshots: 'date',
  settings: 'key',
})

db.version(2).stores({
  cashTxs: '++id, accountId, fromAccountId, date, type',
})

// v3: 계좌에 관리 국가(region) 추가 — 기존 계좌는 이름으로 추정해 배정
db.version(3)
  .stores({
    accounts: '++id, name, kind, region',
  })
  .upgrade((tx) =>
    tx
      .table('accounts')
      .toCollection()
      .modify((a: { name: string; region?: string }) => {
        if (!a.region) a.region = guessRegion(a.name)
      })
  )

export { db }
