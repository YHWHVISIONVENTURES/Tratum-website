const { Pool } = require('pg');

// No need to call dotenv here if it's called in app.js BEFORE this is required
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: String(process.env.DB_PASSWORD || ''),
  port: Number(process.env.DB_PORT || 5432),
});

// Just export it; don't run queries here
module.exports = pool;
