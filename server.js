require('dotenv').config();

const crypto = require('node:crypto');
const path = require('node:path');
const { promisify } = require('node:util');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

const app = express();
const scrypt = promisify(crypto.scrypt);
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const jwtSecret = process.env.JWT_SECRET;
const allowedOrigins = (process.env.FRONTEND_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const apiOrigin = process.env.API_ORIGIN;

if (!process.env.DATABASE_URL) {
  throw new Error('Configure DATABASE_URL no arquivo .env antes de iniciar o servidor.');
}
if (!jwtSecret || Buffer.byteLength(jwtSecret) < 32) {
  throw new Error('Configure JWT_SECRET no .env com pelo menos 32 bytes aleatórios.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
});

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", ...(apiOrigin ? [apiOrigin] : [])],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
}));
app.use(express.json({ limit: '20kb' }));

app.use((req, res, next) => {
  const origin = req.get('origin');
  if (!origin || allowedOrigins.length === 0) return next();
  if (!allowedOrigins.includes(origin)) {
    return res.status(403).json({ error: 'Origem não autorizada.' });
  }
  res.set('Access-Control-Allow-Origin', origin);
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function validateCredentials(userId, password) {
  return typeof userId === 'string'
    && /^[a-z0-9._-]{3,30}$/.test(userId)
    && typeof password === 'string'
    && password.length >= 8
    && password.length <= 128;
}

function hashPassword(password, salt) {
  return scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }).then(hash => hash.toString('hex'));
}

function createToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: String(user.id),
    iat: now,
    exp: now + 60 * 60 * 12,
  })).toString('base64url');
  const content = `${header}.${payload}`;
  const signature = crypto.createHmac('sha256', jwtSecret).update(content).digest('base64url');
  return `${content}.${signature}`;
}

function verifyToken(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const content = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac('sha256', jwtSecret).update(content).digest();
  let actual;
  try {
    actual = Buffer.from(parts[2], 'base64url');
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (typeof payload.sub !== 'string' || !/^\d+$/.test(payload.sub) || payload.exp <= Date.now() / 1000) {
      return null;
    }
    return payload.sub;
  } catch {
    return null;
  }
}

const authenticate = asyncRoute(async (req, res, next) => {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer ([^\s]+)$/);
  const userId = match ? verifyToken(match[1]) : null;
  if (!userId) return res.status(401).json({ error: 'Sessão inválida ou expirada. Entre novamente.' });

  const result = await pool.query(
    'SELECT id, user_id, full_name FROM users WHERE id = $1',
    [userId],
  );
  if (result.rowCount === 0) return res.status(401).json({ error: 'Conta não encontrada. Entre novamente.' });
  req.user = result.rows[0];
  return next();
});

function publicUser(user) {
  return { id: user.user_id, name: user.full_name };
}

function publicRecord(record) {
  return {
    id: record.id,
    type: record.record_type === 'saida' ? 'saída' : 'entrada',
    timestamp: new Date(record.recorded_at).toISOString(),
  };
}

async function getRecords(userId) {
  const result = await pool.query(
    `SELECT id, record_type, recorded_at
     FROM time_records
     WHERE user_id = $1
     ORDER BY recorded_at DESC, id DESC`,
    [userId],
  );
  return result.rows.map(publicRecord);
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
});

app.post('/api/register', authLimiter, asyncRoute(async (req, res) => {
  const { name, userId, password } = req.body || {};
  const normalizedId = typeof userId === 'string' ? userId.trim().toLowerCase() : '';
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  if (!validateCredentials(normalizedId, password) || !normalizedName || normalizedName.length > 120) {
    return res.status(400).json({ error: 'Informe nome, ID válido e senha com pelo menos 8 caracteres.' });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = `scrypt$${salt}$${await hashPassword(password, salt)}`;
  try {
    const result = await pool.query(
      `INSERT INTO users (user_id, full_name, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, user_id, full_name`,
      [normalizedId, normalizedName, passwordHash],
    );
    const user = result.rows[0];
    return res.status(201).json({ token: createToken(user), user: publicUser(user), records: [] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Este ID já está em uso. Escolha outro.' });
    throw error;
  }
}));

app.post('/api/login', authLimiter, asyncRoute(async (req, res) => {
  const { userId, password } = req.body || {};
  const normalizedId = typeof userId === 'string' ? userId.trim().toLowerCase() : '';
  if (!validateCredentials(normalizedId, password)) {
    return res.status(400).json({ error: 'Informe um ID válido e uma senha com pelo menos 8 caracteres.' });
  }

  const result = await pool.query(
    'SELECT id, user_id, full_name, password_hash FROM users WHERE user_id = $1',
    [normalizedId],
  );
  const user = result.rows[0];
  let passwordMatches = false;
  if (user && typeof user.password_hash === 'string') {
    const [algorithm, salt, storedHash] = user.password_hash.split('$');
    if (algorithm === 'scrypt' && salt && /^[a-f0-9]{128}$/.test(storedHash || '')) {
      const submittedHash = await hashPassword(password, salt);
      passwordMatches = crypto.timingSafeEqual(Buffer.from(submittedHash, 'hex'), Buffer.from(storedHash, 'hex'));
    }
  }
  if (!passwordMatches) return res.status(401).json({ error: 'ID de usuário ou senha incorretos.' });

  return res.json({
    token: createToken(user),
    user: publicUser(user),
    records: await getRecords(user.id),
  });
}));

app.get('/api/me', authenticate, asyncRoute(async (req, res) => {
  res.json({ user: publicUser(req.user), records: await getRecords(req.user.id) });
}));

app.get('/api/records', authenticate, asyncRoute(async (req, res) => {
  res.json({ records: await getRecords(req.user.id) });
}));

app.post('/api/records', authenticate, asyncRoute(async (req, res) => {
  const requestedType = req.body?.type;
  if (requestedType !== 'entrada' && requestedType !== 'saída') {
    return res.status(400).json({ error: 'Tipo de registro inválido.' });
  }
  const recordType = requestedType === 'saída' ? 'saida' : 'entrada';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
    const lastResult = await client.query(
      `SELECT record_type
       FROM time_records
       WHERE user_id = $1
         AND recorded_at >= (((NOW() AT TIME ZONE 'America/Sao_Paulo')::date)::timestamp AT TIME ZONE 'America/Sao_Paulo')
         AND recorded_at < ((((NOW() AT TIME ZONE 'America/Sao_Paulo')::date + 1)::timestamp) AT TIME ZONE 'America/Sao_Paulo')
       ORDER BY recorded_at DESC, id DESC
       LIMIT 1`,
      [req.user.id],
    );
    const lastType = lastResult.rows[0]?.record_type;
    if (recordType === 'entrada' && lastType === 'entrada') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Registre sua saída antes de iniciar uma nova jornada.' });
    }
    if (recordType === 'saida' && lastType !== 'entrada') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Registre uma entrada antes de registrar a saída.' });
    }
    const result = await client.query(
      `INSERT INTO time_records (user_id, record_type)
       VALUES ($1, $2)
       RETURNING id, record_type, recorded_at`,
      [req.user.id, recordType],
    );
    await client.query('COMMIT');
    return res.status(201).json({ record: publicRecord(result.rows[0]) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}));

app.get('/api/health', asyncRoute(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok' });
}));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/app.js', (req, res) => res.sendFile(path.join(__dirname, 'app.js')));
app.get('/config.js', (req, res) => res.sendFile(path.join(__dirname, 'config.js')));
app.get('/styles.css', (req, res) => res.sendFile(path.join(__dirname, 'styles.css')));
app.use((req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'O corpo da requisição contém JSON inválido.' });
  }
  console.error('Falha na API:', error.message);
  return res.status(500).json({ error: 'Erro interno do servidor. Tente novamente mais tarde.' });
});

const server = app.listen(port, host, () => {
  console.log(`Ponto Digital disponível em http://${host}:${port}.`);
});

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
