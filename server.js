import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());
app.use(express.json());

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const PORT = process.env.PORT || 3000;

async function shopifyGET(path) {
  const res = await fetch(`https://${SHOPIFY_STORE}/admin/api/2024-01/${path}`, {
    headers: { "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN, "Content-Type": "application/json" }
  });
  return res.json();
}

async function shopifyPOST(path, body) {
  const res = await fetch(`https://${SHOPIFY_STORE}/admin/api/2024-01/${path}`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function getAllMetafields(orderId) {
  const data = await shopifyGET(`orders/${orderId}/metafields.json?namespace=srr_qc`);
  if (!Array.isArray(data?.metafields)) {
    console.error(`❌ getAllMetafields failed for order ${orderId}:`, JSON.stringify(data));
    return [];
  }
  return data.metafields;
}

function getMF(metafields, key) {
  const mf = metafields.find(m => m.key === key);
  if (!mf) return null;
  try { return JSON.parse(mf.value); } catch { return mf.value; }
}

async function writeMetafield(orderId, key, value, type = "single_line_text_field") {
  return shopifyPOST(`orders/${orderId}/metafields.json`, {
    metafield: {
      namespace: "srr_qc", key, type,
      value: typeof value === "object" ? JSON.stringify(value) : String(value)
    }
  });
}

async function validateToken(orderId, token) {
  const metafields = await getAllMetafields(orderId);
  const stored = getMF(metafields, "token");
  return stored && stored === token;
}

app.get("/apps/srr-qc/order", async (req, res) => {
  try {
    const { id, token } = req.query;
    if (!id || !token) return res.status(400).json({ error: "Missing id or token" });

    const metafields = await getAllMetafields(id);
    const stored = getMF(metafields, "token");
    if (!stored || stored !== token) return res.status(401).json({ error: "Invalid token" });

    const orderData = await shopifyGET(`orders/${id}.json?fields=id,name,created_at,line_items`);

    res.json({
      order: orderData.order || {},
      qc: {
        status:           getMF(metafields, "status")           || "Pending",
        token:            getMF(metafields, "token"),
        photos:           getMF(metafields, "photos")           || [],
        timeline:         getMF(metafields, "timeline")         || [],
        messages:         getMF(metafields, "messages")         || [],
        notes_customer:   getMF(metafields, "notes_customer")   || [],
        approved:         getMF(metafields, "approved") === true || getMF(metafields, "approved") === "true",
        approved_at:      getMF(metafields, "approved_at")      || null,
        tracking_number:  getMF(metafields, "tracking_number")  || null,
        tracking_carrier: getMF(metafields, "tracking_carrier") || null,
        tracking_notes:   getMF(metafields, "tracking_notes")   || null
      }
    });
  } catch (err) {
    console.error("❌ Error in GET /order:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/apps/srr-qc/approve", async (req, res) => {
  try {
    const { order_id, token } = req.body;
    if (!order_id || !token) return res.status(400).json({ error: "Missing fields" });
    if (!(await validateToken(order_id, token))) return res.status(401).json({ error: "Invalid token" });
    await writeMetafield(order_id, "approved", "true");
    await writeMetafield(order_id, "approved_at", new Date().toISOString());
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error in POST /approve:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/apps/srr-qc/message", async (req, res) => {
  try {
    const { order_id, token, message, sender } = req.body;
    if (!order_id || !token || !message) return res.status(400).json({ error: "Missing fields" });
    if (!(await validateToken(order_id, token))) return res.status(401).json({ error: "Invalid token" });
    const metafields = await getAllMetafields(order_id);
    const existing = getMF(metafields, "messages") || [];
    existing.push({ sender: sender || "customer", message, created_at: new Date().toISOString() });
    await writeMetafield(order_id, "messages", JSON.stringify(existing), "json");
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error in POST /message:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/apps/srr-qc/customer-photo", async (req, res) => {
  try {
    const { order_id, token, image, caption } = req.body;
    if (!order_id || !token || !image) return res.status(400).json({ error: "Missing fields" });
    if (!(await validateToken(order_id, token))) return res.status(401).json({ error: "Invalid token" });
    const metafields = await getAllMetafields(order_id);
    const existing = getMF(metafields, "customer_photos") || [];
    existing.push({ url: image, caption: caption || "", submitted_at: new Date().toISOString() });
    await writeMetafield(order_id, "customer_photos", JSON.stringify(existing), "json");
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error in POST /customer-photo:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/", (req, res) => res.json({ status: "SRR KKC Proxy live 🔥" }));

app.listen(PORT, () => console.log(`🔥 SRR-KKC Proxy running on port ${PORT}`));
