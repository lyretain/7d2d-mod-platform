import net from 'node:net';
import tls from 'node:tls';
import { createHash, createHmac, randomBytes, pbkdf2Sync } from 'node:crypto';

function readCString(buffer, offset) {
  const end = buffer.indexOf(0, offset);
  return { value: buffer.subarray(offset, end).toString('utf8'), offset: end + 1 };
}

function md5Password(user, password, salt) {
  const inner = createHash('md5').update(password + user).digest('hex');
  return `md5${createHash('md5').update(Buffer.concat([Buffer.from(inner, 'utf8'), salt])).digest('hex')}`;
}

function saslPrep(value) {
  return String(value).replaceAll('=', '=3D').replaceAll(',', '=2C');
}

function scramProof(password, clientFirstBare, serverFirst, clientFinalBare) {
  const parts = Object.fromEntries(serverFirst.split(',').map((item) => [item[0], item.slice(2)]));
  const salt = Buffer.from(parts.s, 'base64');
  const iterations = Number(parts.i);
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const stored = createHash('sha256').update(clientKey).digest();
  const authMessage = `${clientFirstBare},${serverFirst},${clientFinalBare}`;
  const signature = createHmac('sha256', stored).update(authMessage).digest();
  const proof = Buffer.from(clientKey.map((byte, index) => byte ^ signature[index]));
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  const serverSignature = createHmac('sha256', serverKey).update(authMessage).digest();
  return { proof: proof.toString('base64'), serverSignature: serverSignature.toString('base64') };
}

export function parseDatabaseUrl(url) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 5432),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    ssl: parsed.searchParams.get('sslmode') === 'require' || parsed.searchParams.get('ssl') === 'true'
  };
}

class PgConnection {
  constructor(options) {
    this.options = options;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.queue = [];
  }

  async connect() {
    this.socket = this.options.ssl
      ? tls.connect({ host: this.options.host, port: this.options.port, servername: this.options.host })
      : net.connect({ host: this.options.host, port: this.options.port });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('PostgreSQL connection timed out')), 10_000);
      this.socket.once('connect', () => { clearTimeout(timer); resolve(); });
      this.socket.once('error', (error) => { clearTimeout(timer); reject(error); });
    });
    this.socket.on('data', (chunk) => this.onData(chunk));
    this.socket.on('error', (error) => this.fail(error));
    this.socket.on('close', () => this.fail(new Error('PostgreSQL connection closed')));
    await this.startup();
  }

  send(code, payload = Buffer.alloc(0)) {
    const header = Buffer.alloc(5);
    header.writeUInt8(code.charCodeAt(0), 0);
    header.writeInt32BE(payload.length + 4, 1);
    this.socket.write(Buffer.concat([header, payload]));
  }

  sendStartup() {
    const parts = ['user', this.options.user, 'database', this.options.database, 'client_encoding', 'UTF8'];
    const body = Buffer.concat([...parts.map((part) => Buffer.from(`${part}\0`)), Buffer.from([0])]);
    const message = Buffer.alloc(8 + body.length);
    message.writeInt32BE(message.length, 0);
    message.writeInt32BE(196608, 4);
    body.copy(message, 8);
    this.socket.write(message);
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 5) {
      const length = this.buffer.readInt32BE(1);
      if (this.buffer.length < length + 1) return;
      const code = String.fromCharCode(this.buffer[0]);
      const payload = this.buffer.subarray(5, length + 1);
      this.buffer = this.buffer.subarray(length + 1);
      this.dispatch(code, payload);
    }
  }

  dispatch(code, payload) {
    if (this.authHandler && (code === 'R' || code === 'E')) return this.authHandler({ code, payload });
    if (code === 'Z') this.ready = true;
    if (!this.queue[0]) {
      if (code === 'E' && this.authReject) this.authReject(pgError(payload));
      return;
    }
    this.queue[0].messages.push({ code, payload });
    if (code === 'Z' || code === 'E') {
      const job = this.queue.shift();
      if (code === 'E') job.reject(pgError(payload));
      else job.resolve(job.messages);
    }
  }

  fail(error) {
    if (this.authReject) this.authReject(error);
    for (const job of this.queue) job.reject(error);
    this.queue = [];
  }

  waitReady() {
    return new Promise((resolve, reject) => this.queue.push({ messages: [], resolve, reject }));
  }

  async startup() {
    const nonce = randomBytes(18).toString('base64url');
    const clientFirstBare = `n=,r=${nonce}`;
    const finishAuth = () => {
      if (!this.authHandler) return;
      this.authHandler = null;
      this.authResolve();
    };
    this.authHandler = ({ code, payload }) => {
      if (code === 'E') {
        this.authHandler = null;
        this.authReject(pgError(payload));
        return;
      }
      const type = payload.readInt32BE(0);
      if (type === 0) {
        finishAuth();
      } else if (type === 3) {
        this.send('p', Buffer.from(`${this.options.password}\0`));
      } else if (type === 5) {
        this.send('p', Buffer.from(`${md5Password(this.options.user, this.options.password, payload.subarray(4, 8))}\0`));
      } else if (type === 10) {
        const initial = Buffer.concat([
          Buffer.from('SCRAM-SHA-256\0'),
          Buffer.alloc(4),
          Buffer.from(`n,,${clientFirstBare}`)
        ]);
        initial.writeInt32BE(Buffer.byteLength(`n,,${clientFirstBare}`), Buffer.byteLength('SCRAM-SHA-256\0'));
        this.send('p', initial);
        this.scram = { clientFirstBare };
      } else if (type === 11) {
        const serverFirst = payload.subarray(4).toString('utf8');
        const clientFinalBare = `c=biws,r=${serverFirst.split(',')[0].slice(2)}`;
        const proof = scramProof(this.options.password, this.scram.clientFirstBare, serverFirst, clientFinalBare);
        this.scram.expected = proof.serverSignature;
        this.send('p', Buffer.from(`${clientFinalBare},p=${proof.proof}`));
      } else if (type === 12) {
        const verifier = payload.subarray(4).toString('utf8');
        if (!verifier.includes(this.scram.expected)) {
          this.authHandler = null;
          this.authReject(new Error('SCRAM server signature mismatch'));
          return;
        }
        finishAuth();
      }
    };
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('PostgreSQL authentication timed out')), 10_000);
      this.authResolve = () => { clearTimeout(timer); resolve(); };
      this.authReject = (error) => { clearTimeout(timer); reject(error); };
      this.sendStartup();
    });
    if (!this.ready) await this.waitReady();
  }

  async query(sql, params = []) {
    const text = params.length ? substitute(sql, params) : sql;
    this.send('Q', Buffer.from(`${text}\0`));
    const messages = await this.waitReady();
    const rows = [];
    let fields = [];
    for (const message of messages) {
      if (message.code === 'T') fields = parseFields(message.payload);
      if (message.code === 'D') rows.push(parseRow(fields, message.payload));
    }
    return { rows };
  }

  end() {
    try { this.send('X'); } catch { /* ignore */ }
    this.socket.destroy();
  }
}

function substitute(sql, params) {
  return sql.replace(/\$(\d+)/g, (_, index) => {
    const value = params[Number(index) - 1];
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    return `'${String(value).replaceAll("'", "''")}'`;
  });
}

function parseFields(payload) {
  const count = payload.readInt16BE(0);
  const fields = [];
  let offset = 2;
  for (let index = 0; index < count; index += 1) {
    const name = readCString(payload, offset);
    offset = name.offset + 18;
    fields.push(name.value);
  }
  return fields;
}

function parseRow(fields, payload) {
  const count = payload.readInt16BE(0);
  const row = {};
  let offset = 2;
  for (let index = 0; index < count; index += 1) {
    const length = payload.readInt32BE(offset);
    offset += 4;
    row[fields[index]] = length < 0 ? null : payload.subarray(offset, offset + length).toString('utf8');
    if (length > 0) offset += length;
  }
  return row;
}

function pgError(payload) {
  const parts = {};
  let offset = 0;
  while (offset < payload.length && payload[offset]) {
    const field = String.fromCharCode(payload[offset]);
    const read = readCString(payload, offset + 1);
    parts[field] = read.value;
    offset = read.offset;
  }
  return Object.assign(new Error(parts.M || 'PostgreSQL error'), { code: parts.C });
}

export class PgPool {
  constructor(url, { max = 4 } = {}) {
    this.options = parseDatabaseUrl(url);
    this.max = max;
    this.idle = [];
    this.size = 0;
  }

  async acquire() {
    if (this.idle.length) return this.idle.pop();
    if (this.size >= this.max) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return this.acquire();
    }
    this.size += 1;
    const connection = new PgConnection(this.options);
    await connection.connect();
    return connection;
  }

  async query(sql, params) {
    const connection = await this.acquire();
    try {
      return await connection.query(sql, params);
    } finally {
      this.idle.push(connection);
    }
  }

  async transaction(fn) {
    const connection = await this.acquire();
    try {
      await connection.query('BEGIN');
      const result = await fn(connection);
      await connection.query('COMMIT');
      return result;
    } catch (error) {
      try { await connection.query('ROLLBACK'); } catch { /* ignore */ }
      throw error;
    } finally {
      this.idle.push(connection);
    }
  }

  async end() {
    for (const connection of this.idle) connection.end();
    this.idle = [];
  }
}
