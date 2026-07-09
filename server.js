// server.js
import express from 'express';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';

const app = express();
app.use(bodyParser.json());

// CORS headers for Shopify App Proxy
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.solerevivalandredemption.com');
  res.setHeader('Content-Type', 'application/json');
  next();
});

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const API_VERSION = '2024-01';
const NAMESPACE = 'srr_qc';

// ---------- Shopify helpers ----------
async function shopifyRest(path, method = 'GET', body) {
  const url = `https://${SHOPIFY_STORE}/admin/api/${API_VERSION}/${path}.json`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

async function shopifyGraphQL(query, variables = {}) {
  const res = await fetch(`https://${SHOPIFY_STORE}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN
    },
    body: JSON.stringify({ query, variables })
  });
  return res.json();
}

async function writeMetafield(orderId, key, value, type = 'single_line_text_field') {
  const gid = `gid://shopify/Order/${orderId}`;
  const metafields = [{
    ownerId: gid,
    namespace: NAMESPACE,
    key,
    value: typeof value === 'object' ? JSON.stringify(value) : String(value),
    type
  }];

  const query = `
    mutation SetMetafield($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id key value }
        userErrors { field message }
      }
    }
  `;
  return shopifyGraphQL(query, { metafields });
}

async function getMetafield(orderId, key) {
  const res = await shopifyRest(`orders/${orderId}/metafields`);
  const mf = (res.metafields || []).find(m => m.namespace === NAMESPACE && m.key === key);
  return mf ? mf.value : null;
}

async function validateToken(orderId, token) {
  const stored = await getMetafield(orderId, 'token');
  return stored && stored === token;
}

function nowIso() {
  return new Date().toISOString();
}

// ---------- Endpoints ----------

// 1️⃣ GET /apps/srr-qc/order?id=ORDER_ID
app.get('/apps/srr-qc/order', async (req, res) => {
  try {
    const orderId = req.query.id;
    if (!orderId) return res.status(400).json({ error: 'Missing order id' });

    const order = await shopifyRest(`orders/${orderId}`);
    const metafieldsRes = await shopifyRest(`orders/${orderId}/metafields`);
    const qc = {};
    for (const mf of metafieldsRes.metafields || []) {
      if (mf.namespace === NAMESPACE) {
        try { qc[mf.key] = JSON.parse(mf.value); } catch { qc[mf.key] = mf.value; }
      }
    }

    res.json({ order: order.order, qc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2️⃣ POST /apps/srr-qc/approve
app.post('/apps/srr-qc/approve', async (req, res) => {
  try {
    const { order_id, token } = req.body;
    if (!order_id || !token) return res.status(400).json({ error: 'Missing fields' });
    if (!(await validateToken(order_id, token))) return res.status(401).json({ error: 'Invalid token' });

    const timestamp = nowIso();
    await writeMetafield(order_id, 'approved', 'true');
    await writeMetafield(order_id, 'approved_at', timestamp);
    await writeMetafield(order_id, 'timeline', [{ event: 'Customer approved QC photos', timestamp, staff: 'Customer' }], 'json');
    await writeMetafield(order_id, 'customer_update', { timestamp, action: 'approved', order_id }, 'json');

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3️⃣ POST /apps/srr-qc/message
app.post('/apps/srr-qc/message', async (req, res) => {
  try {
    const { order_id, token, text, photo_url } = req.body;
    if (!order_id || !token || !text) return res.status(400).json({ error: 'Missing fields' });
    if (!(await validateToken(order_id, token))) return res.status(401).json({ error: 'Invalid token' });

    const timestamp = nowIso();
    const currentNotesRaw = await getMetafield(order_id, 'notes_customer');
    let notes = [];
    try { notes = currentNotesRaw ? JSON.parse(currentNotesRaw) : []; } catch {}
    notes.push({ text, timestamp, sender: 'customer', type: 'message', photo_url: photo_url || null });

    await writeMetafield(order_id, 'notes_customer', notes, 'json');
    await writeMetafield(order_id, 'customer_update', { timestamp, action: 'message', order_id }, 'json');

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4️⃣ POST /apps/srr-qc/customer-photo
app.post('/apps/srr-qc/customer-photo', async (req, res) => {
  try {
    const { order_id, token, url, customerName, date } = req.body;
    if (!order_id || !token || !url || !customerName || !date) return res.status(400).json({ error: 'Missing fields' });
    if (!(await validateToken(order_id, token))) return res.status(401).json({ error: 'Invalid token' });

    const currentPhotosRaw = await getMetafield(order_id, 'customer_photos');
    let photos = [];
    try { photos = currentPhotosRaw ? JSON.parse(currentPhotosRaw) : []; } catch {}
    photos.push({ url, customerName, date, approved: false });

    await writeMetafield(order_id, 'customer_photos', photos, 'json');
    await writeMetafield(order_id, 'customer_update', { timestamp: nowIso(), action: 'kicks_pic', order_id }, 'json');

    res.json({ success: true });
  } catch (err) {
    res