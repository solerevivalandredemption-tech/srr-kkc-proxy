import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

// -----------------------------
// 🔧 Express Setup
// -----------------------------
const app = express();
app.use(bodyParser.json());
app.use(express.json());

// -----------------------------
// 🔧 Shopify API Helpers
// -----------------------------
const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

function shopifyURL(path) {
  return `https://${SHOPIFY_STORE}/admin/api/2024-01/${path}`;
}

async function shopifyGET(path) {
  const res = await fetch(shopifyURL(path), {
    headers: {
      "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
      "Content-Type": "application/json"
    }
  });
  return res.json();
}

async function shopifyPOST(path, body) {
  const res = await fetch(shopifyURL(path), {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function shopifyPUT(path, body) {
  const res = await fetch(shopifyURL(path), {
    method: "PUT",
    headers: {
      "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  return res.json();
}

// -----------------------------
// 🔧 Metafield Helpers
// -----------------------------
async function getMetafield(orderId, key) {
  const data = await shopifyGET(`orders/${orderId}/metafields.json`);
  const mf = data.metafields.find(m => m.key === key);
  return mf ? mf.value : null;
}

async function writeMetafield(orderId, key, value, type = "string") {
  return shopifyPOST(`orders/${orderId}/metafields.json`, {
    metafield: {
      namespace: "srr_qc",
      key,
      type,
      value: typeof value === "object" ? JSON.stringify(value) : value
    }
  });
}

function nowIso() {
  return new Date().toISOString();
}

// -----------------------------
// 🔧 Token Validation
// -----------------------------
async function validateToken(orderId, token) {
  const stored = await getMetafield(orderId, "customer_token");
  return stored && stored === token;
}

// -----------------------------
// 1️⃣ GET /apps/srr-qc/order
// -----------------------------
app.get("/apps/srr-qc/order", async (req, res) => {
  try {
    const { id, token } = req.query;

    if (!id || !token) {
      return res.status(400).json({ error: "Missing id or token" });
    }

    if (!(await validateToken(id, token))) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const order = await shopifyGET(`orders/${id}.json`);
    const photos = await getMetafield(id, "customer_photos");

    res.json({
      order: order.order,
      photos: photos ? JSON.parse(photos) : []
    });
  } catch (err) {
    console.error("❌ Error in GET /order:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// -----------------------------
// 2️⃣ POST /apps/srr-qc/approve
// -----------------------------
app.post("/apps/srr-qc/approve", async (req, res) => {
  try {
    const { order_id, token, photo_index } = req.body;

    if (!order_id || !token || photo_index === undefined) {
      return res.status(400).json({ error: "Missing fields" });
    }

    if (!(await validateToken(order_id, token))) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const raw = await getMetafield(order_id, "customer_photos");
    let photos = raw ? JSON.parse(raw) : [];

    if (!photos[photo_index]) {
      return res.status(400).json({ error: "Photo index invalid" });
    }

    photos[photo_index].approved = true;

    await writeMetafield(order_id, "customer_photos", photos, "json");
    await writeMetafield(
      order_id,
      "customer_update",
      { timestamp: nowIso(), action: "approve_photo", order_id },
      "json"
    );

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error in POST /approve:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// -----------------------------
// 3️⃣ POST /apps/srr-qc/message
// -----------------------------
app.post("/apps/srr-qc/message", async (req, res) => {
  try {
    const { order_id, token, message } = req.body;

    if (!order_id || !token || !message) {
      return res.status(400).json({ error: "Missing fields" });
    }

    if (!(await validateToken(order_id, token))) {
      return res.status(401).json({ error: "Invalid token" });
    }

    await writeMetafield(
      order_id,
      "customer_message",
      { timestamp: nowIso(), message },
      "json"
    );

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error in POST /message:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// -----------------------------
// 4️⃣ POST /apps/srr-qc/customer-photo
// -----------------------------
app.post("/apps/srr-qc/customer-photo", async (req, res) => {
  try {
    const { order_id, token, url, customerName, date } = req.body;

    if (!order_id || !token || !url || !customerName || !date) {
      return res.status(400).json({ error: "Missing fields" });
    }

    if (!(await validateToken(order_id, token))) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const currentPhotosRaw = await getMetafield(order_id, "customer_photos");
    let photos = [];

    try {
      photos = currentPhotosRaw ? JSON.parse(currentPhotosRaw) : [];
    } catch {
      photos = [];
    }

    photos.push({ url, customerName, date, approved: false });

    await writeMetafield(order_id, "customer_photos", photos, "json");
    await writeMetafield(
      order_id,
      "customer_update",
      { timestamp: nowIso(), action: "kicks_pic", order_id },
      "json"
    );

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error in POST /customer-photo:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// -----------------------------
// 🔥 REQUIRED FOR RENDER
// -----------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🔥 SRR-KKC Proxy running on port ${PORT}`);
});
