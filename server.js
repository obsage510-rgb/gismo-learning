const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { Readable } = require('stream');

// Load environment variables (.env.local and .env)
try {
  require('dotenv').config({ path: path.join(__dirname, '.env.local') });
  require('dotenv').config({ path: path.join(__dirname, '.env') });
} catch (_) {}

const { SupabaseDatabaseBridge } = require('./supabase_db');

let elevenlabs = null;
function getElevenLabs() {
  if (!elevenlabs) {
    const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
    elevenlabs = new ElevenLabsClient();
  }
  return elevenlabs;
}


const app = express();
const PORT = process.env.PORT || 8000;
const IS_VERCEL = !!process.env.VERCEL;
const BUNDLED_DB_PATH = path.join(__dirname, 'gismo.db');
const DB_PATH = IS_VERCEL ? path.join(os.tmpdir(), 'gismo.db') : BUNDLED_DB_PATH;
const UPLOAD_FOLDER = IS_VERCEL ? path.join(os.tmpdir(), 'uploads') : path.join(__dirname, 'uploads');

if (IS_VERCEL && !fs.existsSync(DB_PATH) && fs.existsSync(BUNDLED_DB_PATH)) {
  try {
    fs.copyFileSync(BUNDLED_DB_PATH, DB_PATH);
  } catch (err) {
    console.warn('Could not copy bundled database to /tmp:', err.message);
  }
}

try {
  if (!fs.existsSync(UPLOAD_FOLDER)) {
    fs.mkdirSync(UPLOAD_FOLDER, { recursive: true });
  }
} catch (_) {}

// Load .env
let GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';
if (fs.existsSync(path.join(__dirname, '.env'))) {
  const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const k = trimmed.slice(0, idx).trim();
      const v = trimmed.slice(idx + 1).trim();
      if (k === 'GOOGLE_API_KEY') GOOGLE_API_KEY = v;
    }
  }
}

// Initialize SQLite + Supabase Bridge
const db = new DatabaseSync(DB_PATH);
try {
  db.exec('PRAGMA foreign_keys = OFF;');
} catch (_) {}
const supabaseBridge = new SupabaseDatabaseBridge(db);
const { searchGutenbergCatalog, getGutenbergBookById } = require('./gutenberg_catalog');

// Initialize Antigravity AI Model
const AntigravityTutorModel = require('./antigravity_model');
const antigravityTutor = new AntigravityTutorModel(GOOGLE_API_KEY);

function initDb() {
  db.exec(`
    PRAGMA foreign_keys = OFF;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT,
      school TEXT,
      reg_no TEXT,
      disability TEXT,
      role TEXT DEFAULT 'student',
      quizzes_passed INTEGER DEFAULT 0,
      last_login_date TEXT,
      current_streak INTEGER DEFAULT 0,
      preferred_learning_mode TEXT DEFAULT 'visual'
    );

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      content TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS textbooks (
      id TEXT PRIMARY KEY,
      title TEXT,
      meta TEXT,
      image TEXT,
      descriptor TEXT,
      content TEXT,
      quiz_q TEXT,
      quiz_a TEXT,
      user_id INTEGER DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      filename TEXT,
      filepath TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS homework (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      description TEXT,
      student_id INTEGER,
      status TEXT DEFAULT 'pending',
      FOREIGN KEY(student_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      role TEXT,
      content TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS quizzes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      subject TEXT,
      created_by TEXT DEFAULT 'teacher',
      assigned_to TEXT DEFAULT 'all',
      questions TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS quiz_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_id INTEGER,
      student_id INTEGER,
      student_username TEXT,
      score INTEGER,
      total INTEGER,
      percentage INTEGER,
      answers TEXT,
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(quiz_id) REFERENCES quizzes(id),
      FOREIGN KEY(student_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS donations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      donor_name TEXT,
      donor_email TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'NGN',
      frequency TEXT DEFAULT 'one-time',
      quick_note TEXT DEFAULT '',
      payment_method TEXT DEFAULT 'paystack',
      reference TEXT UNIQUE,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS newsletter_subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      target_email TEXT DEFAULT 'gismolearning@gmail.com',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const prevHydrating = supabaseBridge.isHydrating;
  supabaseBridge.isHydrating = true;
  try {
    try {
      db.prepare("ALTER TABLE chats ADD COLUMN session_id TEXT DEFAULT 'default'").run();
    } catch (_) {
      // Column already exists
    }

    try {
      db.prepare("ALTER TABLE homework ADD COLUMN submission_file TEXT").run();
    } catch (_) {}
    try {
      db.prepare("ALTER TABLE homework ADD COLUMN submission_filename TEXT").run();
    } catch (_) {}
    try {
      db.prepare("ALTER TABLE homework ADD COLUMN submission_date DATETIME").run();
    } catch (_) {}
    try {
      db.prepare("ALTER TABLE textbooks ADD COLUMN user_id INTEGER DEFAULT NULL").run();
    } catch (_) {}
    try {
      db.prepare("DELETE FROM textbooks WHERE user_id IS NULL AND id NOT LIKE '%\\_u%' ESCAPE '\\'").run();
    } catch (_) {}

    // Default presentation admin user (username: admin, password: admin123 or admin)
    const admin = db.prepare("SELECT * FROM users WHERE LOWER(username) = 'admin'").get();
    if (!admin) {
      const hPw = generatePasswordHash('admin123');
      db.prepare(`
        INSERT INTO users (username, password, school, reg_no, disability, role)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('admin', hPw, 'Gismo Academy', 'ADM-001', 'None', 'admin');
    } else if (admin.role !== 'admin') {
      db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(admin.id);
    }
  } finally {
    supabaseBridge.isHydrating = prevHydrating;
  }

  supabaseBridge.ensureReady().catch(err => {
    console.warn('Supabase initialization warning:', err.message);
  });
}

// Password helpers (compatible with Werkzeug scrypt)
function checkPasswordHash(storedHash, password) {
  if (!storedHash) return false;
  if (!storedHash.includes('$')) return storedHash === password;
  const parts = storedHash.split('$');
  if (parts.length === 3) {
    const [method, salt, hash] = parts;
    if (method.startsWith('scrypt:')) {
      const [_, N, r, p] = method.split(':');
      const computed = crypto.scryptSync(password, salt, 64, {
        N: parseInt(N, 10),
        r: parseInt(r, 10),
        p: parseInt(p, 10),
        maxmem: 128 * 1024 * 1024
      }).toString('hex');
      try {
        return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'));
      } catch (e) {
        return false;
      }
    }
  }
  return false;
}

function generatePasswordHash(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const N = 16384, r = 8, p = 1;
  const hash = crypto.scryptSync(password, salt, 64, {
    N, r, p, maxmem: 128 * 1024 * 1024
  }).toString('hex');
  return `scrypt:${N}:${r}:${p}$${salt}$${hash}`;
}

let global_announcement = '';

// Multer storage for uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_FOLDER),
  filename: (req, file, cb) => {
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, Date.now() + '-' + cleanName);
  }
});
const upload = multer({ storage, limits: { fileSize: 16 * 1024 * 1024 } });

// Middleware
app.use(cors());
app.use(express.json({ limit: '16mb' }));
app.use(express.urlencoded({ extended: true, limit: '16mb' }));

app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, post-check=0, pre-check=0, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '-1');
  next();
});

function resolveStudentUser(rawUserId, rawUsername) {
  const cleanName = String(rawUsername || '').trim();
  const numId = rawUserId ? Number(rawUserId) : null;
  let user = null;

  if (cleanName) {
    user = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(cleanName);
  }
  if (!user && numId && !Number.isNaN(numId)) {
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(numId);
  }
  if (!user && cleanName) {
    const today = new Date().toISOString().split('T')[0];
    const regNo = 'STD-' + Math.floor(1000 + Math.random() * 9000);
    const info = db.prepare(`
      INSERT INTO users (username, password, school, reg_no, disability, role, quizzes_passed, last_login_date, current_streak)
      VALUES (?, '', 'Gismo Academy', ?, 'None', 'student', 0, ?, 1)
    `).run(cleanName, regNo, today);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
  }

  // If the client had an older local user_id on one device that differs from the canonical user.id,
  // migrate any orphaned textbooks/notes/chats from numId to user.id so devices stay 100% in sync.
  if (user && numId && !Number.isNaN(numId) && Number(user.id) !== numId) {
    const otherUser = db.prepare('SELECT id FROM users WHERE id = ?').get(numId);
    if (!otherUser) {
      try { db.prepare('UPDATE textbooks SET user_id = ? WHERE user_id = ?').run(user.id, numId); } catch (_) {}
      try { db.prepare('UPDATE notes SET user_id = ? WHERE user_id = ?').run(user.id, numId); } catch (_) {}
      try { db.prepare('UPDATE chats SET user_id = ? WHERE user_id = ?').run(user.id, numId); } catch (_) {}
    }
  }

  return user ? user.id : (numId && !Number.isNaN(numId) ? numId : null);
}

// Ensure Supabase is hydrated on cold starts and pulled on warm instances, then flush writes before Vercel freezes
app.use('/api', async (req, res, next) => {
  if (supabaseBridge.configured) {
    try {
      const shouldForcePull = req.method !== 'GET' || req.path.startsWith('/textbooks');
      await supabaseBridge.ensureReady({ forcePull: shouldForcePull });
    } catch (_) {}

    const origJson = res.json.bind(res);
    res.json = function wrappedJson(body) {
      if (supabaseBridge.hasPendingWrites()) {
        return supabaseBridge.flushWrites().finally(() => origJson(body));
      }
      return origJson(body);
    };
  }
  next();
});

// Serve static frontend files (disable default index so / serves landing.html)
app.use(express.static(path.join(__dirname), { index: false }));
app.use('/uploads', express.static(UPLOAD_FOLDER));

// Root route -> Landing Page; /app -> Learning Portal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'landing.html'));
});

app.get('/landing', (req, res) => {
  res.sendFile(path.join(__dirname, 'landing.html'));
});

app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/contact', async (req, res) => {
  const { name, email, topic, message } = req.body || {};
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email, and message are required.' });
  }
  const targetEmail = (process.env.NEWSLETTER_TARGET_EMAIL || 'gismolearning@gmail.com').trim();
  try {
    await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(targetEmail)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        name: String(name).trim(),
        email: String(email).trim(),
        _subject: `[Gismo Contact] ${topic || 'General Inquiry'}`,
        message: String(message).trim()
      })
    }).catch(() => {});
  } catch (_) {}
  return res.json({
    success: true,
    message: `Thank you, ${String(name).trim()}! Your message regarding "${topic || 'General Inquiry'}" has been sent to ${targetEmail}.`
  });
});

app.post('/api/newsletter', async (req, res) => {
  const rawEmail = String((req.body && req.body.email) || '').trim().toLowerCase();
  if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  const targetEmail = (process.env.NEWSLETTER_TARGET_EMAIL || 'gismolearning@gmail.com').trim();
  try {
    db.prepare('INSERT OR IGNORE INTO newsletter_subscribers (email, target_email) VALUES (?, ?)').run(rawEmail, targetEmail);
  } catch (err) {
    console.warn('Newsletter DB insert warning:', err.message);
  }
  try {
    await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(targetEmail)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        email: rawEmail,
        _subject: 'New Gismo Newsletter Subscriber',
        message: `New newsletter signup from ${rawEmail} on Gismo Learning.`
      })
    }).catch(() => {});
  } catch (_) {}
  return res.json({
    success: true,
    targetEmail,
    message: `Subscribed! Updates from ${targetEmail} will be sent to ${rawEmail}.`
  });
});

app.get('/api/donations/config', (req, res) => {
  const publicKey = (process.env.PAYSTACK_PUBLIC_KEY || '').trim();
  const secretKey = (process.env.PAYSTACK_SECRET_KEY || '').trim();
  const zecNodeUrl = (process.env.ZEC_ROCKS_URL || 'https://zec.rocks:443').trim();
  const zecWallet = (process.env.ZEC_DONATION_ADDRESS || '').trim();
  res.json({
    paystackConfigured: !!(publicKey && secretKey),
    paystackPublicKey: publicKey,
    defaultCurrency: (process.env.PAYSTACK_CURRENCY || 'NGN').toUpperCase(),
    zecNodeUrl,
    zecWallet,
    cryptoWallet: zecWallet
  });
});

app.post('/api/donations/crypto/verify', async (req, res) => {
  const {
    tx_hash = '',
    network = 'Zcash Shielded (Unified)',
    token = 'ZEC',
    amount = 0,
    name = 'ZEC Supporter',
    email = '',
    quick_note = ''
  } = req.body || {};

  const cleanHash = String(tx_hash || '').trim().replace(/^0x/i, '');
  const cleanName = String(name || 'ZEC Supporter').trim() || 'ZEC Supporter';
  const cleanEmail = String(email || '').trim() || 'zec-donor@gismo.org';
  const cleanNote = String(quick_note || '').trim().slice(0, 500);
  const numericAmount = Number(amount) || 0;

  if (!cleanHash || !/^[a-fA-F0-9]{64}$/.test(cleanHash)) {
    return res.status(400).json({ error: 'Please enter a valid 64-character Zcash transaction ID (txid).' });
  }

  let status = 'recorded';
  let verifiedOnChain = false;
  let blockHeight = null;

  try {
    const expRes = await fetch(`https://mainnet.zcashexplorer.app/api/v1/tx/${cleanHash}`, {
      headers: { 'User-Agent': 'GismoLearning/1.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(6000)
    });
    if (expRes.ok) {
      const txData = await expRes.json();
      if (txData && (txData.txid || txData.hash)) {
        blockHeight = txData.blockHeight || txData.height || null;
        if (blockHeight || (txData.confirmations && txData.confirmations > 0)) {
          status = 'success';
          verifiedOnChain = true;
        } else {
          status = 'pending_confirmation';
        }
      }
    }
  } catch (_) {
    // Fallback to Blockchair Zcash API if zcashexplorer is slow
    try {
      const bcRes = await fetch(`https://api.blockchair.com/zcash/dashboards/transaction/${cleanHash}`, {
        headers: { 'User-Agent': 'GismoLearning/1.0' },
        signal: AbortSignal.timeout(6000)
      });
      if (bcRes.ok) {
        const bcData = await bcRes.json();
        const txEntry = bcData && bcData.data && bcData.data[cleanHash] && bcData.data[cleanHash].transaction;
        if (txEntry) {
          blockHeight = txEntry.block_id && txEntry.block_id > 0 ? txEntry.block_id : null;
          status = blockHeight ? 'success' : 'pending_confirmation';
          verifiedOnChain = !!blockHeight;
        }
      }
    } catch (_) {}
  }

  try {
    db.prepare(`
      INSERT OR REPLACE INTO donations (donor_name, donor_email, amount, currency, frequency, quick_note, payment_method, reference, status)
      VALUES (?, ?, ?, ?, 'one-time', ?, ?, ?, ?)
    `).run(cleanName, cleanEmail, numericAmount, `${token} (${network})`, cleanNote, 'zec.rocks', cleanHash, status);
  } catch (_) {}

  return res.json({
    success: true,
    verifiedOnChain,
    status,
    blockHeight,
    reference: cleanHash,
    message: verifiedOnChain
      ? `ZEC donation verified on-chain via Zec.rocks (Block #${blockHeight})! Thank you, ${cleanName}, for your ${numericAmount ? `${numericAmount} ZEC ` : ''}gift${cleanNote ? ` ("${cleanNote}")` : ''}.`
      : `ZEC donation recorded via Zec.rocks (Tx: ${cleanHash.slice(0, 12)}...). Confirmation will finalize once mined on Zcash mainnet.`
  });
});

app.post('/api/donations/initialize', async (req, res) => {
  const {
    amount,
    currency = 'NGN',
    frequency = 'one-time',
    name = 'Supporter',
    email,
    quick_note = '',
    callback_url = ''
  } = req.body || {};

  const numericAmount = Number(amount);
  const cleanEmail = (email || '').trim();
  const cleanName = (name || 'Supporter').trim() || 'Supporter';
  const cleanNote = String(quick_note || '').trim().slice(0, 500);
  const cleanCurrency = (currency || 'NGN').toUpperCase();

  if (!numericAmount || numericAmount <= 0 || !cleanEmail) {
    return res.status(400).json({ error: 'A valid donation amount and email are required.' });
  }

  const reference = `GISMO-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const secretKey = (process.env.PAYSTACK_SECRET_KEY || '').trim();
  const publicKey = (process.env.PAYSTACK_PUBLIC_KEY || '').trim();

  if (secretKey) {
    try {
      const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: cleanEmail,
          amount: Math.round(numericAmount * 100), // Paystack expects kobo / cents
          currency: cleanCurrency,
          reference,
          callback_url: callback_url || undefined,
          metadata: {
            donor_name: cleanName,
            frequency,
            quick_note: cleanNote,
            custom_fields: [
              { display_name: 'Donor Name', variable_name: 'donor_name', value: cleanName },
              { display_name: 'Frequency', variable_name: 'frequency', value: frequency },
              { display_name: 'Quick Note', variable_name: 'quick_note', value: cleanNote || 'None' }
            ]
          }
        }),
        signal: AbortSignal.timeout(8000)
      });

      const paystackData = await paystackRes.json();
      if (paystackRes.ok && paystackData.status && paystackData.data) {
        try {
          db.prepare(`
            INSERT INTO donations (donor_name, donor_email, amount, currency, frequency, quick_note, payment_method, reference, status)
            VALUES (?, ?, ?, ?, ?, ?, 'paystack', ?, 'pending')
          `).run(cleanName, cleanEmail, numericAmount, cleanCurrency, frequency, cleanNote, reference);
        } catch (_) {}

        return res.json({
          success: true,
          mode: 'paystack_live',
          reference,
          publicKey,
          access_code: paystackData.data.access_code,
          authorization_url: paystackData.data.authorization_url
        });
      }
      return res.status(400).json({
        error: paystackData.message || 'Paystack initialization failed. Please verify your Paystack keys.'
      });
    } catch (err) {
      return res.status(502).json({ error: 'Could not reach Paystack right now: ' + err.message });
    }
  }

  // Fallback pledge/demo mode when PAYSTACK_SECRET_KEY is not yet configured in environment
  try {
    db.prepare(`
      INSERT INTO donations (donor_name, donor_email, amount, currency, frequency, quick_note, payment_method, reference, status)
      VALUES (?, ?, ?, ?, ?, ?, 'paystack_pledge', ?, 'recorded')
    `).run(cleanName, cleanEmail, numericAmount, cleanCurrency, frequency, cleanNote, reference);
  } catch (_) {}

  const symbol = cleanCurrency === 'NGN' ? '₦' : '$';
  return res.json({
    success: true,
    mode: 'demo_pledge',
    reference,
    message: `Thank you, ${cleanName}! Your ${symbol}${numericAmount.toLocaleString()} ${frequency} contribution${cleanNote ? ` ("${cleanNote}")` : ''} has been recorded (Ref: ${reference}). Add PAYSTACK_PUBLIC_KEY & PAYSTACK_SECRET_KEY in Vercel to enable live card/bank checkout.`
  });
});

app.get('/api/donations/verify/:reference', async (req, res) => {
  const reference = String(req.params.reference || '').trim();
  if (!reference) return res.status(400).json({ error: 'Reference required' });

  const secretKey = (process.env.PAYSTACK_SECRET_KEY || '').trim();
  if (secretKey) {
    try {
      const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${secretKey}` },
        signal: AbortSignal.timeout(8000)
      });
      const verifyData = await verifyRes.json();
      if (verifyRes.ok && verifyData.status && verifyData.data && verifyData.data.status === 'success') {
        try {
          db.prepare("UPDATE donations SET status = 'success' WHERE reference = ?").run(reference);
        } catch (_) {}
        const row = db.prepare('SELECT * FROM donations WHERE reference = ?').get(reference);
        return res.json({
          verified: true,
          status: 'success',
          reference,
          donation: row || {
            donor_name: (verifyData.data.metadata && verifyData.data.metadata.donor_name) || 'Supporter',
            amount: (verifyData.data.amount || 0) / 100,
            currency: verifyData.data.currency || 'NGN',
            quick_note: (verifyData.data.metadata && verifyData.data.metadata.quick_note) || ''
          }
        });
      }
      return res.json({ verified: false, status: (verifyData.data && verifyData.data.status) || 'pending', reference });
    } catch (err) {
      return res.status(502).json({ error: 'Could not verify Paystack transaction: ' + err.message });
    }
  }

  const row = db.prepare('SELECT * FROM donations WHERE reference = ?').get(reference);
  return res.json({ verified: !!row, status: row ? row.status : 'not_found', reference, donation: row || null });
});

app.post('/api/donations', (req, res) => {
  const { amount, currency = 'NGN', frequency = 'one-time', name = 'Supporter', email, quick_note = '' } = req.body || {};
  const numericAmount = Number(amount);
  if (!numericAmount || numericAmount <= 0 || !email) {
    return res.status(400).json({ error: 'Valid donation amount and email are required.' });
  }
  const reference = `GISMO-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  try {
    db.prepare(`
      INSERT INTO donations (donor_name, donor_email, amount, currency, frequency, quick_note, payment_method, reference, status)
      VALUES (?, ?, ?, ?, ?, ?, 'paystack_pledge', ?, 'recorded')
    `).run(String(name).trim() || 'Supporter', String(email).trim(), numericAmount, currency, frequency, String(quick_note || '').trim(), reference);
  } catch (_) {}
  return res.json({
    success: true,
    reference,
    message: `Thank you, ${String(name).trim() || 'Supporter'}! Your ${currency === 'NGN' ? '₦' : '$'}${numericAmount} ${frequency} contribution pledge has been recorded (Ref: ${reference}).`
  });
});

// --- AUTH API ---
app.post('/api/auth/register', (req, res) => {
  const { username, password, school = 'Gismo Academy', reg_no = '', disability = 'None', role = 'student' } = req.body;
  const cleanUsername = (username || '').trim();
  const cleanPassword = (password || '').trim();

  if (!cleanUsername || !cleanPassword) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(cleanUsername);
  if (existing) {
    return res.status(409).json({ error: 'That Student ID is already registered. Please log in or choose another.' });
  }

  const hPw = generatePasswordHash(cleanPassword);
  const cleanSchool = (school || 'Gismo Academy').trim();
  const cleanRegNo = (reg_no || '').trim() || ('STD-' + Math.floor(1000 + Math.random() * 9000));
  try {
    const result = db.prepare(`
      INSERT INTO users (username, password, school, reg_no, disability, role, quizzes_passed, current_streak)
      VALUES (?, ?, ?, ?, ?, ?, 0, 1)
    `).run(cleanUsername, hPw, cleanSchool, cleanRegNo, disability, role);
    
    const insertedId = Number(result.lastInsertRowid);
    const newUser = db.prepare('SELECT id, username, role, quizzes_passed, current_streak, school, reg_no, disability, preferred_learning_mode FROM users WHERE id = ?').get(insertedId);
    return res.json(newUser);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'That Student ID is already registered.' });
    }
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { username, password, role, school = '', reg_no = '', disability = 'None' } = req.body;
  const cleanUsername = (username || '').trim();
  const cleanPassword = (password || '').trim();

  if (!cleanUsername || !cleanPassword) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const today = new Date().toISOString().split('T')[0];
  const isDefaultAdminLogin =
    (cleanUsername.toLowerCase() === 'admin' || cleanUsername.toLowerCase() === 'admin@gismo.edu' || cleanUsername.toLowerCase() === 'instructor') &&
    (cleanPassword === 'admin' || cleanPassword === 'admin123' || role === 'admin');

  if (isDefaultAdminLogin) {
    let adminUser = db.prepare("SELECT * FROM users WHERE LOWER(username) = 'admin'").get();
    if (!adminUser) {
      const hPw = generatePasswordHash('admin123');
      const info = db.prepare(`
        INSERT INTO users (username, password, school, reg_no, disability, role, quizzes_passed, last_login_date, current_streak)
        VALUES ('admin', ?, 'Gismo Academy', 'ADM-001', 'None', 'admin', 0, ?, 1)
      `).run(hPw, today);
      adminUser = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
    } else {
      db.prepare("UPDATE users SET role = 'admin', last_login_date = ? WHERE id = ?").run(today, adminUser.id);
      adminUser = db.prepare('SELECT * FROM users WHERE id = ?').get(adminUser.id);
    }
    return res.json(adminUser);
  }

  // Match strictly by username first; only check reg_no if no username matched
  let user = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(cleanUsername);
  if (!user) {
    user = db.prepare("SELECT * FROM users WHERE reg_no IS NOT NULL AND reg_no != '' AND LOWER(reg_no) = LOWER(?)").get(cleanUsername);
  }

  // If user is not found, auto-provision the account with non-empty defaults
  if (!user) {
    const hPw = generatePasswordHash(cleanPassword);
    const assignedRole = role === 'admin' ? 'admin' : 'student';
    const assignedSchool = (school || '').trim() || 'Gismo Academy';
    const assignedRegNo = (reg_no || '').trim() || ('STD-' + Math.floor(1000 + Math.random() * 9000));
    const info = db.prepare(`
      INSERT INTO users (username, password, school, reg_no, disability, role, quizzes_passed, last_login_date, current_streak)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, 1)
    `).run(cleanUsername, hPw, assignedSchool, assignedRegNo, disability || 'None', assignedRole, today);
    const createdUser = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
    return res.json(createdUser);
  }

  let validPassword = checkPasswordHash(user.password, cleanPassword);
  if (!validPassword && !user.password) {
    const newHash = generatePasswordHash(cleanPassword);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(newHash, user.id);
    validPassword = true;
  }

  if (validPassword) {
    const lastLogin = user.last_login_date;
    let currentStreak = user.current_streak || 1;

    if (lastLogin) {
      const lastDate = new Date(lastLogin);
      const currDate = new Date(today);
      const diffDays = Math.round((currDate - lastDate) / (1000 * 60 * 60 * 24));
      if (diffDays === 1) {
        currentStreak += 1;
      } else if (diffDays > 1) {
        currentStreak = 1;
      }
    } else {
      currentStreak = Math.max(1, currentStreak);
    }

    const updatedRole = role === 'admin' ? 'admin' : (user.role || 'student');
    db.prepare('UPDATE users SET last_login_date = ?, current_streak = ?, role = ? WHERE id = ?').run(today, currentStreak, updatedRole, user.id);
    const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    return res.json(updatedUser);
  }
  return res.status(401).json({ error: 'Invalid username or password. Please try again.' });
});

// --- ADMIN API ---
app.get('/api/admin/users', (req, res) => {
  const users = db.prepare('SELECT * FROM users').all();
  res.json(users);
});

app.get('/api/admin/users/:user_id/analytics', (req, res) => {
  const userId = req.params.user_id;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const notesCount = db.prepare('SELECT COUNT(*) as count FROM notes WHERE user_id = ?').get(userId).count;
  const homeworkCount = db.prepare('SELECT COUNT(*) as count FROM homework WHERE student_id = ?').get(userId).count;
  res.json({
    quizzes_passed: user.quizzes_passed,
    notes_count: notesCount,
    homework_assigned: homeworkCount,
    rank: user.quizzes_passed < 5 ? 'Novice' : 'Scholar'
  });
});

app.post('/api/admin/textbooks', (req, res) => {
  const { id, title, meta, image, descriptor, content, quiz_q, quiz_a } = req.body;
  db.prepare(`
    INSERT INTO textbooks (id, title, meta, image, descriptor, content, quiz_q, quiz_a)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, title, meta, image, descriptor, content, quiz_q, quiz_a);
  res.json({ status: 'success' });
});

// Upload custom course thumbnail
app.post('/api/upload/thumbnail', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image file uploaded' });
  }
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ success: true, url: fileUrl, filename: req.file.filename });
});

app.delete('/api/admin/textbooks/:tb_id', (req, res) => {
  db.prepare('DELETE FROM textbooks WHERE id = ?').run(req.params.tb_id);
  res.json({ success: true });
});

// Instructor dashboard overall statistics
app.get('/api/admin/stats', (req, res) => {
  try {
    const studentCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'student'").get().count;
    const courseCount = db.prepare("SELECT COUNT(*) as count FROM textbooks").get().count;
    const homeworkCount = db.prepare("SELECT COUNT(*) as count FROM homework").get().count;
    const accommodations = db.prepare("SELECT disability, COUNT(*) as count FROM users WHERE role = 'student' GROUP BY disability").all();
    res.json({
      students: studentCount,
      courses: courseCount,
      homework: homeworkCount,
      accommodations: accommodations
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/announcement', (req, res) => {
  global_announcement = req.body.message || '';
  res.json({ success: true, announcement: global_announcement });
});

app.get('/api/announcement', (req, res) => {
  res.json({ announcement: global_announcement });
});

// --- SUPABASE STATUS & SYNC API ---
app.get('/api/supabase/status', async (req, res) => {
  await supabaseBridge.checkPostgresTables();
  res.json(supabaseBridge.getStatus());
});

app.post('/api/supabase/sync', async (req, res) => {
  try {
    const status = await supabaseBridge.init();
    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ADMIN DATABASE VIEWER API ---
// 1. Overview of tables, storage size, and schema
app.get('/api/admin/database/overview', async (req, res) => {
  try {
    if (supabaseBridge.configured) {
      await supabaseBridge.checkPostgresTables();
      if (supabaseBridge.postgresTablesReady) {
        await supabaseBridge.pullFromPostgresToSqlite();
      }
    }

    const stat = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH) : { size: 0 };
    const tablesRaw = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC").all();

    let totalRows = 0;
    const tables = tablesRaw.map(t => {
      const count = db.prepare(`SELECT COUNT(*) as count FROM "${t.name}"`).get().count;
      totalRows += count;
      const columns = db.prepare(`PRAGMA table_info("${t.name}")`).all();
      return {
        name: t.name,
        rowCount: count,
        columns: columns.map(c => ({
          name: c.name,
          type: c.type,
          pk: !!c.pk,
          notnull: !!c.notnull,
          default: c.dflt_value
        }))
      };
    });

    const sbStatus = supabaseBridge.getStatus();
    res.json({
      provider: sbStatus.configured ? 'supabase' : 'sqlite',
      supabase: sbStatus,
      databaseFile: sbStatus.configured ? sbStatus.host : path.basename(DB_PATH),
      databasePath: sbStatus.configured ? sbStatus.supabaseUrl : DB_PATH,
      sizeBytes: stat.size,
      sizeFormatted: (stat.size / 1024).toFixed(1) + ' KB',
      totalTables: tables.length,
      totalRows,
      tables
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Fetch records for a specific table with search, pagination, and sorting
app.get('/api/admin/database/table/:name', (req, res) => {
  try {
    const tableName = req.params.name;
    const checkTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(tableName);
    if (!checkTable) {
      return res.status(404).json({ error: `Table '${tableName}' does not exist.` });
    }

    const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all();
    const columnNames = columns.map(c => c.name);

    let limit = parseInt(req.query.limit, 10);
    if (isNaN(limit) || limit < 1) limit = 50;
    if (limit > 500) limit = 500;

    let offset = parseInt(req.query.offset, 10);
    if (isNaN(offset) || offset < 0) offset = 0;

    const search = (req.query.search || '').trim();
    let sort = req.query.sort;
    if (!columnNames.includes(sort)) {
      const pkCol = columns.find(c => c.pk);
      sort = pkCol ? pkCol.name : columnNames[0];
    }
    const order = (req.query.order || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    const totalCount = db.prepare(`SELECT COUNT(*) as count FROM "${tableName}"`).get().count;

    let rows = [];
    let filteredCount = totalCount;

    if (search) {
      const searchClauses = columnNames.map(col => `CAST("${col}" AS TEXT) LIKE ?`).join(' OR ');
      const searchParam = `%${search}%`;
      const searchParams = Array(columnNames.length).fill(searchParam);

      filteredCount = db.prepare(`SELECT COUNT(*) as count FROM "${tableName}" WHERE ${searchClauses}`).get(...searchParams).count;
      const queryStr = `SELECT * FROM "${tableName}" WHERE ${searchClauses} ORDER BY "${sort}" ${order} LIMIT ? OFFSET ?`;
      rows = db.prepare(queryStr).all(...searchParams, limit, offset);
    } else {
      const queryStr = `SELECT * FROM "${tableName}" ORDER BY "${sort}" ${order} LIMIT ? OFFSET ?`;
      rows = db.prepare(queryStr).all(limit, offset);
    }

    res.json({
      tableName,
      columns: columns.map(c => ({
        name: c.name,
        type: c.type,
        pk: !!c.pk,
        notnull: !!c.notnull,
        default: c.dflt_value
      })),
      rows,
      totalCount,
      filteredCount,
      limit,
      offset,
      sort,
      order
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Execute custom read-only SQL query
app.post('/api/admin/database/query', (req, res) => {
  try {
    const rawSql = (req.body.query || '').trim();
    if (!rawSql) {
      return res.status(400).json({ error: 'SQL query cannot be empty.' });
    }

    const cleaned = rawSql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const firstWord = cleaned.split(/\s+/)[0].toUpperCase();
    const allowed = ['SELECT', 'PRAGMA', 'EXPLAIN'];
    if (!allowed.includes(firstWord)) {
      return res.status(403).json({
        error: 'Only read-only queries (SELECT, PRAGMA, EXPLAIN) are permitted in the instructor database viewer.'
      });
    }

    const forbidden = /\b(DROP|DELETE|INSERT|UPDATE|ALTER|ATTACH|DETACH|CREATE|REPLACE|VACUUM|REINDEX|TRUNCATE)\b/i;
    if (forbidden.test(cleaned)) {
      return res.status(403).json({
        error: 'Write or destructive operations (INSERT, UPDATE, DELETE, DROP, etc.) are restricted in this viewer to protect student records.'
      });
    }

    const start = performance.now();
    const rows = db.prepare(rawSql).all();
    const durationMs = (performance.now() - start).toFixed(2);

    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

    res.json({
      success: true,
      columns,
      rows,
      rowCount: rows.length,
      durationMs: parseFloat(durationMs)
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 4. Export table data (CSV or JSON)
app.get('/api/admin/database/export/:name', (req, res) => {
  try {
    const tableName = req.params.name;
    const checkTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(tableName);
    if (!checkTable) {
      return res.status(404).json({ error: 'Table not found' });
    }

    const rows = db.prepare(`SELECT * FROM "${tableName}"`).all();
    const format = (req.query.format || 'json').toLowerCase();

    if (format === 'csv') {
      if (rows.length === 0) {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${tableName}.csv"`);
        return res.send('');
      }
      const headers = Object.keys(rows[0]);
      const csvLines = [headers.join(',')];
      for (const row of rows) {
        const line = headers.map(h => {
          let val = row[h];
          if (val === null || val === undefined) return '""';
          val = String(val).replace(/"/g, '""');
          return `"${val}"`;
        }).join(',');
        csvLines.push(line);
      }
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${tableName}.csv"`);
      return res.send(csvLines.join('\n'));
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${tableName}.json"`);
      return res.send(JSON.stringify(rows, null, 2));
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- TEXTBOOKS API ---
app.get('/api/textbooks', (req, res) => {
  const userId = resolveStudentUser(req.query.user_id, req.query.username);
  if (!userId || Number.isNaN(userId)) {
    return res.json([]);
  }
  const suffixPattern = `%_u${userId}`;
  const textbooks = db.prepare('SELECT * FROM textbooks WHERE user_id = ? OR id LIKE ?').all(userId, suffixPattern);
  res.json(textbooks);
});

app.post('/api/textbooks/sync', (req, res) => {
  const { user_id, username, books } = req.body || {};
  const userId = resolveStudentUser(user_id, username);
  if (!userId || Number.isNaN(userId) || !Array.isArray(books)) {
    return res.json([]);
  }
  const deletedSet = (supabaseBridge && supabaseBridge.deletedIdsByTable && supabaseBridge.deletedIdsByTable.textbooks) || new Set();
  for (const b of books) {
    if (!b || !b.id || !b.title) continue;
    const rawBaseId = String(b.id).replace(/_u\d+$/, '');
    const canonicalId = rawBaseId.startsWith('gutenberg_') ? `${rawBaseId}_u${userId}` : String(b.id);
    if (deletedSet.has(canonicalId) || deletedSet.has(String(b.id))) continue;

    const existing = db.prepare('SELECT id FROM textbooks WHERE id = ?').get(canonicalId);
    if (!existing) {
      try {
        db.prepare(`
          INSERT OR REPLACE INTO textbooks (id, title, meta, image, descriptor, content, quiz_q, quiz_a, user_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          canonicalId,
          b.title,
          b.meta || 'Web Book',
          b.image || '',
          b.descriptor || 'Open this book to start reading.',
          b.content || '',
          b.quiz_q || '',
          b.quiz_a || '',
          userId
        );
      } catch (_) {}
    }
  }
  const suffixPattern = `%_u${userId}`;
  const textbooks = db.prepare('SELECT * FROM textbooks WHERE user_id = ? OR id LIKE ?').all(userId, suffixPattern);
  res.json(textbooks);
});

app.delete('/api/textbooks/:id', (req, res) => {
  const rawUserId = (req.body && req.body.user_id) || req.query.user_id;
  const rawUsername = (req.body && req.body.username) || req.query.username;
  const userId = resolveStudentUser(rawUserId, rawUsername);
  if (!userId || Number.isNaN(userId)) {
    return res.status(400).json({ error: 'Please sign in to remove books from your library.' });
  }
  try {
    const rawBaseId = String(req.params.id).replace(/_u\d+$/, '');
    const canonicalId = `${rawBaseId}_u${userId}`;
    const info = db.prepare('DELETE FROM textbooks WHERE (id = ? OR id = ?) AND (user_id = ? OR id LIKE ?)').run(
      req.params.id,
      canonicalId,
      userId,
      `%_u${userId}`
    );
    if (supabaseBridge && typeof supabaseBridge.recordDeletedIds === 'function') {
      supabaseBridge.recordDeletedIds('textbooks', [req.params.id, canonicalId]);
    }
    if (info.changes === 0) {
      return res.status(404).json({ error: 'Book not found in your library.' });
    }
    return res.json({ status: 'success', deleted: req.params.id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// --- WEB BOOKS API ---
app.get('/api/web/search', async (req, res) => {
  const query = (req.query.q || '').trim();
  const isFeatured = !query || query === 'featured' || query === 'all';
  if (isFeatured) {
    return res.json(searchGutenbergCatalog('featured'));
  }

  const catalogMatches = searchGutenbergCatalog(query);
  const results = [...catalogMatches];
  const seenKeys = new Set(results.map(b => `${String(b.id)}`));
  const seenTitles = new Set(results.map(b => String(b.title || '').toLowerCase().trim()));

  const addResult = (item) => {
    const idKey = String(item.id);
    const titleKey = String(item.title || '').toLowerCase().trim();
    if (!idKey || !titleKey || seenKeys.has(idKey) || seenTitles.has(titleKey)) return;
    seenKeys.add(idKey);
    seenTitles.add(titleKey);
    results.push(item);
  };

  const opdsPromise = fetch(`https://www.gutenberg.org/ebooks/search.opds/?query=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': 'GismoLearning/1.0' },
    signal: AbortSignal.timeout(6500)
  }).then(async (r) => {
    if (!r.ok) return [];
    const xml = await r.text();
    const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
    return entries.slice(0, 12).map((entry) => {
      const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/i);
      const idMatch = entry.match(/ebooks\/(\d+)/i);
      const authorMatch = entry.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/i);
      const coverMatch = entry.match(/<link[^>]+rel=["']http:\/\/opds-spec\.org\/image(?:\/thumbnail)?["'][^>]+href=["']([^"']+)["']/i);
      const decodeXml = (s) => (s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
      if (!idMatch || !titleMatch) return null;
      const ebookId = idMatch[1];
      let coverUrl = coverMatch ? decodeXml(coverMatch[1]) : `https://www.gutenberg.org/cache/epub/${ebookId}/pg${ebookId}.cover.medium.jpg`;
      if (coverUrl.startsWith('/')) coverUrl = `https://www.gutenberg.org${coverUrl}`;
      return {
        id: ebookId,
        title: decodeXml(titleMatch[1]),
        author: decodeXml(authorMatch ? authorMatch[1] : 'Project Gutenberg Author'),
        subject: 'Project Gutenberg',
        image: coverUrl
      };
    }).filter(Boolean);
  }).catch(() => []);

  const gutendexPromise = fetch(`https://gutendex.com/books?search=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': 'GismoLearning/1.0', 'Accept': 'application/json' },
    signal: AbortSignal.timeout(6500)
  }).then(async (r) => {
    if (!r.ok) return [];
    const data = await r.json();
    return (data.results || []).slice(0, 10).map((book) => ({
      id: String(book.id),
      title: book.title || 'Unknown Title',
      author: book.authors && book.authors[0] ? book.authors[0].name : 'Unknown Author',
      subject: 'Project Gutenberg',
      image: (book.formats && book.formats['image/jpeg']) || `https://www.gutenberg.org/cache/epub/${book.id}/pg${book.id}.cover.medium.jpg`
    }));
  }).catch(() => []);

  const openLibraryPromise = fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=10`, {
    headers: { 'User-Agent': 'GismoLearning/1.0', 'Accept': 'application/json' },
    signal: AbortSignal.timeout(6500)
  }).then(async (r) => {
    if (!r.ok) return [];
    const data = await r.json();
    return (data.docs || []).slice(0, 10).map((doc) => {
      const workId = String(doc.key || '').replace('/works/', '');
      if (!workId) return null;
      return {
        id: `ol_${workId}`,
        title: doc.title || 'Unknown Title',
        author: Array.isArray(doc.author_name) && doc.author_name[0] ? doc.author_name[0] : 'Unknown Author',
        subject: 'Open Library',
        descriptor: doc.first_publish_year ? `First published in ${doc.first_publish_year}.` : 'Public catalog book.',
        image: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : ''
      };
    }).filter(Boolean);
  }).catch(() => []);

  const settled = await Promise.allSettled([opdsPromise, gutendexPromise, openLibraryPromise]);
  for (const outcome of settled) {
    if (outcome.status === 'fulfilled' && Array.isArray(outcome.value)) {
      outcome.value.forEach(addResult);
    }
  }

  res.json(results);
});

app.post('/api/web/import/:book_id', async (req, res) => {
  const rawUserId = (req.body && req.body.user_id) || req.query.user_id;
  const rawUsername = (req.body && req.body.username) || req.query.username;
  const userId = resolveStudentUser(rawUserId, rawUsername);
  if (!userId || Number.isNaN(userId)) {
    return res.status(400).json({ error: 'Please sign in to import books into your personal library.' });
  }

  const bookId = String(req.params.book_id).replace(/^gutenberg_/, '').replace(/_u\d+$/, '');
  const catalogBook = getGutenbergBookById(bookId);
  const bodyTitle = (req.body && req.body.title) ? String(req.body.title).trim() : '';
  const bodyAuthor = (req.body && req.body.author) ? String(req.body.author).trim() : '';
  const bodyImage = (req.body && req.body.image) ? String(req.body.image).trim() : '';

  try {
    let title = (catalogBook && catalogBook.title) || bodyTitle || 'Classic Public Domain Work';
    let author = (catalogBook && catalogBook.author) || bodyAuthor || 'Project Gutenberg Author';
    let image = bodyImage || (catalogBook && catalogBook.image) || (/^\d+$/.test(bookId) ? `https://www.gutenberg.org/cache/epub/${bookId}/pg${bookId}.cover.medium.jpg` : '');
    let descriptor = (catalogBook && catalogBook.descriptor) || `A classic work by ${author}.`;
    let content = '';
    let quiz_q = (catalogBook && catalogBook.quiz_q) || `Who is the author of the book '${title}'?`;
    let quiz_a = (catalogBook && catalogBook.quiz_a) || author;

    const cleanGutenbergText = (rawText) => {
      let text = String(rawText || '').replace(/\r\n/g, '\n');
      const startMatch = text.match(/\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[\s\S]*?\*\*\*/i);
      if (startMatch && startMatch.index !== undefined) {
        text = text.slice(startMatch.index + startMatch[0].length);
      }
      const endMatch = text.match(/\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK/i);
      if (endMatch && endMatch.index !== undefined) {
        text = text.slice(0, endMatch.index);
      }
      return text.trim().slice(0, 1500000);
    };

    // Open Library work import (+ Internet Archive full text when available)
    if (bookId.startsWith('ol_')) {
      const workId = bookId.slice(3);
      try {
        const olRes = await fetch(`https://openlibrary.org/works/${encodeURIComponent(workId)}.json`, {
          headers: { 'User-Agent': 'GismoLearning/1.0', 'Accept': 'application/json' },
          signal: AbortSignal.timeout(6000)
        });
        if (olRes.ok) {
          const work = await olRes.json();
          title = work.title || title;
          if (!image && Array.isArray(work.covers) && work.covers[0]) {
            image = `https://covers.openlibrary.org/b/id/${work.covers[0]}-M.jpg`;
          }
          const descText = typeof work.description === 'string'
            ? work.description
            : (work.description && work.description.value ? work.description.value : '');
          const subjects = Array.isArray(work.subjects) ? work.subjects.slice(0, 8).join(', ') : '';

          // Try to find a full-text Internet Archive edition
          try {
            const edRes = await fetch(`https://openlibrary.org/works/${encodeURIComponent(workId)}/editions.json?limit=8`, {
              headers: { 'User-Agent': 'GismoLearning/1.0', 'Accept': 'application/json' },
              signal: AbortSignal.timeout(6000)
            });
            if (edRes.ok) {
              const edData = await edRes.json();
              const withIa = (edData.entries || []).find(e => e.ocaid);
              if (withIa && withIa.ocaid) {
                const iaRes = await fetch(`https://archive.org/download/${encodeURIComponent(withIa.ocaid)}/${encodeURIComponent(withIa.ocaid)}_djvu.txt`, {
                  headers: { 'User-Agent': 'GismoLearning/1.0' },
                  signal: AbortSignal.timeout(10000)
                });
                if (iaRes.ok) {
                  const iaText = (await iaRes.text()).trim();
                  if (iaText.length > 1000) {
                    content = iaText.slice(0, 1500000);
                  }
                }
              }
            }
          } catch (_) {}

          if (!content) {
            content = [
              title,
              `By ${author}`,
              '',
              descText || `Study edition of "${title}" by ${author}.`,
              subjects ? `\nKey Topics: ${subjects}` : '',
              '\nUse the Gismo AI Tutor on the right to explore chapters, summarize key ideas, or generate a practice quiz!'
            ].filter(Boolean).join('\n');
          }
        }
      } catch (_) {}
    }

    // For Project Gutenberg numeric IDs, always try to fetch the FULL book text
    if (!content && /^\d+$/.test(bookId)) {
      const candidateUrls = [
        `https://www.gutenberg.org/cache/epub/${bookId}/pg${bookId}.txt`,
        `https://www.gutenberg.org/files/${bookId}/${bookId}-0.txt`,
        `https://www.gutenberg.org/files/${bookId}/${bookId}.txt`
      ];
      for (const directUrl of candidateUrls) {
        try {
          const directRes = await fetch(directUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(12000)
          });
          if (directRes.ok) {
            const cleaned = cleanGutenbergText(await directRes.text());
            if (cleaned.length > 500) {
              content = cleaned;
              break;
            }
          }
        } catch (_) {}
      }
    }

    if (!content && /^\d+$/.test(bookId)) {
      try {
        const bookRes = await fetch(`https://gutendex.com/books/${bookId}`, {
          headers: { 'User-Agent': 'GismoLearning/1.0', 'Accept': 'application/json' },
          signal: AbortSignal.timeout(7000)
        });
        if (bookRes.ok) {
          const book = await bookRes.json();
          title = book.title || title;
          author = book.authors && book.authors[0] ? book.authors[0].name : author;
          const formats = book.formats || {};
          image = image || formats['image/jpeg'] || `https://www.gutenberg.org/cache/epub/${bookId}/pg${bookId}.cover.medium.jpg`;
          descriptor = `A classic public domain book by ${author}.`;
          quiz_q = `Who is the author of the book '${title}'?`;
          quiz_a = author;
          const textUrl = formats['text/plain; charset=utf-8'] || formats['text/plain; charset=us-ascii'] || formats['text/plain'];
          if (textUrl) {
            const textRes = await fetch(textUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0' },
              signal: AbortSignal.timeout(12000)
            });
            if (textRes.ok) {
              const cleaned = cleanGutenbergText(await textRes.text());
              if (cleaned.length > 500) {
                content = cleaned;
              }
            }
          }
        }
      } catch (_) {}
    }

    // Fall back to curated excerpt only if full-text network fetch failed
    if (!content && catalogBook && catalogBook.content) {
      content = catalogBook.content;
    }

    if (!content) {
      content = `${title}\nBy ${author}\n\nGismo Study Edition (Book #${bookId}).\n\nThis work explores foundational themes and key concepts. Use the Gismo AI Tutor on the right to ask questions, summarize chapters, or generate a comprehension quiz!`;
    }

    const lessonId = `gutenberg_${bookId}_u${userId}`;

    db.prepare(`
      INSERT OR REPLACE INTO textbooks (id, title, meta, image, descriptor, content, quiz_q, quiz_a, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(lessonId, title, 'Web Book', image, descriptor, content, quiz_q, quiz_a, userId);

    return res.json({ status: 'success', lesson_id: lessonId, title, author, char_count: content.length, book: { id: lessonId, title, author } });
  } catch (err) {
    console.error('Import error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// --- USER PROFILE & DATA ---
app.get('/api/users/:user_id', (req, res) => {
  const userId = resolveStudentUser(req.params.user_id, req.query.username);
  try {
    const user = userId
      ? db.prepare('SELECT id, username, school, reg_no, disability, role, quizzes_passed, current_streak, last_login_date, preferred_learning_mode FROM users WHERE id = ?').get(userId)
      : null;

    if (!user) {
      return res.status(404).json({ error: 'User profile not found' });
    }
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:user_id', (req, res) => {
  const userId = resolveStudentUser(req.params.user_id, (req.body && req.body.username) || req.query.username);
  const { disability, preferred_learning_mode, school, reg_no } = req.body;
  try {
    const existing = userId ? db.prepare('SELECT * FROM users WHERE id = ?').get(userId) : null;
    if (!existing) return res.status(404).json({ error: 'User not found' });

    const newDisability = disability !== undefined ? disability : existing.disability;
    const newMode = preferred_learning_mode !== undefined ? preferred_learning_mode : existing.preferred_learning_mode;
    const newSchool = school !== undefined ? school : existing.school;
    const newRegNo = reg_no !== undefined ? reg_no : existing.reg_no;

    db.prepare('UPDATE users SET disability = ?, preferred_learning_mode = ?, school = ?, reg_no = ? WHERE id = ?')
      .run(newDisability, newMode, newSchool, newRegNo, existing.id);

    const updatedUser = db.prepare('SELECT id, username, school, reg_no, disability, role, quizzes_passed, current_streak, last_login_date, preferred_learning_mode FROM users WHERE id = ?').get(existing.id);
    res.json(updatedUser);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/notes', (req, res) => {
  const userId = resolveStudentUser(req.query.user_id, req.query.username);
  if (!userId) return res.status(400).json({ error: 'user_id required' });
  const notes = db.prepare('SELECT * FROM notes WHERE user_id = ? ORDER BY timestamp DESC').all(userId);
  res.json(notes);
});

app.post('/api/notes', (req, res) => {
  const rawUserId = req.query.user_id || (req.body && req.body.user_id);
  const rawUsername = req.query.username || (req.body && req.body.username);
  const userId = resolveStudentUser(rawUserId, rawUsername);
  const content = req.body.content;
  if (!userId || !content) return res.status(400).json({ error: 'user_id and content required' });
  db.prepare('INSERT INTO notes (user_id, content) VALUES (?, ?)').run(userId, content);
  res.json({ status: 'success' });
});

app.get('/api/analytics/:user_id', (req, res) => {
  const effectiveId = resolveStudentUser(req.params.user_id, req.query.username);
  const user = effectiveId ? db.prepare('SELECT id, username, quizzes_passed, current_streak FROM users WHERE id = ?').get(effectiveId) : null;
  const notesCount = effectiveId ? db.prepare('SELECT COUNT(*) as count FROM notes WHERE user_id = ?').get(effectiveId).count : 0;
  const filesCount = effectiveId ? db.prepare('SELECT COUNT(*) as count FROM files WHERE user_id = ?').get(effectiveId).count : 0;

  const quizzes = (user && Number(user.quizzes_passed)) || 0;
  const streak = (user && Number(user.current_streak)) || 1;
  let rank = 'Novice';
  if (quizzes >= 5) rank = 'Scholar';
  if (quizzes >= 15) rank = 'Master';

  res.json({
    quizzes_passed: quizzes,
    current_streak: streak,
    notes_saved: notesCount,
    files_uploaded: filesCount,
    rank,
    next_rank_goal: quizzes < 5 ? 5 : (quizzes < 15 ? 15 : 'Max')
  });
});

// --- COMPREHENSIVE QUIZ SYSTEM API ---

// 1. Get quizzes visible to student (assigned to all or to specific student)
app.get('/api/quizzes', (req, res) => {
  const studentId = req.query.student_id ? parseInt(req.query.student_id, 10) : null;
  try {
    const allQuizzes = db.prepare('SELECT * FROM quizzes ORDER BY id DESC').all();

    const filtered = allQuizzes.filter(q => {
      if (!q.assigned_to || q.assigned_to === 'all') return true;
      if (!studentId) return true;
      try {
        const ids = JSON.parse(q.assigned_to);
        if (Array.isArray(ids)) {
          return ids.map(Number).includes(Number(studentId));
        }
      } catch (e) {
        return q.assigned_to.split(',').map(s => s.trim()).includes(String(studentId));
      }
      return false;
    });

    const result = filtered.map(q => {
      let questions = [];
      try { questions = JSON.parse(q.questions); } catch (e) {}
      let submission = null;
      if (studentId) {
        submission = db.prepare('SELECT score, total, percentage, answers, submitted_at FROM quiz_submissions WHERE quiz_id = ? AND student_id = ? ORDER BY id DESC LIMIT 1').get(q.id, studentId);
      }
      return {
        id: q.id,
        title: q.title,
        subject: q.subject,
        created_by: q.created_by,
        assigned_to: q.assigned_to,
        question_count: questions.length,
        created_at: q.created_at,
        submission: submission || null
      };
    });

    res.json(result);
  } catch (err) {
    console.error('Error fetching quizzes:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Get specific quiz details by ID (including questions)
app.get('/api/quizzes/:id', (req, res) => {
  try {
    const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(req.params.id);
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
    let questions = [];
    try { questions = JSON.parse(quiz.questions); } catch (e) {}
    res.json({
      ...quiz,
      questions
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. AI Quiz Generator (powered by Antigravity / Gemini)
app.post('/api/ai/generate-quiz', async (req, res) => {
  const { topic = 'General Knowledge', count = 3, difficulty = 'intermediate', subject = '' } = req.body;
  try {
    const quiz = await antigravityTutor.generateQuiz({ topic, count, difficulty, subject });
    res.json(quiz);
  } catch (err) {
    console.error('AI quiz generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. Submit student quiz answers & compute grading
app.post('/api/quizzes/submit', (req, res) => {
  const { quiz_id, student_id, student_username, current_quizzes_passed = 0, current_streak = 0, answers, raw_quiz } = req.body;
  if (!answers || typeof answers !== 'object') {
    return res.status(400).json({ error: 'answers array or object is required' });
  }

  try {
    // Resolve student accurately by ID and/or username
    let student = null;
    if (student_id) {
      student = db.prepare('SELECT id, username, quizzes_passed, current_streak FROM users WHERE id = ?').get(student_id);
    }
    if (student_username && (!student || student.username.toLowerCase() !== String(student_username).toLowerCase())) {
      const byName = db.prepare('SELECT id, username, quizzes_passed, current_streak FROM users WHERE LOWER(username) = LOWER(?)').get(String(student_username).trim());
      if (byName) student = byName;
    }

    // If student doesn't exist yet in this serverless instance, provision them so progress is never lost or capped at 1
    if (!student && student_username && String(student_username).trim()) {
      try {
        const cleanName = String(student_username).trim();
        const baselinePassed = Math.max(0, Number(current_quizzes_passed) || 0);
        const info = db.prepare(`
          INSERT INTO users (username, password, school, reg_no, disability, role, quizzes_passed, current_streak)
          VALUES (?, '', 'Gismo Academy', '', 'None', 'student', ?, 1)
        `).run(cleanName, baselinePassed);
        student = db.prepare('SELECT id, username, quizzes_passed, current_streak FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
      } catch (_) {}
    }

    const effectiveStudentId = student ? Number(student.id) : (Number(student_id) || 1);
    const username = student ? student.username : (student_username || 'Student');

    let quizData = null;
    let actualQuizId = quiz_id ? Number(quiz_id) || quiz_id : null;

    if (quiz_id) {
      try {
        quizData = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(quiz_id);
      } catch (_) {}
    }

    let questions = [];
    if (quizData) {
      try { questions = JSON.parse(quizData.questions); } catch (e) {}
    }
    if ((!questions || !questions.length) && raw_quiz && Array.isArray(raw_quiz.questions)) {
      questions = raw_quiz.questions;
      // Auto-save dynamic AI quiz to maintain history in database
      if (!quizData) {
        try {
          const stmt = db.prepare(`
            INSERT INTO quizzes (title, subject, created_by, assigned_to, questions)
            VALUES (?, ?, 'ai', ?, ?)
          `);
          const info = stmt.run(
            raw_quiz.title || 'AI Generated Quiz',
            raw_quiz.subject || 'AI Knowledge Check',
            JSON.stringify([effectiveStudentId]),
            JSON.stringify(questions)
          );
          actualQuizId = Number(info.lastInsertRowid);
        } catch (saveErr) {
          console.warn('Could not auto-save AI quiz record:', saveErr.message);
        }
      }
    }

    if (!questions.length) {
      return res.status(404).json({ error: 'Quiz questions not found' });
    }

    let score = 0;
    const total = questions.length;
    const answerBreakdown = questions.map((q, idx) => {
      const selectedIndex = answers[idx] !== undefined && answers[idx] !== null ? parseInt(answers[idx], 10) : -1;
      const rawCorrect = q.answerIndex !== undefined ? q.answerIndex : q.correctIndex;
      const correctIndex = parseInt(rawCorrect, 10);
      const isCorrect = selectedIndex === correctIndex;
      if (isCorrect) score += 1;
      return {
        questionId: q.id || (idx + 1),
        question: q.question,
        options: q.options,
        selectedIndex,
        correctIndex,
        isCorrect,
        explanation: q.explanation || ''
      };
    });

    const percentage = Math.round((score / total) * 100);
    const passed = percentage >= 60;

    if (actualQuizId) {
      try {
        db.prepare(`
          INSERT INTO quiz_submissions (quiz_id, student_id, student_username, score, total, percentage, answers)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(Number(actualQuizId) || null, effectiveStudentId, username, score, total, percentage, JSON.stringify(answers));
      } catch (subErr) {
        console.warn('Quiz submission log warning:', subErr.message);
      }
    }

    const clientBaseline = Math.max(0, Number(current_quizzes_passed) || 0);
    const clientStreakBaseline = Math.max(0, Number(current_streak) || 0);
    let totalPassed = student ? Math.max(Number(student.quizzes_passed) || 0, clientBaseline) : clientBaseline;
    let totalStreak = student ? Math.max(Number(student.current_streak) || 0, clientStreakBaseline) : clientStreakBaseline;

    if (passed) {
      totalPassed += 1;
      totalStreak += 1;
      if (student) {
        try {
          db.prepare('UPDATE users SET quizzes_passed = ?, current_streak = ? WHERE id = ?')
            .run(totalPassed, totalStreak, student.id);
        } catch (_) {}
      }
    }

    const updatedUser = student
      ? db.prepare('SELECT quizzes_passed, current_streak FROM users WHERE id = ?').get(student.id)
      : null;

    res.json({
      success: true,
      quiz_id: actualQuizId,
      score,
      total,
      percentage,
      passed,
      quizzes_passed_total: updatedUser ? Math.max(Number(updatedUser.quizzes_passed) || 0, totalPassed) : totalPassed,
      current_streak: updatedUser ? Math.max(Number(updatedUser.current_streak) || 0, totalStreak) : totalStreak,
      breakdown: answerBreakdown
    });
  } catch (err) {
    console.error('Quiz submission error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5. Admin: Create custom quiz and assign to all or selected students
app.post('/api/admin/quizzes', (req, res) => {
  const { title, subject, target = 'all', student_ids = [], questions = [] } = req.body;
  if (!title || !questions || !questions.length) {
    return res.status(400).json({ error: 'Quiz title and at least one question are required' });
  }

  let assigned_to = 'all';
  if (target === 'selected' && Array.isArray(student_ids) && student_ids.length > 0) {
    assigned_to = JSON.stringify(student_ids.map(Number));
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO quizzes (title, subject, created_by, assigned_to, questions)
      VALUES (?, ?, 'teacher', ?, ?)
    `);
    const info = stmt.run(title.trim(), (subject || 'General').trim(), assigned_to, JSON.stringify(questions));
    res.json({ success: true, quiz_id: Number(info.lastInsertRowid) });
  } catch (err) {
    console.error('Error creating custom quiz:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6. Admin: Get all custom quizzes and their submission analytics
app.get('/api/admin/quizzes', (req, res) => {
  try {
    const quizzes = db.prepare('SELECT * FROM quizzes ORDER BY id DESC').all();
    const students = db.prepare("SELECT id, username, school, reg_no FROM users WHERE role = 'student'").all();
    const studentMap = {};
    students.forEach(s => { studentMap[s.id] = s; });

    const result = quizzes.map(q => {
      let questions = [];
      try { questions = JSON.parse(q.questions); } catch (e) {}

      let targetText = 'All Students';
      let targetNames = [];
      if (q.assigned_to && q.assigned_to !== 'all') {
        try {
          const ids = JSON.parse(q.assigned_to);
          targetNames = ids.map(id => studentMap[id]?.username || `Student #${id}`);
          targetText = `${targetNames.length} Selected Student${targetNames.length === 1 ? '' : 's'}`;
        } catch (e) {
          targetText = q.assigned_to;
        }
      }

      const submissions = db.prepare(`
        SELECT qs.*, u.username as student_name, u.reg_no
        FROM quiz_submissions qs
        LEFT JOIN users u ON qs.student_id = u.id
        WHERE qs.quiz_id = ?
        ORDER BY qs.submitted_at DESC
      `).all(q.id);

      const totalSubmissions = submissions.length;
      const avgPercentage = totalSubmissions > 0
        ? Math.round(submissions.reduce((acc, cur) => acc + (cur.percentage || 0), 0) / totalSubmissions)
        : null;

      return {
        id: q.id,
        title: q.title,
        subject: q.subject,
        created_by: q.created_by,
        assigned_to: q.assigned_to,
        target_display: targetText,
        target_students: targetNames,
        question_count: questions.length,
        created_at: q.created_at,
        submissions_count: totalSubmissions,
        average_score: avgPercentage,
        submissions: submissions
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Admin: Delete quiz and its submissions
app.delete('/api/admin/quizzes/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM quiz_submissions WHERE quiz_id = ?').run(req.params.id);
    db.prepare('DELETE FROM quizzes WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- LOCAL FILES & HOMEWORK ---
app.post('/api/files', upload.single('file'), (req, res) => {
  const userId = req.body.user_id;
  if (!req.file || !userId) {
    return res.status(400).json({ error: 'File and user_id required' });
  }
  db.prepare('INSERT INTO files (user_id, filename, filepath) VALUES (?, ?, ?)').run(userId, req.file.originalname, req.file.filename);
  res.json({ status: 'success', filename: req.file.filename });
});

app.get('/api/files', (req, res) => {
  const userId = req.query.user_id;
  if (!userId) return res.status(400).json({ error: 'user_id required' });
  const files = db.prepare('SELECT * FROM files WHERE user_id = ?').all(userId);
  res.json(files);
});

app.post('/api/homework', (req, res) => {
  const { title, description, student_id } = req.body;
  db.prepare('INSERT INTO homework (title, description, student_id) VALUES (?, ?, ?)').run(title, description, student_id);
  res.json({ success: true });
});

app.get('/api/homework', (req, res) => {
  const studentId = req.query.student_id;
  if (!studentId) return res.json([]);
  try {
    const hws = db.prepare('SELECT * FROM homework WHERE student_id = ? ORDER BY id DESC').all(studentId);
    res.json(hws);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/homework/:id/toggle', (req, res) => {
  const hwId = req.params.id;
  try {
    const hw = db.prepare('SELECT * FROM homework WHERE id = ?').get(hwId);
    if (!hw) return res.status(404).json({ error: 'Assignment not found' });
    const newStatus = hw.status === 'completed' ? 'pending' : 'completed';
    db.prepare('UPDATE homework SET status = ? WHERE id = ?').run(newStatus, hwId);
    const updated = db.prepare('SELECT * FROM homework WHERE id = ?').get(hwId);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/homework/:id/submit', (req, res) => {
  const hwId = req.params.id;
  const { responseText } = req.body;
  try {
    const hw = db.prepare('SELECT * FROM homework WHERE id = ?').get(hwId);
    if (!hw) return res.status(404).json({ error: 'Assignment not found' });
    db.prepare('UPDATE homework SET status = ? WHERE id = ?').run('completed', hwId);
    if (responseText && hw.student_id) {
      db.prepare('INSERT INTO notes (user_id, content) VALUES (?, ?)').run(
        hw.student_id,
        `Assignment Completed [${hw.title}]: ${responseText}`
      );
    }
    const updated = db.prepare('SELECT * FROM homework WHERE id = ?').get(hwId);
    res.json({ success: true, assignment: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/homework/:id/upload', upload.single('submission_file'), (req, res) => {
  const hwId = req.params.id;
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const hw = db.prepare('SELECT * FROM homework WHERE id = ?').get(hwId);
    if (!hw) return res.status(404).json({ error: 'Assignment not found' });

    db.prepare(`
      UPDATE homework 
      SET submission_file = ?, submission_filename = ?, submission_date = CURRENT_TIMESTAMP, status = 'completed' 
      WHERE id = ?
    `).run(req.file.filename, req.file.originalname, hwId);

    // Also register in student's files so it appears in their course library
    if (hw.student_id) {
      try {
        db.prepare('INSERT INTO files (user_id, filename, filepath) VALUES (?, ?, ?)').run(
          hw.student_id,
          req.file.originalname,
          req.file.filename
        );
        db.prepare('INSERT INTO notes (user_id, content) VALUES (?, ?)').run(
          hw.student_id,
          `Assignment Submitted [${hw.title}]: File attached (${req.file.originalname})`
        );
      } catch (e) {
        console.warn("Could not insert into files/notes:", e);
      }
    }

    const updated = db.prepare('SELECT * FROM homework WHERE id = ?').get(hwId);
    res.json({ success: true, assignment: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ANTIGRAVITY AI MODEL API ---
app.get('/api/tutor/info', (req, res) => {
  res.json(antigravityTutor.getModelInfo());
});

app.post('/api/tutor/model', async (req, res) => {
  const { prompt, persona, context, history } = req.body;
  const result = await antigravityTutor.generateResponse({
    message: prompt,
    persona,
    context,
    history
  });
  res.json(result);
});

// --- CHAT API (Multi-Session Enabled) ---
app.get('/api/chat/history', (req, res) => {
  const userId = resolveStudentUser(req.query.user_id, req.query.username);
  const sessionId = req.query.session_id;
  if (!userId) return res.json([]);
  try {
    let chats;
    if (sessionId) {
      chats = db.prepare("SELECT role, content, session_id FROM chats WHERE user_id = ? AND (session_id = ? OR (session_id IS NULL AND ? = 'default')) ORDER BY timestamp ASC").all(userId, sessionId, sessionId);
    } else {
      chats = db.prepare('SELECT role, content, session_id FROM chats WHERE user_id = ? ORDER BY timestamp ASC').all(userId);
    }
    res.json(chats || []);
  } catch (err) {
    console.error("Error fetching chat history:", err);
    res.json([]);
  }
});

app.get('/api/chat/sessions', (req, res) => {
  const userId = resolveStudentUser(req.query.user_id, req.query.username);
  if (!userId) return res.json([]);
  try {
    const rows = db.prepare(`
      SELECT session_id, MIN(timestamp) as created_at,
             (SELECT content FROM chats c2 WHERE c2.user_id = chats.user_id AND c2.session_id = chats.session_id AND c2.role = 'user' ORDER BY timestamp ASC LIMIT 1) as first_question
      FROM chats
      WHERE user_id = ? AND session_id IS NOT NULL AND session_id != ''
      GROUP BY session_id
      ORDER BY created_at ASC
    `).all(userId);
    res.json(rows || []);
  } catch (err) {
    console.error("Error fetching chat sessions:", err);
    res.json([]);
  }
});

app.delete('/api/chat/session', (req, res) => {
  const { user_id, username, session_id } = req.query;
  const resolvedId = resolveStudentUser(user_id, username);
  if (resolvedId && session_id) {
    try {
      db.prepare('DELETE FROM chats WHERE user_id = ? AND session_id = ?').run(resolvedId, session_id);
    } catch (err) {
      console.error("Error deleting chat session:", err);
    }
  }
  res.json({ success: true });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message = '', persona = 'default', context = '', user_id, username, session_id = 'default' } = req.body || {};
    if (!message) return res.status(400).json({ error: 'No message provided' });

    const resolvedUserId = resolveStudentUser(user_id, username);

    if (resolvedUserId) {
      try {
        db.prepare('INSERT INTO chats (user_id, role, content, session_id) VALUES (?, ?, ?, ?)').run(resolvedUserId, 'user', message, session_id);
      } catch (e) {
        try {
          db.prepare('INSERT INTO chats (user_id, role, content) VALUES (?, ?, ?)').run(resolvedUserId, 'user', message);
        } catch (_) {}
      }
    }

    let history = [];
    if (resolvedUserId) {
      try {
        const recent = db.prepare("SELECT role, content FROM chats WHERE user_id = ? AND (session_id = ? OR (session_id IS NULL AND ? = 'default')) ORDER BY timestamp DESC LIMIT 10").all(resolvedUserId, session_id, session_id);
        if (recent && recent.length > 1) {
          history = recent.reverse().slice(0, -1);
        }
      } catch (e) {
        try {
          const recent = db.prepare('SELECT role, content FROM chats WHERE user_id = ? ORDER BY timestamp DESC LIMIT 10').all(resolvedUserId);
          if (recent && recent.length > 1) {
            history = recent.reverse().slice(0, -1);
          }
        } catch (_) {}
      }
    }

    const result = await antigravityTutor.generateResponse({
      message,
      persona,
      context: String(context || '').slice(0, 6000),
      history
    });

    if (resolvedUserId && result.reply) {
      try {
        db.prepare('INSERT INTO chats (user_id, role, content, session_id) VALUES (?, ?, ?, ?)').run(resolvedUserId, 'model', result.reply, session_id);
      } catch (e) {
        try {
          db.prepare('INSERT INTO chats (user_id, role, content) VALUES (?, ?, ?)').run(resolvedUserId, 'model', result.reply);
        } catch (_) {}
      }
    }

    return res.json({
      reply: result.reply,
      model: result.model,
      persona: result.persona || persona,
      session_id,
      status: result.status || 'ok'
    });
  } catch (err) {
    console.error('Chat endpoint error:', err.message);
    return res.json({
      reply: antigravityTutor.buildLocalTutorReply(req.body?.message || '', req.body?.persona || 'default', req.body?.context || ''),
      model: 'Antigravity-Gismo-Flash-2.5',
      persona: req.body?.persona || 'default',
      session_id: req.body?.session_id || 'default',
      status: 'ok'
    });
  }
});

app.post('/api/log_error', (req, res) => {
  console.log('CLIENT ERROR:', req.body);
  res.json({ status: 'ok' });
});

// --- ElevenLabs Text-to-Speech Endpoints ---
let elevenLabsQuotaExceeded = false;
let elevenLabsQuotaMessage = "";

app.get('/api/tts/status', (req, res) => {
  res.json({
    elevenlabs_configured: !!process.env.ELEVENLABS_API_KEY,
    quota_exceeded: elevenLabsQuotaExceeded,
    message: elevenLabsQuotaMessage
  });
});

app.get('/api/tts/voices', async (req, res) => {
  if (elevenLabsQuotaExceeded) {
    return res.json({ voices: [], quota_exceeded: true, message: elevenLabsQuotaMessage });
  }

  try {
    const response = await getElevenLabs().voices.getAll();
    const voices = (response.voices || []).map(v => ({
      voice_id: v.voice_id,
      name: v.name,
      category: v.category,
      labels: v.labels
    }));
    res.json({ voices, quota_exceeded: false });
  } catch (err) {
    const msg = err.message || "";
    const isQuota = msg.includes('quota') || msg.includes('credit') || msg.includes('401') || msg.includes('402');
    if (isQuota) {
      elevenLabsQuotaExceeded = true;
      elevenLabsQuotaMessage = msg;
      console.warn("ElevenLabs credits exhausted:", msg);
      return res.json({ voices: [], quota_exceeded: true, message: msg });
    }
    console.warn("Could not fetch remote ElevenLabs voices:", err.message);
    res.json({ voices: [], quota_exceeded: false });
  }
});

app.post('/api/tts', async (req, res) => {
  const { text, voice_id, model_id = "eleven_flash_v2_5" } = req.body;
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: "Text is required" });
  }

  if (elevenLabsQuotaExceeded) {
    return res.status(402).json({
      error: "quota_exceeded",
      message: "ElevenLabs credits are exhausted. Switching to browser speech synthesis.",
      fallback: true
    });
  }

  let activeVoiceId = voice_id;
  if (!activeVoiceId || activeVoiceId === "undefined" || activeVoiceId === "null" || typeof activeVoiceId !== 'string' || !activeVoiceId.trim()) {
    activeVoiceId = "JBFqnCBsd6RMkjVDRZzb"; // Default: George
  }

  try {
    // Strip markdown formatting for cleaner speech synthesis
    const cleanText = text
      .replace(/[*_#`~\[\]]/g, '')
      .replace(/<[^>]+>/g, '')
      .trim();

    const audioStream = await getElevenLabs().textToSpeech.convert(activeVoiceId, {
      text: cleanText,
      modelId: model_id,
      outputFormat: "mp3_44100_128"
    });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-cache');
    Readable.fromWeb(audioStream).pipe(res);
  } catch (err) {
    console.error("ElevenLabs textToSpeech error:", err.message);
    const msg = err.message || "";
    const isQuota = msg.includes('quota') || msg.includes('credit') || msg.includes('401') || msg.includes('402');
    if (isQuota) {
      elevenLabsQuotaExceeded = true;
      elevenLabsQuotaMessage = msg;
      return res.status(402).json({
        error: "quota_exceeded",
        message: "ElevenLabs credits are exhausted. Switching to browser speech synthesis.",
        fallback: true
      });
    }
    res.status(500).json({ error: "Failed to generate speech with ElevenLabs", fallback: true });
  }
});

// Initialize database and start server
initDb();
if (!process.env.VERCEL) {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Gismo Accessible AI Learning server listening at http://localhost:${PORT}`);
  });
}

module.exports = app;
