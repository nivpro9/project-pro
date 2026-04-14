const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Create table if not exists
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      counter INTEGER,
      worker_name TEXT,
      worker_phone TEXT,
      room TEXT,
      category TEXT,
      priority TEXT,
      description TEXT,
      media_base64 TEXT,
      media_type TEXT,
      status TEXT DEFAULT 'new',
      notes TEXT DEFAULT '',
      created_at BIGINT,
      updated_at BIGINT
    );
    CREATE TABLE IF NOT EXISTS counter (
      id INTEGER PRIMARY KEY DEFAULT 1,
      value INTEGER DEFAULT 0
    );
    INSERT INTO counter (id, value) VALUES (1, 0) ON CONFLICT DO NOTHING;
  `);
  console.log('✅ Database ready');
}

// Routes
app.get('/', (req, res) => res.redirect('/worker'));
app.get('/worker',  (req, res) => res.sendFile(path.join(__dirname, 'worker.html')));
app.get('/manager', (req, res) => res.sendFile(path.join(__dirname, 'manager.html')));

// POST /api/tickets — create new ticket
app.post('/api/tickets', async (req, res) => {
  try {
    const now = Date.now();
    // Increment counter atomically
    const ctr = await pool.query(
      'UPDATE counter SET value = value + 1 WHERE id = 1 RETURNING value'
    );
    const num = ctr.rows[0].value;
    const id = 'PP-' + String(num).padStart(3, '0');

    await pool.query(
      `INSERT INTO tickets
        (id, counter, worker_name, worker_phone, room, category, priority,
         description, media_base64, media_type, status, notes, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'new','',$11,$11)`,
      [
        id, num,
        req.body.workerName   || '',
        req.body.workerPhone  || '',
        req.body.room         || '',
        req.body.category     || '',
        req.body.priority     || 'regular',
        req.body.description  || '',
        req.body.mediaBase64  || '',
        req.body.mediaType    || '',
        now
      ]
    );
    res.json({ success: true, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/tickets — return all tickets, newest first
app.get('/api/tickets', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM tickets ORDER BY created_at DESC'
    );
    const tickets = result.rows.map(r => ({
      id:           r.id,
      workerName:   r.worker_name,
      workerPhone:  r.worker_phone,
      room:         r.room,
      category:     r.category,
      priority:     r.priority,
      description:  r.description,
      mediaBase64:  r.media_base64,
      mediaType:    r.media_type,
      status:       r.status,
      notes:        r.notes,
      createdAt:    Number(r.created_at),
      updatedAt:    Number(r.updated_at)
    }));
    res.json(tickets);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/tickets/:id — update status and/or notes
app.patch('/api/tickets/:id', async (req, res) => {
  try {
    const { status, notes } = req.body;
    const now = Date.now();
    const updates = [];
    const values = [];
    let i = 1;
    if (status !== undefined) { updates.push(`status=$${i++}`); values.push(status); }
    if (notes  !== undefined) { updates.push(`notes=$${i++}`);  values.push(notes);  }
    updates.push(`updated_at=$${i++}`); values.push(now);
    values.push(req.params.id);

    const result = await pool.query(
      `UPDATE tickets SET ${updates.join(',')} WHERE id=$${i} RETURNING *`,
      values
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Ticket not found' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Start
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Project Pro server running → http://localhost:${PORT}`);
    console.log(`  Worker portal  → http://localhost:${PORT}/worker`);
    console.log(`  Manager portal → http://localhost:${PORT}/manager`);
  });
}).catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});
