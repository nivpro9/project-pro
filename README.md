[README.md](https://github.com/user-attachments/files/26706413/README.md)
# 🏗️ Project Pro — Worker Request Portal

A mobile-first web application for construction site management. Workers can submit requests from any phone, and the logistics manager can track and manage them in real time.

---

## 🔗 Live URLs

| Portal | URL |
|--------|-----|
| Worker Portal | `https://project-pro-production.up.railway.app/worker` |
| Manager Dashboard | `https://project-pro-production.up.railway.app/manager` |

> **Manager PIN:** `1234`

---

## 📱 Features

### Worker Portal
- Submit requests from any phone (iOS / Android)
- 3 main categories:
  - 👕 **Clothing** — select Pants / Shirt / Shoes with sizes
  - 🏠 **Apartment Issues** — Water / Gas / Electricity
  - 🏥 **Medical** — Feeling Sick / Hospital Evacuation / Medication Request
- Priority selection: 🔴 Urgent / 🟢 Regular
- Attach photo or video (up to 10MB)
- Instant ticket confirmation with ID (PP-001, PP-002…)

### Manager Dashboard
- PIN-protected login
- Live stats: New / In Progress / Resolved
- Filter tickets by status or priority
- View full ticket details in modal
- Update ticket status (New → In Progress → Resolved)
- Add manager notes
- Auto-refresh every 5 seconds with sound notification
- 📊 **Export to Excel** with date range filter

---

## 🗂️ File Structure

```
project-pro/
├── server.js          # Express server + REST API
├── package.json
├── tickets.json       # Data storage (JSON file)
└── public/
    ├── worker.html    # Worker portal
    └── manager.html   # Manager dashboard
```

---

## 🚀 Run Locally

```bash
npm install
node server.js
```

Then open:
- http://localhost:3000/worker
- http://localhost:3000/manager

---

## 🛠️ Tech Stack

- **Backend:** Node.js + Express
- **Frontend:** Vanilla HTML/CSS/JS (no frameworks)
- **Database:** tickets.json (flat file)
- **Hosting:** Railway (24/7)
- **Repo:** GitHub (auto-deploy on push)

---

## 🔄 How to Update

1. Edit any file on **github.com/nivpro9/project-pro**
2. Click **Commit changes**
3. Railway auto-deploys within ~1 minute

---

## 📋 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/tickets` | Create new ticket |
| `GET` | `/api/tickets` | Get all tickets (newest first) |
| `PATCH` | `/api/tickets/:id` | Update status / notes |

---

*Built with ❤️ for Project Pro Group — Since 2013*
