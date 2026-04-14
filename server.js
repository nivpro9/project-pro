const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const TICKETS_FILE = path.join(__dirname, 'tickets.json');

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// Load tickets from disk
function loadTickets() {
  try {
    const raw = fs.readFileSync(TICKETS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { counter: 0, tickets: {} };
  }
}

// Save tickets to disk
function saveTickets(data) {
  fs.writeFileSync(TICKETS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Routes
app.get('/', (req, res) => res.redirect('/worker'));
app.get('/worker', (req, res) => res.sendFile(path.join(__dirname, 'worker.html')));
app.get('/manager', (req, res) => res.sendFile(path.join(__dirname, 'manager.html')));

// POST /api/tickets — create new ticket
app.post('/api/tickets', (req, res) => {
  const data = loadTickets();
  data.counter += 1;
  const id = 'PP-' + String(data.counter).padStart(3, '0');
  const now = Date.now();

  const ticket = {
    id,
    workerName: req.body.workerName || '',
    workerPhone: req.body.workerPhone || '',
    room: req.body.room || '',
    category: req.body.category || '',
    priority: req.body.priority || 'regular',
    description: req.body.description || '',
    mediaBase64: req.body.mediaBase64 || '',
    mediaType: req.body.mediaType || '',
    status: 'new',
    notes: '',
    createdAt: now,
    updatedAt: now
  };

  data.tickets[id] = ticket;
  saveTickets(data);
  res.json({ success: true, id });
});

// GET /api/tickets — return all tickets, newest first
app.get('/api/tickets', (req, res) => {
  const data = loadTickets();
  const list = Object.values(data.tickets).sort((a, b) => b.createdAt - a.createdAt);
  res.json(list);
});

// PATCH /api/tickets/:id — update status and/or notes
app.patch('/api/tickets/:id', (req, res) => {
  const data = loadTickets();
  const ticket = data.tickets[req.params.id];
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

  if (req.body.status !== undefined) ticket.status = req.body.status;
  if (req.body.notes !== undefined) ticket.notes = req.body.notes;
  ticket.updatedAt = Date.now();

  saveTickets(data);
  res.json({ success: true, ticket });
});

app.listen(PORT, () => {
  console.log(`Project Pro server running → http://localhost:${PORT}`);
  console.log(`  Worker portal  → http://localhost:${PORT}/worker`);
  console.log(`  Manager portal → http://localhost:${PORT}/manager`);
});
