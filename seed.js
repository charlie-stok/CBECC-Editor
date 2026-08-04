#!/usr/bin/env node
// Seed the first admin account.
// Usage: node seed.js <email> <password>
// Requires DATABASE_URL to be set (or a .env file).

'use strict';
require('dotenv').config({ path: '.env' });
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const [,, email, password] = process.argv;
if (!email || !password) {
  console.error('Usage: node seed.js <email> <password>');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false } : false,
});

(async () => {
  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO users(email, password_hash, is_admin)
       VALUES($1, $2, true)
       ON CONFLICT (email) DO UPDATE SET password_hash=$2, is_admin=true
       RETURNING id, email`,
      [email.toLowerCase().trim(), hash]
    );
    console.log(`Admin account ready: ${rows[0].email} (id=${rows[0].id})`);
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
