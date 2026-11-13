const { createClient } = require('@supabase/supabase-js');

const TABLES = [
  'users',
  'notes',
  'textbooks',
  'files',
  'homework',
  'chats',
  'quizzes',
  'quiz_submissions'
];

const BACKUP_BUCKET = 'gismo-db-backup';
const BACKUP_FILE = 'db_snapshot.json';

class SupabaseDatabaseBridge {
  constructor(sqliteDb) {
    this.db = sqliteDb;
    this.origPrepare = sqliteDb.prepare.bind(sqliteDb);
    this.supabaseUrl = (process.env.SUPABASE_URL || '').trim();
    this.supabaseKey = (
      process.env.SUPABASE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      ''
    ).trim();

    this.client = null;
    this.configured = false;
    this.connected = false;
    this.postgresTablesReady = false;
    this.storageBucketReady = false;
    this.lastSyncAt = null;
    this.lastError = null;
    this.projectRef = '';
    this.isHydrating = false;
    this.initPromise = null;
    this.pendingWrites = [];
    this.dirtySnapshot = false;

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
    }
  }

  async ensureReady() {
    if (!this.configured) return this.getStatus();
    if (!this.initPromise) {
      this.initPromise = this.init();
    }
    return this.initPromise;
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

  importRowsIntoSqlite(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    this.isHydrating = true;
    try {
      for (const table of TABLES) {
        const rows = snapshot[table];
        if (!Array.isArray(rows) || rows.length === 0) continue;

        try {
          const columnsInfo = this.origPrepare(`PRAGMA table_info("${table}")`).all();
          const validCols = new Set(columnsInfo.map(c => c.name));

          for (const row of rows) {
            // If importing users, ensure we don't collide on UNIQUE username with a different id
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

    if (storageReady) {
      await this.restoreFromStorageBackup();
    }

    if (pgReady) {
      await this.pullFromPostgresToSqlite();
      await this.pushLocalToPostgres();
      this.lastSyncAt = new Date().toISOString();
      console.log(`Connected to Supabase Postgres tables at ${this.getHostLabel()}`);
    } else if (storageReady) {
      await this.saveToStorageBackup();
      this.lastSyncAt = new Date().toISOString();
      console.log(`Connected to Supabase (${this.getHostLabel()}) via cloud snapshot sync. Run supabase_schema.sql in Supabase SQL Editor to enable native Postgres tables.`);
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
        if (error) {
          console.warn(`Supabase upsert warning on table ${table}:`, error.message);
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
        this.importRowsIntoSqlite(parsed.tables);
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
      const payload = JSON.stringify({
        updatedAt: new Date().toISOString(),
        tables: this.exportLocalTables()
      }, null, 2);

      const { error } = await this.client.storage
        .from(BACKUP_BUCKET)
        .upload(BACKUP_FILE, Buffer.from(payload, 'utf-8'), {
          contentType: 'application/json',
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
