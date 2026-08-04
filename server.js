'use strict';
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRES = '7d';
const MAX_FILE_CHARS = 20 * 1024 * 1024; // ~20 MB of text

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('DB schema ready');
}

// --- Middleware ---
app.use(express.json({ limit: '25mb' }));
app.use(express.text({ limit: '25mb', type: 'text/plain' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// --- Auth middleware ---
function auth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.clearCookie('token');
    res.status(401).json({ error: 'Session expired' });
  }
}

function setAuthCookie(res, payload) {
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

// --- Page routes ---
app.get('/', (req, res) => res.redirect('/projects.html'));
app.get('/editor', (req, res) => res.sendFile(path.join(__dirname, 'CIBD_editor.html')));

// --- Auth API ---
app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password || password.length < 8)
    return res.status(400).json({ error: 'Email and password (min 8 chars) required' });
  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      'INSERT INTO users(email, password_hash) VALUES($1,$2) RETURNING id, email',
      [email.toLowerCase().trim(), hash]
    );
    setAuthCookie(res, { id: rows[0].id, email: rows[0].email });
    res.status(201).json({ id: rows[0].id, email: rows[0].email });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const { rows } = await pool.query(
      'SELECT id, email, password_hash FROM users WHERE email=$1',
      [email.toLowerCase().trim()]
    );
    if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash)))
      return res.status(401).json({ error: 'Invalid email or password' });
    setAuthCookie(res, { id: rows[0].id, email: rows[0].email });
    res.json({ id: rows[0].id, email: rows[0].email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/auth/me', auth, (req, res) => {
  res.json({ id: req.user.id, email: req.user.email });
});

// --- Projects API ---
app.get('/api/projects', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, original_filename, created_at, updated_at
       FROM projects WHERE user_id=$1 ORDER BY updated_at DESC`,
      [req.user.id]
    );
    res.json(rows.map(r => ({
      id: r.id,
      name: r.name,
      originalFilename: r.original_filename,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

app.post('/api/projects', auth, async (req, res) => {
  const { name, originalFilename, content } = req.body || {};
  if (!name || !originalFilename || !content)
    return res.status(400).json({ error: 'name, originalFilename, and content are required' });
  if (content.length > MAX_FILE_CHARS)
    return res.status(413).json({ error: 'File too large (max 20 MB)' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO projects(user_id, name, original_filename, file_content)
       VALUES($1,$2,$3,$4) RETURNING id, name, original_filename, created_at, updated_at`,
      [req.user.id, name, originalFilename, content]
    );
    const r = rows[0];
    res.status(201).json({
      id: r.id, name: r.name, originalFilename: r.original_filename,
      createdAt: r.created_at, updatedAt: r.updated_at,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

app.get('/api/projects/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, original_filename, created_at, updated_at
       FROM projects WHERE id=$1 AND user_id=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Project not found' });
    const r = rows[0];
    res.json({ id: r.id, name: r.name, originalFilename: r.original_filename,
               createdAt: r.created_at, updatedAt: r.updated_at });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to get project' });
  }
});

app.get('/api/projects/:id/file', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT original_filename, file_content FROM projects WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Project not found' });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${rows[0].original_filename}"`);
    res.send(rows[0].file_content);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to get file' });
  }
});

app.put('/api/projects/:id/file', auth, async (req, res) => {
  const content = req.body;
  if (!content || typeof content !== 'string')
    return res.status(400).json({ error: 'File content required (text/plain body)' });
  if (content.length > MAX_FILE_CHARS)
    return res.status(413).json({ error: 'File too large (max 20 MB)' });
  try {
    const { rowCount } = await pool.query(
      'UPDATE projects SET file_content=$1, updated_at=NOW() WHERE id=$2 AND user_id=$3',
      [content, req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Project not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save file' });
  }
});

app.patch('/api/projects/:id', auth, async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  try {
    const { rowCount } = await pool.query(
      'UPDATE projects SET name=$1, updated_at=NOW() WHERE id=$2 AND user_id=$3',
      [name.trim(), req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Project not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to rename project' });
  }
});

app.delete('/api/projects/:id', auth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM projects WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Project not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

// --- Start ---
initDb()
  .then(() => app.listen(PORT, () => console.log(`CIBD server on port ${PORT}`)))
  .catch(err => { console.error('DB init failed:', err); process.exit(1); });
