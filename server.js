const express  = require('express');
const path     = require('path');
const { Pool } = require('pg');

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const ALERT_EMAIL    = process.env.ALERT_EMAIL    || '';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// Helper — finds HTML in /public first, then root
function sendHTML(res, filename) {
  const inPublic = path.join(__dirname, 'public', filename);
  const inRoot   = path.join(__dirname, filename);
  const fs = require('fs');
  if (fs.existsSync(inPublic)) return res.sendFile(inPublic);
  if (fs.existsSync(inRoot))   return res.sendFile(inRoot);
  res.status(404).send('Not found');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      counter INTEGER,
      worker_name TEXT,
      worker_number TEXT DEFAULT '',
      passport_number TEXT DEFAULT '',
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
      updated_at BIGINT,
      assigned_to TEXT DEFAULT '',
      in_progress_by TEXT DEFAULT '',
      in_progress_at BIGINT DEFAULT 0,
      resolved_by TEXT DEFAULT '',
      resolved_at BIGINT DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS counter (
      id INTEGER PRIMARY KEY DEFAULT 1,
      value INTEGER DEFAULT 0
    );
    INSERT INTO counter (id, value) VALUES (1, 0) ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS clothing_history (
      worker_number    TEXT PRIMARY KEY,
      uniform_issued_at BIGINT DEFAULT 0,
      shoes_issued_at   BIGINT DEFAULT 0
    );
  `);

  // Add new columns if upgrading from old schema
  const cols = [
    ['assigned_to',     "TEXT DEFAULT ''"],
    ['in_progress_by',  "TEXT DEFAULT ''"],
    ['in_progress_at',  'BIGINT DEFAULT 0'],
    ['resolved_by',     "TEXT DEFAULT ''"],
    ['resolved_at',     'BIGINT DEFAULT 0'],
    ['worker_number',    "TEXT DEFAULT ''"],
    ['passport_number',  "TEXT DEFAULT ''"],
    ['reminder_sent_at', 'BIGINT DEFAULT 0'],
  ];
  for (const [col, type] of cols) {
    await pool.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ${col} ${type}`).catch(()=>{});
  }
  // Migrate clothing_history to separate columns
  await pool.query(`ALTER TABLE clothing_history ADD COLUMN IF NOT EXISTS uniform_issued_at BIGINT DEFAULT 0`).catch(()=>{});
  await pool.query(`ALTER TABLE clothing_history ADD COLUMN IF NOT EXISTS shoes_issued_at   BIGINT DEFAULT 0`).catch(()=>{});
  // Migrate old last_issued_at → both columns if they're still 0
  await pool.query(`
    UPDATE clothing_history
    SET uniform_issued_at = last_issued_at, shoes_issued_at = last_issued_at
    WHERE last_issued_at > 0 AND uniform_issued_at = 0 AND shoes_issued_at = 0
  `).catch(()=>{});

  console.log('✅ Database ready');
}

app.get('/',        (req, res) => res.redirect('/worker'));
app.get('/worker',  (req, res) => sendHTML(res, 'worker.html'));
app.get('/manager', (req, res) => sendHTML(res, 'manager.html'));

// POST /api/tickets
app.post('/api/tickets', async (req, res) => {
  try {
    const now = Date.now();
    const ctr = await pool.query('UPDATE counter SET value = value + 1 WHERE id = 1 RETURNING value');
    const num = ctr.rows[0].value;
    const id = 'PP-' + String(num).padStart(3, '0');

    await pool.query(
      `INSERT INTO tickets
        (id, counter, worker_name, worker_number, passport_number, worker_phone,
         room, category, priority, description, media_base64, media_type,
         status, notes, created_at, updated_at,
         assigned_to, in_progress_by, in_progress_at, resolved_by, resolved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'new','',$13,$13,'',0,0,'',0)`,
      [id, num,
       req.body.workerName    || '',
       req.body.workerNumber  || '',
       req.body.passportNumber|| '',
       req.body.workerPhone   || '',
       req.body.room          || '',
       req.body.category      || '',
       req.body.priority      || 'regular',
       req.body.description   || '',
       req.body.mediaBase64   || '',
       req.body.mediaType     || '',
       now]
    );
    res.json({ success: true, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/import-clothing  (one-time import, protected by key)
app.post('/api/admin/import-clothing', async (req, res) => {
  if (req.headers['x-admin-key'] !== 'pp-import-2026') return res.status(403).json({ error: 'Forbidden' });
  try {
    const { rows } = req.body; // [{workerId, uniformTs, shoesTs}]
    if (!Array.isArray(rows)) return res.status(400).json({ error: 'Bad data' });
    let count = 0;
    for (const { workerId, uniformTs, shoesTs } of rows) {
      if (!workerId) continue;
      const uTs = Number(uniformTs) || 0;
      const sTs = Number(shoesTs)   || 0;
      if (!uTs && !sTs) continue;
      await pool.query(
        `INSERT INTO clothing_history (worker_number, uniform_issued_at, shoes_issued_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (worker_number) DO UPDATE SET
           uniform_issued_at = GREATEST(clothing_history.uniform_issued_at, $2),
           shoes_issued_at   = GREATEST(clothing_history.shoes_issued_at, $3)`,
        [String(workerId), uTs, sTs]
      );
      count++;
    }
    res.json({ success: true, imported: count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/clothing-check/:workerNumber
app.get('/api/clothing-check/:workerNumber', async (req, res) => {
  try {
    const SIX = 180 * 24 * 60 * 60 * 1000;
    const now  = Date.now();
    const result = await pool.query(
      'SELECT uniform_issued_at, shoes_issued_at FROM clothing_history WHERE worker_number = $1',
      [req.params.workerNumber]
    );
    if (!result.rows.length) return res.json({ uniformBlocked: false, shoesBlocked: false });
    const uTs = Number(result.rows[0].uniform_issued_at) || 0;
    const sTs = Number(result.rows[0].shoes_issued_at)   || 0;
    res.json({
      uniformBlocked:      uTs > 0 && (now - uTs) < SIX,
      uniformLastIssuedAt: uTs,
      shoesBlocked:        sTs > 0 && (now - sTs) < SIX,
      shoesLastIssuedAt:   sTs
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/clothing-history/:workerNumber  (manager override)
app.delete('/api/clothing-history/:workerNumber', async (req, res) => {
  try {
    await pool.query('DELETE FROM clothing_history WHERE worker_number = $1', [req.params.workerNumber]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/tickets
app.get('/api/tickets', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tickets ORDER BY created_at DESC');
    const tickets = result.rows.map(r => ({
      id:             r.id,
      workerName:     r.worker_name,
      workerNumber:   r.worker_number    || '',
      passportNumber: r.passport_number  || '',
      workerPhone:    r.worker_phone,
      room:           r.room,
      category:      r.category,
      priority:      r.priority,
      description:   r.description,
      mediaBase64:   r.media_base64,
      mediaType:     r.media_type,
      status:        r.status,
      notes:         r.notes,
      createdAt:     Number(r.created_at),
      updatedAt:     Number(r.updated_at),
      assignedTo:    r.assigned_to    || '',
      inProgressBy:  r.in_progress_by || '',
      inProgressAt:  Number(r.in_progress_at) || 0,
      resolvedBy:    r.resolved_by    || '',
      resolvedAt:    Number(r.resolved_at)    || 0
    }));
    res.json(tickets);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/tickets/:id
app.patch('/api/tickets/:id', async (req, res) => {
  try {
    const now = Date.now();
    const { status, notes, assignedTo, handledBy } = req.body;
    const updates = [];
    const values  = [];
    let i = 1;

    if (status !== undefined) {
      updates.push(`status=$${i++}`); values.push(status);
      if (status === 'in-progress' && handledBy) {
        updates.push(`in_progress_by=$${i++}`); values.push(handledBy);
        updates.push(`in_progress_at=$${i++}`); values.push(now);
      }
      if (status === 'resolved' && handledBy) {
        updates.push(`resolved_by=$${i++}`); values.push(handledBy);
        updates.push(`resolved_at=$${i++}`); values.push(now);
      }
    }
    if (notes !== undefined)      { updates.push(`notes=$${i++}`);       values.push(notes); }
    if (assignedTo !== undefined) { updates.push(`assigned_to=$${i++}`); values.push(assignedTo); }

    updates.push(`updated_at=$${i++}`); values.push(now);
    values.push(req.params.id);

    const result = await pool.query(
      `UPDATE tickets SET ${updates.join(',')} WHERE id=$${i} RETURNING *`,
      values
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Ticket not found' });

    // If resolved a clothing ticket → record issuance date per item type
    const ticket = result.rows[0];
    if (status === 'resolved' && ticket.category && ticket.category.toLowerCase().includes('clothing') && ticket.worker_number) {
      const desc = (ticket.description || '').toLowerCase();
      const hasUniform = desc.includes('pants') || desc.includes('shirt');
      const hasShoes   = desc.includes('shoes');
      // If nothing detected, assume both
      const doUniform  = hasUniform || (!hasUniform && !hasShoes);
      const doShoes    = hasShoes   || (!hasUniform && !hasShoes);
      const setClauses = [];
      if (doUniform) setClauses.push(`uniform_issued_at = ${now}`);
      if (doShoes)   setClauses.push(`shoes_issued_at = ${now}`);
      await pool.query(
        `INSERT INTO clothing_history (worker_number, uniform_issued_at, shoes_issued_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (worker_number) DO UPDATE SET ${setClauses.join(', ')}`,
        [ticket.worker_number, doUniform ? now : 0, doShoes ? now : 0]
      ).catch(() => {});
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Email alert for stale in-progress tickets ─────────
async function sendStaleAlerts() {
  if (!RESEND_API_KEY || !ALERT_EMAIL) return;
  try {
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    const cutoff     = Date.now() - SEVEN_DAYS;
    const result     = await pool.query(
      `SELECT * FROM tickets
       WHERE status = 'in-progress'
         AND updated_at < $1
         AND (reminder_sent_at = 0 OR reminder_sent_at < $1)
       ORDER BY updated_at ASC`,
      [cutoff]
    );
    if (!result.rows.length) return;

    const rows = result.rows.map(t => {
      const days = Math.floor((Date.now() - Number(t.updated_at)) / 86400000);
      return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:700">${t.id}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee">${t.worker_name || '—'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee">${t.category || '—'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee">${t.room || '—'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#ef4444;font-weight:700">${days} days</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#888">${t.in_progress_by || '—'}</td>
        </tr>`;
    }).join('');

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto">
        <div style="background:#16213e;padding:20px 24px;border-radius:10px 10px 0 0">
          <h1 style="color:#fff;margin:0;font-size:1.2rem">⚠️ Project Pro — Stale Tickets Alert</h1>
          <p style="color:#aab;margin:6px 0 0;font-size:.85rem">The following requests have been In Progress for over 7 days</p>
        </div>
        <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;padding:20px">
          <table style="width:100%;border-collapse:collapse;font-size:.88rem">
            <thead>
              <tr style="background:#f0f2f5">
                <th style="padding:8px 12px;text-align:left">ID</th>
                <th style="padding:8px 12px;text-align:left">Worker</th>
                <th style="padding:8px 12px;text-align:left">Category</th>
                <th style="padding:8px 12px;text-align:left">Location</th>
                <th style="padding:8px 12px;text-align:left">Waiting</th>
                <th style="padding:8px 12px;text-align:left">Handled by</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <p style="margin-top:20px;font-size:.82rem;color:#888">
            This alert is sent automatically when a ticket stays In Progress for more than 7 days without an update.
          </p>
        </div>
      </div>`;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({
        from:    'Project Pro <onboarding@resend.dev>',
        to:      [ALERT_EMAIL],
        subject: `⚠️ ${result.rows.length} ticket(s) stuck In Progress for 7+ days`,
        html
      })
    });

    // Mark reminders as sent
    const ids = result.rows.map(t => t.id);
    await pool.query(
      `UPDATE tickets SET reminder_sent_at = $1 WHERE id = ANY($2::text[])`,
      [Date.now(), ids]
    );
    console.log(`✅ Sent stale alert for ${ids.length} ticket(s)`);
  } catch (err) {
    console.error('sendStaleAlerts error:', err);
  }
}

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Project Pro → http://localhost:${PORT}`);
  });
  // Check for stale tickets every hour
  setInterval(sendStaleAlerts, 60 * 60 * 1000);
  // Also run once 2 minutes after startup
  setTimeout(sendStaleAlerts, 2 * 60 * 1000);
}).catch(err => { console.error('DB init failed:', err); process.exit(1); });
