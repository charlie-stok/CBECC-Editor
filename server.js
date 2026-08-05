'use strict';
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRES = '7d';
const MAX_FILE_CHARS = 20 * 1024 * 1024;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('DB schema ready');
}

// --- Email ---
const transporter = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

async function sendResetEmail(to, token) {
  const appUrl = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
  const link = `${appUrl}/reset-password.html?token=${token}`;
  if (!transporter) {
    console.log(`[DEV] Password reset link for ${to}:\n  ${link}`);
    return;
  }
  await transporter.sendMail({
    from: process.env.SMTP_FROM || 'CBECC Editor <noreply@stok.com>',
    to,
    subject: 'CBECC Editor — Password Reset',
    text: `Click the link below to reset your password. It expires in 1 hour.\n\n${link}`,
    html: `<p>Click the link below to reset your password. It expires in 1 hour.</p><p><a href="${link}">${link}</a></p>`,
  });
}

// --- Middleware ---
app.use(express.json({ limit: '25mb' }));
app.use(express.text({ limit: '25mb', type: 'text/plain' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// --- Auth middleware (checks disabled status on every request) ---
async function auth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const { rows } = await pool.query(
      'SELECT is_disabled, is_admin FROM users WHERE id=$1', [payload.id]
    );
    if (!rows.length || rows[0].is_disabled) {
      res.clearCookie('token');
      return res.status(401).json({ error: 'Account disabled or not found' });
    }
    req.user = { ...payload, isAdmin: rows[0].is_admin };
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      res.clearCookie('token');
      return res.status(401).json({ error: 'Session expired' });
    }
    next(err);
  }
}

function adminAuth(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  next();
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

// --- Health ---
app.get('/health', (req, res) => res.json({ ok: true }));

// --- Page routes ---
app.get('/', (req, res) => res.redirect('/projects.html'));
app.get('/editor', (req, res) => res.sendFile(path.join(__dirname, 'CIBD_editor.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// --- Auth API ---
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const { rows } = await pool.query(
      'SELECT id, email, password_hash, is_disabled, is_admin FROM users WHERE email=$1',
      [email.toLowerCase().trim()]
    );
    if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash)))
      return res.status(401).json({ error: 'Invalid email or password' });
    if (rows[0].is_disabled)
      return res.status(403).json({ error: 'Account is disabled. Contact your administrator.' });
    setAuthCookie(res, { id: rows[0].id, email: rows[0].email });
    res.json({ id: rows[0].id, email: rows[0].email, isAdmin: rows[0].is_admin });
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
  res.json({ id: req.user.id, email: req.user.email, isAdmin: req.user.isAdmin });
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email required' });
  // Always respond OK to avoid user enumeration
  res.json({ ok: true });
  try {
    const { rows } = await pool.query(
      'SELECT id FROM users WHERE email=$1 AND is_disabled=false', [email.toLowerCase().trim()]
    );
    if (!rows.length) return;
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await pool.query(
      'UPDATE users SET reset_token=$1, reset_token_expires=$2 WHERE id=$3',
      [token, expires, rows[0].id]
    );
    await sendResetEmail(email.toLowerCase().trim(), token);
  } catch (err) {
    console.error('Forgot password error:', err);
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password || password.length < 8)
    return res.status(400).json({ error: 'Valid token and password (min 8 chars) required' });
  try {
    const { rows } = await pool.query(
      'SELECT id FROM users WHERE reset_token=$1 AND reset_token_expires > NOW()',
      [token]
    );
    if (!rows.length) return res.status(400).json({ error: 'Reset link is invalid or has expired' });
    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      'UPDATE users SET password_hash=$1, reset_token=NULL, reset_token_expires=NULL WHERE id=$2',
      [hash, rows[0].id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

// --- Projects API ---
app.get('/api/projects', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, original_filename, created_at, updated_at, is_archived
       FROM projects WHERE user_id=$1 ORDER BY updated_at DESC`,
      [req.user.id]
    );
    res.json(rows.map(r => ({
      id: r.id, name: r.name, originalFilename: r.original_filename,
      createdAt: r.created_at, updatedAt: r.updated_at, isArchived: r.is_archived,
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
      `INSERT INTO projects(user_id, name, original_filename, file_content, original_content)
       VALUES($1,$2,$3,$4,$4) RETURNING id, name, original_filename, created_at, updated_at`,
      [req.user.id, name, originalFilename, content]
    );
    const r = rows[0];
    res.status(201).json({
      id: r.id, name: r.name, originalFilename: r.original_filename,
      createdAt: r.created_at, updatedAt: r.updated_at, isArchived: false,
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
    // Snapshot this save as a new version
    const { rows: vRows } = await pool.query(
      'SELECT COALESCE(MAX(version_num),0)+1 AS next FROM project_versions WHERE project_id=$1',
      [req.params.id]
    );
    await pool.query(
      'INSERT INTO project_versions(project_id, version_num, file_content) VALUES($1,$2,$3)',
      [req.params.id, vRows[0].next, content]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save file' });
  }
});

app.patch('/api/projects/:id', auth, async (req, res) => {
  const { name, isArchived } = req.body || {};
  try {
    const updates = [];
    const vals = [];
    let i = 1;
    if (name !== undefined) { updates.push(`name=$${i++}`); vals.push(name.trim()); }
    if (isArchived !== undefined) { updates.push(`is_archived=$${i++}`); vals.push(!!isArchived); }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(req.params.id, req.user.id);
    const { rowCount } = await pool.query(
      `UPDATE projects SET ${updates.join(', ')}, updated_at=NOW() WHERE id=$${i} AND user_id=$${i+1}`,
      vals
    );
    if (!rowCount) return res.status(404).json({ error: 'Project not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update project' });
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

// --- Project version history ---
app.get('/api/projects/:id/versions', auth, async (req, res) => {
  try {
    // Verify ownership
    const { rows: proj } = await pool.query(
      'SELECT id, original_filename, original_content FROM projects WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!proj.length) return res.status(404).json({ error: 'Project not found' });
    const { rows } = await pool.query(
      'SELECT id, version_num, saved_at FROM project_versions WHERE project_id=$1 ORDER BY version_num DESC',
      [req.params.id]
    );
    res.json({
      hasOriginal: !!proj[0].original_content,
      originalFilename: proj[0].original_filename,
      versions: rows.map(r => ({ id: r.id, versionNum: r.version_num, savedAt: r.saved_at })),
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to list versions' }); }
});

app.get('/api/projects/:id/versions/original/file', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT original_filename, original_content FROM projects WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!rows.length || !rows[0].original_content)
      return res.status(404).json({ error: 'Original not available' });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="original_${rows[0].original_filename}"`);
    res.send(rows[0].original_content);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to get original' }); }
});

app.get('/api/projects/:id/versions/:vid/file', auth, async (req, res) => {
  try {
    const { rows: proj } = await pool.query(
      'SELECT original_filename FROM projects WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!proj.length) return res.status(404).json({ error: 'Project not found' });
    const { rows } = await pool.query(
      'SELECT file_content, version_num FROM project_versions WHERE id=$1 AND project_id=$2',
      [req.params.vid, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Version not found' });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition',
      `attachment; filename="v${rows[0].version_num}_${proj[0].original_filename}"`);
    res.send(rows[0].file_content);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to get version' }); }
});

app.post('/api/projects/:id/restore/:vid', auth, async (req, res) => {
  try {
    const { rows: vRows } = await pool.query(
      `SELECT pv.file_content FROM project_versions pv
       JOIN projects p ON p.id = pv.project_id
       WHERE pv.id=$1 AND pv.project_id=$2 AND p.user_id=$3`,
      [req.params.vid, req.params.id, req.user.id]
    );
    if (!vRows.length) return res.status(404).json({ error: 'Version not found' });
    const content = vRows[0].file_content;
    await pool.query(
      'UPDATE projects SET file_content=$1, updated_at=NOW() WHERE id=$2',
      [content, req.params.id]
    );
    const { rows: nRows } = await pool.query(
      'SELECT COALESCE(MAX(version_num),0)+1 AS next FROM project_versions WHERE project_id=$1',
      [req.params.id]
    );
    await pool.query(
      'INSERT INTO project_versions(project_id, version_num, file_content) VALUES($1,$2,$3)',
      [req.params.id, nRows[0].next, content]
    );
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Restore failed' }); }
});

// --- Admin API ---

// Bootstrap: create first admin when no users exist (one-time use)
app.post('/api/admin/bootstrap', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password || password.length < 8)
    return res.status(400).json({ error: 'Email and password (min 8 chars) required' });
  try {
    const { rows: existing } = await pool.query('SELECT COUNT(*) AS n FROM users');
    if (parseInt(existing[0].n) > 0)
      return res.status(409).json({ error: 'Bootstrap only allowed on empty user table' });
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      'INSERT INTO users(email, password_hash, is_admin) VALUES($1,$2,true) RETURNING id, email',
      [email.toLowerCase().trim(), hash]
    );
    setAuthCookie(res, { id: rows[0].id, email: rows[0].email });
    res.status(201).json({ id: rows[0].id, email: rows[0].email, isAdmin: true });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    console.error(err);
    res.status(500).json({ error: 'Bootstrap failed' });
  }
});

app.get('/api/admin/users', auth, adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.is_admin, u.is_disabled, u.created_at,
              COUNT(p.id)::int AS project_count
       FROM users u
       LEFT JOIN projects p ON p.user_id = u.id
       GROUP BY u.id
       ORDER BY u.created_at ASC`
    );
    res.json(rows.map(r => ({
      id: r.id, email: r.email, isAdmin: r.is_admin, isDisabled: r.is_disabled,
      createdAt: r.created_at, projectCount: r.project_count,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

app.post('/api/admin/users', auth, adminAuth, async (req, res) => {
  const { email, password, isAdmin } = req.body || {};
  if (!email || !password || password.length < 8)
    return res.status(400).json({ error: 'Email and password (min 8 chars) required' });
  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      'INSERT INTO users(email, password_hash, is_admin) VALUES($1,$2,$3) RETURNING id, email, is_admin, is_disabled, created_at',
      [email.toLowerCase().trim(), hash, !!isAdmin]
    );
    const r = rows[0];
    res.status(201).json({
      id: r.id, email: r.email, isAdmin: r.is_admin,
      isDisabled: r.is_disabled, createdAt: r.created_at, projectCount: 0,
    });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    console.error(err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

app.patch('/api/admin/users/:id', auth, adminAuth, async (req, res) => {
  const { isAdmin, isDisabled, email } = req.body || {};
  if (parseInt(req.params.id) === req.user.id && isDisabled)
    return res.status(400).json({ error: 'Cannot disable your own account' });
  try {
    const updates = [];
    const vals = [];
    let i = 1;
    if (email !== undefined) { updates.push(`email=$${i++}`); vals.push(email.toLowerCase().trim()); }
    if (isAdmin !== undefined) { updates.push(`is_admin=$${i++}`); vals.push(!!isAdmin); }
    if (isDisabled !== undefined) { updates.push(`is_disabled=$${i++}`); vals.push(!!isDisabled); }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(req.params.id);
    const { rowCount } = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id=$${i}`, vals
    );
    if (!rowCount) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    console.error(err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

app.post('/api/admin/users/:id/reset-password', auth, adminAuth, async (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 8)
    return res.status(400).json({ error: 'Password (min 8 chars) required' });
  try {
    const hash = await bcrypt.hash(password, 12);
    const { rowCount } = await pool.query(
      'UPDATE users SET password_hash=$1, reset_token=NULL, reset_token_expires=NULL WHERE id=$2',
      [hash, req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

app.delete('/api/admin/users/:id', auth, adminAuth, async (req, res) => {
  if (parseInt(req.params.id) === req.user.id)
    return res.status(400).json({ error: 'Cannot delete your own account' });
  try {
    const { rowCount } = await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// --- Start ---
initDb()
  .then(() => app.listen(PORT, () => console.log(`CIBD server on port ${PORT}`)))
  .catch(err => { console.error('DB init failed:', err); process.exit(1); });
