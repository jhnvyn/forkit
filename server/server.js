const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { nanoid } = require("nanoid");
const db = require("./db");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// --- Create a new split ---
// body: { restaurantName, payerName, payerVenmo, payerPaypal, payerPhone, items: [{name, price}], taxTip }
app.post("/api/splits", (req, res) => {
  const { restaurantName, payerName, payerVenmo, payerPaypal, payerPhone, items, taxTip } = req.body;

  if (!restaurantName || !payerName || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "restaurantName, payerName, and at least one item are required" });
  }

  const subtotal = items.reduce((sum, i) => sum + Number(i.price || 0), 0);
  const id = nanoid(8);

  const itemsWithIds = items.map((item) => ({
    id: nanoid(8),
    name: item.name,
    price: Number(item.price),
  }));

  db.createSplit({
    id,
    restaurantName,
    payerName,
    payerVenmo,
    payerPaypal,
    payerPhone,
    subtotal,
    taxTip: Number(taxTip || 0),
    items: itemsWithIds,
  });

  res.json({ id, url: `/s/${id}` });
});

// --- Get full split state ---
app.get("/api/splits/:id", (req, res) => {
  const split = db.getSplit(req.params.id);
  if (!split) return res.status(404).json({ error: "Split not found" });

  const { items, payments } = normalizeSplit(split);
  res.json({ split, items, payments });
});

// Convert a raw db split's snake_case claim/payment fields into the
// camelCase shape the frontend expects. Used by both /api/splits/:id and
// /api/history/:name so every consumer gets consistent field names.
function normalizeSplit(split) {
  const items = split.items.map((item) => ({
    ...item,
    claims: item.claims.map((c) => ({
      claimerName: c.claimer_name,
      claimerSession: c.claimer_session,
    })),
  }));

  const payments = (split.payments || []).map((p) => ({
    claimerSession: p.claimer_session,
    claimerName: p.claimer_name,
    amount: p.amount,
    paidByName: p.paid_by_name,
    covered: p.covered,
  }));

  return { items, payments };
}

// --- Toggle a claim on an item for a given person/session ---
// body: { claimerName, claimerSession }
app.post("/api/items/:itemId/claim", (req, res) => {
  const { claimerName, claimerSession } = req.body;
  if (!claimerName || !claimerSession) {
    return res.status(400).json({ error: "claimerName and claimerSession are required" });
  }

  const DB_PATH = path.join(__dirname, "..", "tabsplit.json");
  let data = { splits: {} };
  if (fs.existsSync(DB_PATH)) {
    data = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  }
  const splitEntry = Object.values(data.splits).find((s) => s.items.some((i) => i.id === req.params.itemId));
  if (!splitEntry) return res.status(404).json({ error: "Item not found" });

  const result = db.toggleClaim(splitEntry.id, req.params.itemId, claimerName, claimerSession);
  if (!result) return res.status(404).json({ error: "Item not found" });

  res.json(result);
});

// --- Record that someone's share has been paid (self or a friend covering) ---
// body: { claimerSession, claimerName, amount, paidByName }
app.post("/api/splits/:id/pay", (req, res) => {
  const { claimerSession, claimerName, amount, paidByName } = req.body;
  if (!claimerSession || !claimerName || amount == null) {
    return res.status(400).json({ error: "claimerSession, claimerName, and amount are required" });
  }
  const result = db.recordPayment(req.params.id, { claimerSession, claimerName, amount, paidByName });
  if (!result) return res.status(404).json({ error: "Split not found" });
  res.json(result);
});

// --- Get every split a name has been involved in, as payer or claimer ---
app.get("/api/history/:name", (req, res) => {
  const rawEntries = db.getSplitsForName(req.params.name);
  const entries = rawEntries.map(({ split, isPayer, claimerSessions }) => {
    const { items, payments } = normalizeSplit(split);
    return {
      split: { ...split, items, payments },
      isPayer,
      claimerSessions,
    };
  });
  res.json({ entries });
});

// --- Serve the friend-facing split page for any /s/:id URL ---
app.get("/s/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "split.html"));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Forkit API running on http://localhost:${PORT}`));
