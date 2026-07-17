import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const SHOP = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const PORT = process.env.PORT || 3000;

// CORS for storefront
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "https://www.solerevivalandredemption.com");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

async function getOrderMetafields(orderId) {
  const response = await fetch(
    `https://${SHOP}/admin/api/2024-01/orders/${orderId}/metafields.json`,
    { headers: { "X-Shopify-Access-Token": TOKEN } }
  );
  const data = await response.json();
  const qc = {};
  (data.metafields || []).forEach(m => {
    if (m.namespace === "srr_qc") qc[m.key] = m.value;
  });
  return qc;
}

async function getOrder(orderId) {
  const response = await fetch(
    `https://${SHOP}/admin/api/2024-01/orders/${orderId}.json`,
    { headers: { "X-Shopify-Access-Token": TOKEN } }
  );
  const data = await response.json();
  return data.order;
}

async function updateMetafield(orderId, key, value) {
  await fetch(`https://${SHOP}/admin/api/2024-01/orders/${orderId}/metafields.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": TOKEN,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      metafield: {
        namespace: "srr_qc",
        key,
        value: String(value),
        type: "single_line_text_field"
      }
    })
  });
}

// GET /order?id=ORDER_ID&token=TOKEN
app.get("/order", async (req, res) => {
  const { id, token } = req.query;
  if (!id || !token) return res.status(400).json({ error: "Missing id or token" });

  try {
    const [order, qc] = await Promise.all([getOrder(id), getOrderMetafields(id)]);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (qc.token !== token) return res.status(401).json({ error: "Invalid token" });

    res.json({
      order: {
        id: order.id,
        name: order.name,
        created_at: order.created_at,
        line_items: order.line_items
      },
      qc
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /approve
app.post("/approve", async (req, res) => {
  const { order_id, token } = req.body;
  const qc = await getOrderMetafields(order_id);
  if (qc.token !== token) return res.status(401).json({ error: "Invalid token" });
  await updateMetafield(order_id, "approved", "true");
  await updateMetafield(order_id, "approved_at", new Date().toISOString());
  await updateMetafield(order_id, "flow_trigger", "approved");
  res.json({ success: true });
});

// POST /message
app.post("/message", async (req, res) => {
  const { order_id, token, message } = req.body;
  const qc = await getOrderMetafields(order_id);
  if (qc.token !== token) return res.status(401).json({ error: "Invalid token" });
  const messages = JSON.parse(qc.messages || "[]");
  messages.push({ from: "customer", text: message, timestamp: new Date().toISOString() });
  await updateMetafield(order_id, "messages", JSON.stringify(messages));
  await updateMetafield(order_id, "flow_trigger", "customer_message");
  res.json({ success: true });
});

// POST /customer-photo
app.post("/customer-photo", async (req, res) => {
  const { order_id, token, photo_url } = req.body;
  const qc = await getOrderMetafields(order_id);
  if (qc.token !== token) return res.status(401).json({ error: "Invalid token" });
  const photos = JSON.parse(qc.customer_photos || "[]");
  photos.push(photo_url);
  await updateMetafield(order_id, "customer_photos", JSON.stringify(photos));
  await updateMetafield(order_id, "flow_trigger", "customer_photo");
  res.json({ success: true });
});

app.listen(PORT, () => console.log(`SRR KKC Proxy running on port ${PORT}`));
