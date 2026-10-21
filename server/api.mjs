// Local JSON "NoSQL" backend, mounted into the Vite dev/preview server.
//   GET    /api/db/:collection?township=<id>   list documents
//   POST   /api/db/:collection                  add a document (id assigned)
//   PATCH  /api/db/:collection/:id              merge fields into a document
//   DELETE /api/db/:collection/:id              remove a document
//   POST   /api/ai/prioritize                   rank problems with Claude (needs ANTHROPIC_API_KEY)
// Each collection is one file: data/db/<collection>.json (an array of documents).
// To move to Express/Mongo later, keep these routes and swap the read/write helpers.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { loadEnv } from 'vite';
import { prioritize } from './ai.mjs';

const DB_DIR = 'data/db';
const COLLECTIONS = new Set(['reports', 'carpools', 'helpRequests', 'helpers', 'observations', 'graphEdits']);
/** Time-to-live per collection, in hours, measured from createdAt. */
const TTL_HOURS = { helpRequests: 12 };

function file(col) {
  return `${DB_DIR}/${col}.json`;
}

function read(col) {
  try {
    return existsSync(file(col)) ? JSON.parse(readFileSync(file(col), 'utf8')) : [];
  } catch {
    return [];
  }
}

function write(col, docs) {
  mkdirSync(DB_DIR, { recursive: true });
  writeFileSync(file(col), JSON.stringify(docs, null, 2));
}

/** Drop expired documents (the JSON-file equivalent of a Mongo TTL index). */
function prune(col) {
  const ttl = TTL_HOURS[col];
  const docs = read(col);
  if (!ttl) return docs;
  const cutoff = Date.now() - ttl * 3_600_000;
  const kept = docs.filter((d) => (d.createdAt ?? Date.now()) > cutoff);
  if (kept.length !== docs.length) write(col, kept);
  return kept;
}

function body(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => {
      s += c;
      if (s.length > 2_000_000) reject(new Error('payload too large'));
    });
    req.on('end', () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

function send(res, code, data) {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(data));
}

async function handle(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean); // ['db', col, id?] or ['ai', 'prioritize']
  try {
    if (parts[0] === 'ai' && parts[1] === 'prioritize' && req.method === 'POST') {
      return send(res, 200, await prioritize(await body(req)));
    }
    if (parts[0] !== 'db' || !COLLECTIONS.has(parts[1])) return send(res, 404, { error: 'not found' });
    const col = parts[1];
    const id = parts[2];

    if (req.method === 'GET') {
      const t = url.searchParams.get('township');
      return send(res, 200, prune(col).filter((d) => !t || d.township === t));
    }
    if (req.method === 'POST') {
      const doc = await body(req);
      const full = { createdAt: Date.now(), ...doc, id: randomUUID().slice(0, 8) };
      write(col, [...prune(col), full]);
      return send(res, 201, full);
    }
    if (req.method === 'PATCH' && id) {
      const patch = await body(req);
      const docs = prune(col);
      const i = docs.findIndex((d) => d.id === id);
      if (i < 0) return send(res, 404, { error: 'no such document' });
      docs[i] = { ...docs[i], ...patch, id };
      write(col, docs);
      return send(res, 200, docs[i]);
    }
    if (req.method === 'DELETE' && id) {
      write(col, prune(col).filter((d) => d.id !== id));
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    return send(res, 500, { error: String(e?.message ?? e) });
  }
}

export default function jsonApi() {
  return {
    name: 'syagmap-json-api',
    config(_, { mode }) {
      // Make .env values (e.g. ANTHROPIC_API_KEY) visible to the server code only.
      const env = loadEnv(mode, process.cwd(), '');
      for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;
    },
    configureServer(server) {
      server.middlewares.use('/api', handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api', handle);
    },
  };
}
