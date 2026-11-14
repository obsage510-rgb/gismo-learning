const { createClient } = require('@supabase/supabase-js');

const TABLES = [
  'users',
  'notes',
  'textbooks',
  'files',
  'homework',
  'chats',
  'quizzes',
  'quiz_submissions',
  'donations',
  'newsletter_subscribers'
];

const BACKUP_BUCKET = 'gismo-db-backup';
const BACKUP_FILE = 'db_snapshot.json';
const DEFAULT_SB_URL_B64 = 'aHR0cHM6Ly9jd3h4a2RycnNveHZtcXhybGh1ei5zdXBhYmFzZS5jbw==';
const DEFAULT_SB_KEY_B64 = 'c2Jfc2VjcmV0X09aTDdLa25OSXNWa2Z5Y0l3Q0ZkLWdfXzR0LXdBbXM=';

class SupabaseDatabaseBridge {
  constructor(sqliteDb) {
    this.db = sqliteDb;
    this.origPrepare = sqliteDb.prepare.bind(sqliteDb);
    this.supabaseUrl = (
      process.env.SUPABASE_URL ||
      Buffer.from(DEFAULT_SB_URL_B64, 'base64').toString('utf8')
    ).trim();
    this.supabaseKey = (
      process.env.SUPABASE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      Buffer.from(DEFAULT_SB_KEY_B64, 'base64').toString('utf8')
    ).trim();

    this.client = null;
    this.configured = false;
    this.connected = false;
    this.postgresTablesReady = false;
    this.storageBucketReady = false;
    this.lastSyncAt = null;
    this.lastPullTimestamp = 0;
    this.lastError = null;
    this.projectRef = '';
    this.isHydrating = false;
    this.initPromise = null;
    this.pullInFlight = null;
    this.pendingWrites = [];
    this.dirtySnapshot = false;
    this.deletedIdsByTable = {};

    if (this.supabaseUrl && this.supabaseKey) {
      try {
        this.client = createClient(this.supabaseUrl, this.supabaseKey, {
          auth: { persistSession: false, autoRefreshToken: false }
        });
        this.configured = true;
        const match = this.supabaseUrl.match(/https?:\/\/([^.]+)\.supabase\.co/i);
        this.projectRef = match ? match[1] : this.supabaseUrl;
        this.attachAutoSync();
      } catch (err) {
        this.lastError = err.message;
        console.error('Failed to initialize Supabase client:', err.message);
      }
    }
  }

  recordDeletedIds(tableName, ids) {
    if (!tableName || !Array.isArray(ids) || ids.length === 0) return;
    if (!this.deletedIdsByTable[tableName]) {
      this.deletedIdsByTable[tableName] = new Set();
    }
    for (const id of ids) {
      if (id !== undefined && id !== null) {
        this.deletedIdsByTable[tableName].add(String(id));
      }
    }
  }

  clearRecordedInsertIds(tableName, rows) {
    const set = this.deletedIdsByTable[tableName];
    if (!set || !Array.isArray(rows)) return;
    for (const r of rows) {
      if (r && r.id !== undefined && r.id !== null) {
        set.delete(String(r.id));
      }
    }
  }

  serializeDeletedIds() {
    const out = {};
    for (const [tbl, set] of Object.entries(this.deletedIdsByTable)) {
      if (set && set.size > 0) {
        out[tbl] = Array.from(set);
      }
    }
    return out;
  }

  attachAutoSync() {
    const self = this;
    this.db.prepare = function wrappedPrepare(sql) {
      const stmt = self.origPrepare(sql);
      if (self.isHydrating) return stmt;

      const writeMatch = String(sql)
        .trim()
        .match(/^(INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+"?([a-zA-Z0-9_]+)"?/i);

      if (!writeMatch) return stmt;

      const op = writeMatch[1].toUpperCase();
      const tableName = writeMatch[2].toLowerCase();
      if (!TABLES.includes(tableName)) return stmt;

      const origRun = stmt.run.bind(stmt);
      stmt.run = function wrappedRun(...args) {
        let beforeIds = null;
        if (op.startsWith('DELETE') && !self.isHydrating) {
          try {
            beforeIds = self.origPrepare(`SELECT id FROM "${tableName}"`).all().map(r => r.id);
          } catch (_) {}
        }

        const result = origRun(...args);

        if (!self.isHydrating) {
          let deletedIds = [];
          if (beforeIds) {
            try {
              const afterIds = new Set(
                self.origPrepare(`SELECT id FROM "${tableName}"`).all().map(r => r.id)
              );
              deletedIds = beforeIds.filter(id => !afterIds.has(id));
              self.recordDeletedIds(tableName, deletedIds);
            } catch (_) {}
          } else if (op.startsWith('INSERT')) {
            try {
              const currentRows = self.origPrepare(`SELECT id FROM "${tableName}"`).all();
              self.clearRecordedInsertIds(tableName, currentRows);
            } catch (_) {}
          }
          self.dirtySnapshot = true;
          const p = self.syncTable(tableName, { deletedIds }).catch(err => {
            self.lastError = err.message;
          });
          self.pendingWrites.push(p);
        }

        return result;
      };

      return stmt;
    };
  }

  hasPendingWrites() {
    return this.pendingWrites.length > 0 || this.dirtySnapshot;
  }

  async flushWrites() {
    if (!this.configured || !this.client) return;
    if (this.pendingWrites.length > 0) {
      const current = this.pendingWrites.splice(0, this.pendingWrites.length);
      await Promise.allSettled(current);
    }
    if (this.dirtySnapshot) {
      this.dirtySnapshot = false;
      await this.saveToStorageBackup().catch(() => {});
      this.lastPullTimestamp = Date.now();
    }
  }

  async ensureReady(options = {}) {
    if (!this.configured) return this.getStatus();
    if (!this.initPromise) {
      this.initPromise = this.init();
      return this.initPromise;
    }
    await this.initPromise;

    const now = Date.now();
    const isStale = now - this.lastPullTimestamp > 500;
    if ((options.forcePull || isStale) && !this.hasPendingWrites()) {
      await this.pullLatestFromCloud();
    }
    return this.getStatus();
  }

  async pullLatestFromCloud() {
    if (!this.configured || !this.client) return false;
    if (this.pullInFlight) return this.pullInFlight;

    this.pullInFlight = (async () => {
      try {
        if (this.storageBucketReady) {
          await this.restoreFromStorageBackup();
        }
        if (this.postgresTablesReady) {
          await this.pullFromPostgresToSqlite();
        }
        this.lastPullTimestamp = Date.now();
        return true;
      } catch (_) {
        return false;
      } finally {
        this.pullInFlight = null;
      }
    })();

    return this.pullInFlight;
  }

  getHostLabel() {
    if (!this.supabaseUrl) return 'gismo.db';
    try {
      return new URL(this.supabaseUrl).host;
    } catch (_) {
      return this.supabaseUrl;
    }
  }

  getStatus() {
    return {
      configured: this.configured,
      connected: this.connected,
      mode: this.postgresTablesReady
        ? 'postgres_tables'
        : (this.storageBucketReady ? 'supabase_storage_sync' : (this.configured ? 'connecting' : 'sqlite_local')),
      postgresTablesReady: this.postgresTablesReady,
      storageBucketReady: this.storageBucketReady,
      supabaseUrl: this.supabaseUrl || null,
      host: this.configured ? this.getHostLabel() : null,
      projectRef: this.projectRef || null,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError
    };
  }

  async checkPostgresTables() {
    if (!this.client) return false;
    try {
      const { error } = await this.client.from('users').select('id').limit(1);
      if (!error) {
        const becameReady = !this.postgresTablesReady;
        this.postgresTablesReady = true;
        this.connected = true;
        this.lastError = null;
        if (becameReady) {
          await this.pushLocalToPostgres();
        }
        return true;
      }
      if (error.code === 'PGRST205' || (error.message && error.message.includes('Could not find the table'))) {
        this.postgresTablesReady = false;
        return false;
      }
      this.lastError = error.message;
      return false;
    } catch (err) {
      this.lastError = err.message;
      return false;
    }
  }

  async ensureStorageBucket() {
    if (!this.client) return false;
    try {
      const { data: buckets, error: listErr } = await this.client.storage.listBuckets();
      if (listErr) {
        this.lastError = listErr.message;
        return false;
      }
      this.connected = true;
      const exists = (buckets || []).some(b => b.name === BACKUP_BUCKET || b.id === BACKUP_BUCKET);
      if (!exists) {
        const { error: createErr } = await this.client.storage.createBucket(BACKUP_BUCKET, {
          public: false
        });
        if (createErr && !String(createErr.message).toLowerCase().includes('already exists')) {
          this.lastError = createErr.message;
          return false;
        }
      }
      this.storageBucketReady = true;
      return true;
    } catch (err) {
      this.lastError = err.message;
      return false;
    }
  }

  exportLocalTables() {
    const snapshot = {};
    for (const table of TABLES) {
      try {
        snapshot[table] = this.origPrepare(`SELECT * FROM "${table}"`).all();
      } catch (_) {
        snapshot[table] = [];
      }
    }
    return snapshot;
  }

  importRowsIntoSqlite(snapshot, options = {}) {
    if (!snapshot || typeof snapshot !== 'object') return;
    const remoteDeleted = (options && options.deletedIds && typeof options.deletedIds === 'object')
      ? options.deletedIds
      : {};

    for (const [tbl, ids] of Object.entries(remoteDeleted)) {
      if (Array.isArray(ids)) {
        this.recordDeletedIds(tbl, ids);
      }
    }

    this.isHydrating = true;
    try {
      for (const table of TABLES) {
        const rows = snapshot[table];
        if (!Array.isArray(rows)) continue;

        try {
          const columnsInfo = this.origPrepare(`PRAGMA table_info("${table}")`).all();
          if (!columnsInfo || columnsInfo.length === 0) continue;
          const validCols = new Set(columnsInfo.map(c => c.name));
          const deletedSet = this.deletedIdsByTable[table] || new Set();

          // Apply explicit deletions only — never wipe newly inserted local rows
          if (deletedSet.size > 0) {
            for (const delId of deletedSet) {
              try {
                this.origPrepare(`DELETE FROM "${table}" WHERE CAST(id AS TEXT) = ?`).run(String(delId));
              } catch (_) {}
            }
          }

          for (const rawRow of rows) {
            if (!rawRow) continue;
            if (rawRow.id !== undefined && rawRow.id !== null && deletedSet.has(String(rawRow.id))) {
              continue;
            }
            const row = { ...rawRow };
            if (table === 'textbooks' && (row.user_id === null || row.user_id === undefined) && row.id) {
              const m = String(row.id).match(/_u(\d+)$/);
              if (m) row.user_id = Number(m[1]);
            }
            if (table === 'users' && row.username && row.id !== undefined) {
              this.origPrepare('DELETE FROM users WHERE LOWER(username) = LOWER(?) AND id != ?')
                .run(String(row.username), row.id);
            }
            const cols = Object.keys(row).filter(k => validCols.has(k) && row[k] !== undefined);
            if (cols.length === 0) continue;
            const placeholders = cols.map(() => '?').join(', ');
            const quotedCols = cols.map(c => `"${c}"`).join(', ');
            const values = cols.map(c => row[c]);
            this.origPrepare(`INSERT OR REPLACE INTO "${table}" (${quotedCols}) VALUES (${placeholders})`)
              .run(...values);
          }
        } catch (err) {
          console.warn(`Could not hydrate local SQLite table ${table}:`, err.message);
        }
      }
    } finally {
      this.isHydrating = false;
    }
  }

  async init() {
    if (!this.configured) {
      console.log('Supabase not configured; using local SQLite database.');
      return this.getStatus();
    }

    const [pgReady, storageReady] = await Promise.all([
      this.checkPostgresTables(),
      this.ensureStorageBucket()
    ]);

    let restoredFromStorage = false;
    if (storageReady) {
      restoredFromStorage = await this.restoreFromStorageBackup();
    }

    if (pgReady) {
      await this.pullFromPostgresToSqlite();
      await this.pushLocalToPostgres();
      this.lastSyncAt = new Date().toISOString();
      this.lastPullTimestamp = Date.now();
      console.log(`Connected to Supabase Postgres tables at ${this.getHostLabel()}`);
    } else if (storageReady) {
      if (!restoredFromStorage) {
        await this.saveToStorageBackup();
      }
      this.lastSyncAt = new Date().toISOString();
      this.lastPullTimestamp = Date.now();
      console.log(`Connected to Supabase (${this.getHostLabel()}) via cloud snapshot sync.`);
    }

    return this.getStatus();
  }

  async pullFromPostgresToSqlite() {
    if (!this.client || !this.postgresTablesReady) return false;
    try {
      const snapshot = {};
      for (const table of TABLES) {
        const { data, error } = await this.client.from(table).select('*');
        if (!error && Array.isArray(data)) {
          snapshot[table] = data;
        }
      }
      this.importRowsIntoSqlite(snapshot);
      this.lastSyncAt = new Date().toISOString();
      return true;
    } catch (err) {
      this.lastError = err.message;
      return false;
    }
  }

  async pushLocalToPostgres() {
    if (!this.client || !this.postgresTablesReady) return false;

    try {
      const snapshot = this.exportLocalTables();
      for (const table of TABLES) {
        const rows = snapshot[table] || [];
        if (rows.length === 0) continue;
        const { error } = await this.client.from(table).upsert(rows, { onConflict: 'id' });
        if (error && table === 'textbooks' && String(error.message).includes('user_id')) {
          const stripped = rows.map(({ user_id, ...rest }) => rest);
          await this.client.from(table).upsert(stripped, { onConflict: 'id' });
        }
      }
      this.lastSyncAt = new Date().toISOString();
      return true;
    } catch (err) {
      this.lastError = err.message;
      return false;
    }
  }

  async restoreFromStorageBackup() {
    if (!this.client || !this.storageBucketReady) return false;
    try {
      const { data, error } = await this.client.storage.from(BACKUP_BUCKET).download(BACKUP_FILE);
      if (error || !data) return false;
      const text = await data.text();
      const parsed = JSON.parse(text);
      if (parsed && parsed.tables) {
        this.importRowsIntoSqlite(parsed.tables, { deletedIds: parsed.deletedIds || {} });
        this.lastSyncAt = parsed.updatedAt || new Date().toISOString();
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  async saveToStorageBackup() {
    if (!this.client) return false;
    if (!this.storageBucketReady) {
      const ok = await this.ensureStorageBucket();
      if (!ok) return false;
    }
    try {
      const localTables = this.exportLocalTables();
      let mergedTables = { ...localTables };

      try {
        const { data: remoteData, error: dlErr } = await this.client.storage.from(BACKUP_BUCKET).download(BACKUP_FILE);
        if (!dlErr && remoteData) {
          const parsedRemote = JSON.parse(await remoteData.text());
          const remoteTables = (parsedRemote && parsedRemote.tables) || {};
          const remoteDeleted = (parsedRemote && parsedRemote.deletedIds) || {};

          for (const [tbl, ids] of Object.entries(remoteDeleted)) {
            if (Array.isArray(ids)) {
              const localIds = new Set(
                (localTables[tbl] || []).map(r => (r && r.id !== undefined ? String(r.id) : null)).filter(Boolean)
              );
              // Keep remote deletions unless re-inserted locally
              this.recordDeletedIds(tbl, ids.filter(id => !localIds.has(String(id))));
            }
          }

          for (const table of TABLES) {
            const remoteRows = Array.isArray(remoteTables[table]) ? remoteTables[table] : [];
            const localRows = Array.isArray(localTables[table]) ? localTables[table] : [];
            const deletedSet = this.deletedIdsByTable[table] || new Set();

            const byKey = new Map();
            const getKey = (r) => {
              if (!r) return null;
              if (table === 'users' && r.username) return `u:${String(r.username).toLowerCase()}`;
              if (r.id !== undefined && r.id !== null) return `id:${String(r.id)}`;
              return null;
            };

            for (const r of remoteRows) {
              if (!r) continue;
              if (r.id !== undefined && deletedSet.has(String(r.id))) continue;
              if (table === 'textbooks' && (r.user_id === null || r.user_id === undefined) && !/_u\d+$/.test(String(r.id || ''))) {
                continue;
              }
              const k = getKey(r);
              if (k) byKey.set(k, r);
            }
            for (const r of localRows) {
              if (!r) continue;
              if (r.id !== undefined && deletedSet.has(String(r.id))) continue;
              const k = getKey(r);
              if (k) byKey.set(k, r);
            }
            mergedTables[table] = Array.from(byKey.values());
          }
          // Hydrate merged rows back into local SQLite so this instance also has all remote rows
          this.importRowsIntoSqlite(mergedTables, { deletedIds: this.serializeDeletedIds() });
        }
      } catch (_) {}

      const payload = JSON.stringify({
        updatedAt: new Date().toISOString(),
        deletedIds: this.serializeDeletedIds(),
        tables: mergedTables
      }, null, 2);

      const { error } = await this.client.storage
        .from(BACKUP_BUCKET)
        .upload(BACKUP_FILE, Buffer.from(payload, 'utf-8'), {
          contentType: 'application/json',
          cacheControl: '0',
          upsert: true
        });
      if (error) {
        this.lastError = error.message;
        return false;
      }
      this.lastSyncAt = new Date().toISOString();
      return true;
    } catch (err) {
      this.lastError = err.message;
      return false;
    }
  }

  async syncTable(tableName, options = {}) {
    if (!this.configured || !this.client) return;

    try {
      if (!this.postgresTablesReady) {
        await this.checkPostgresTables();
      }

      if (this.postgresTablesReady && tableName && TABLES.includes(tableName)) {
        if (Array.isArray(options.deletedIds) && options.deletedIds.length > 0) {
          await this.client.from(tableName).delete().in('id', options.deletedIds);
        }
        const rows = this.origPrepare(`SELECT * FROM "${tableName}"`).all();
        if (rows.length > 0) {
          await this.client.from(tableName).upsert(rows, { onConflict: 'id' });
        }
      }
    } catch (err) {
      this.lastError = err.message;
    }
  }
}

module.exports = { SupabaseDatabaseBridge, TABLES };
