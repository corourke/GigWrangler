import { openDB, DBSchema, IDBPDatabase } from 'idb';

export interface OutboxItem {
  id?: number;
  type: 'INVENTORY_SCAN' | 'INVENTORY_CLEAR' | 'INVENTORY_NOTE_UPDATE' | 'ASSET_STATUS_UPDATE'
    | 'MAINTENANCE_SEND' | 'MAINTENANCE_RETURN' | 'MAINTENANCE_UPDATE' | 'BIO_ENROLL' | 'STAFF_ASSIGNMENT_UPDATE'
    | 'KIT_ASSIGNMENT_ADD' | 'KIT_ASSIGNMENT_REMOVE';
  payload: any;
  timestamp: number;
  attempts: number;
  /** Who queued it. Older items don't have it; their payload's scanned_by or assigned_by stands in. */
  actor_id?: string;
  /** Gave up after the last retry; kept so the count of changes that couldn't sync stays right. */
  failed?: boolean;
}

interface GigWranglerDB extends DBSchema {
  gigs: {
    key: string;
    value: any;
    indexes: { 'by-date': string };
  };
  packing_lists: {
    key: string;
    value: any;
  };
  outbox: {
    key: number;
    value: OutboxItem;
    indexes: { 'by-timestamp': number };
  };
  staff_assignments: {
    key: string;
    value: any;
  };
  org_index: {
    key: string;
    value: any;
  };
  /** The day-of-show sheet saved for offline use, one per gig (§3e). */
  day_of_show: {
    key: string;
    value: { gig_id: string; saved_at: number; [field: string]: any };
  };
}

const DB_NAME = 'gig-manager-mobile';
const DB_VERSION = 5;

let dbPromise: Promise<IDBPDatabase<GigWranglerDB>>;

export const getDB = () => {
  if (!dbPromise) {
    dbPromise = openDB<GigWranglerDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          const gigStore = db.createObjectStore('gigs', { keyPath: 'id' });
          gigStore.createIndex('by-date', 'start');
          db.createObjectStore('packing_lists', { keyPath: 'gig_id' });
          const outboxStore = db.createObjectStore('outbox', {
            keyPath: 'id',
            autoIncrement: true,
          });
          outboxStore.createIndex('by-timestamp', 'timestamp');
        }
        if (oldVersion < 2 && transaction) {
          const hasGigStore = Array.from(transaction.objectStoreNames).includes('gigs');
          if (hasGigStore) {
            const gigStore = transaction.objectStore('gigs');
            if (gigStore.indexNames.contains('by-date')) {
              gigStore.deleteIndex('by-date');
            }
            gigStore.createIndex('by-date', 'start');
          }
        }
        if (oldVersion < 3) {
          db.createObjectStore('staff_assignments', { keyPath: 'assignment.id' });
        }
        if (oldVersion < 4) {
          // The organization's kits and equipment, for scanning or adding anything it owns (#185).
          db.createObjectStore('org_index', { keyPath: 'org_id' });
        }
        if (oldVersion < 5) {
          // The day-of-show sheet, for a venue with poor signal (§3e).
          db.createObjectStore('day_of_show', { keyPath: 'gig_id' });
        }
      },
    });
  }
  return dbPromise;
};

export const idbStore = {
  async putGig(gig: any) {
    const db = await getDB();
    return db.put('gigs', gig);
  },
  async putGigs(gigs: any[]) {
    const db = await getDB();
    const tx = db.transaction('gigs', 'readwrite');
    await Promise.all([...gigs.map(gig => tx.store.put(gig)), tx.done]);
  },
  async getGigs() {
    const db = await getDB();
    return db.getAllFromIndex('gigs', 'by-date');
  },
  async clearGigs() {
    const db = await getDB();
    return db.clear('gigs');
  },

  async putPackingList(gigId: string, data: any) {
    const db = await getDB();
    return db.put('packing_lists', { gig_id: gigId, ...data });
  },
  async getPackingList(gigId: string) {
    const db = await getDB();
    return db.get('packing_lists', gigId);
  },

  async addToOutbox(item: Omit<OutboxItem, 'id' | 'timestamp' | 'attempts' | 'failed'> & { actor_id: string }) {
    const db = await getDB();
    return db.add('outbox', {
      ...item,
      timestamp: Date.now(),
      attempts: 0,
    });
  },
  async getOutbox() {
    const db = await getDB();
    return db.getAllFromIndex('outbox', 'by-timestamp');
  },
  async removeFromOutbox(id: number) {
    const db = await getDB();
    return db.delete('outbox', id);
  },
  async updateOutboxItem(item: OutboxItem) {
    const db = await getDB();
    return db.put('outbox', item);
  },

  async putStaffAssignments(assignments: any[]) {
    const db = await getDB();
    const tx = db.transaction('staff_assignments', 'readwrite');
    await tx.store.clear();
    await Promise.all([...assignments.map(a => tx.store.put(a)), tx.done]);
  },
  async getStaffAssignments() {
    const db = await getDB();
    return db.getAll('staff_assignments');
  },
  async clearStaffAssignments() {
    const db = await getDB();
    return db.clear('staff_assignments');
  },
  async putOrgIndex(index: any) {
    const db = await getDB();
    return db.put('org_index', index);
  },
  async getOrgIndex(orgId: string) {
    const db = await getDB();
    return db.get('org_index', orgId);
  },
  async putDayOfShow(sheet: GigWranglerDB['day_of_show']['value']) {
    const db = await getDB();
    return db.put('day_of_show', sheet);
  },
  async getDayOfShow(gigId: string) {
    const db = await getDB();
    return db.get('day_of_show', gigId);
  },
  async getAllDayOfShow() {
    const db = await getDB();
    return db.getAll('day_of_show');
  },
  async deleteDayOfShow(gigId: string) {
    const db = await getDB();
    return db.delete('day_of_show', gigId);
  },
  /** Stamps queued changes that name no one (queued by the older app) with this person. */
  async adoptUnownedOutbox(userId: string) {
    const db = await getDB();
    const tx = db.transaction('outbox', 'readwrite');
    for (const item of await tx.store.getAll()) {
      if (!item.actor_id && !item.payload?.scanned_by && !item.payload?.assigned_by) {
        await tx.store.put({ ...item, actor_id: userId });
      }
    }
    await tx.done;
  },
  /** The cached data (not the queued changes), for a sign-in when no owner was recorded. */
  async clearCaches() {
    const db = await getDB();
    const stores = ['gigs', 'packing_lists', 'staff_assignments', 'org_index', 'day_of_show'] as const;
    const tx = db.transaction([...stores], 'readwrite');
    await Promise.all([...stores.map((s) => tx.objectStore(s).clear()), tx.done]);
  },
  /** Everything, for a sign-out or a different person signing in on this device. */
  async clearAll() {
    const db = await getDB();
    const stores = ['gigs', 'packing_lists', 'staff_assignments', 'org_index', 'day_of_show', 'outbox'] as const;
    const tx = db.transaction([...stores], 'readwrite');
    await Promise.all([...stores.map((s) => tx.objectStore(s).clear()), tx.done]);
  },
};
