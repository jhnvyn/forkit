const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "tabsplit.json");

function load() {
  if (!fs.existsSync(DB_PATH)) {
    return { splits: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  } catch {
    return { splits: {} };
  }
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function createSplit({ id, restaurantName, payerName, payerVenmo, payerPaypal, payerPhone, subtotal, taxTip, items }) {
  const data = load();
  data.splits[id] = {
    id,
    restaurant_name: restaurantName,
    payer_name: payerName,
    payer_venmo: payerVenmo || null,
    payer_paypal: payerPaypal || null,
    payer_phone: payerPhone || null,
    subtotal,
    tax_tip: taxTip,
    created_at: Date.now(),
    items: items.map((item, idx) => ({
      id: item.id,
      name: item.name,
      price: item.price,
      sort_order: idx,
      claims: [],
    })),
  };
  save(data);
  return data.splits[id];
}

function getSplit(id) {
  const data = load();
  return data.splits[id] || null;
}

function toggleClaim(splitId, itemId, claimerName, claimerSession) {
  const data = load();
  const split = data.splits[splitId];
  if (!split) return null;
  const item = split.items.find((i) => i.id === itemId);
  if (!item) return null;

  const existingIdx = item.claims.findIndex((c) => c.claimer_session === claimerSession);
  let claimed;
  if (existingIdx >= 0) {
    item.claims.splice(existingIdx, 1);
    claimed = false;
  } else {
    item.claims.push({ claimer_name: claimerName, claimer_session: claimerSession, created_at: Date.now() });
    claimed = true;
  }
  save(data);
  return { claimed };
}

// Record that a person's share of a split has been paid — either by
// themselves, or by someone else covering for them.
function recordPayment(splitId, { claimerSession, claimerName, amount, paidByName }) {
  const data = load();
  const split = data.splits[splitId];
  if (!split) return null;
  if (!split.payments) split.payments = [];

  // Don't double-record the same person's payment
  const alreadyPaid = split.payments.find((p) => p.claimer_session === claimerSession);
  if (alreadyPaid) return { alreadyPaid: true };

  split.payments.push({
    claimer_session: claimerSession,
    claimer_name: claimerName,
    amount,
    paid_by_name: paidByName || claimerName,
    covered: paidByName && paidByName !== claimerName,
    paid_at: Date.now(),
  });
  save(data);
  return { recorded: true };
}

// Every split a given name has touched, either as the payer or as someone
// who claimed items — used for the "My splits" history page.
function getSplitsForName(name) {
  const data = load();
  const lower = name.trim().toLowerCase();
  const results = [];

  Object.values(data.splits).forEach((split) => {
    const isPayer = split.payer_name.trim().toLowerCase() === lower;
    const claimerSessions = new Set();
    split.items.forEach((item) => {
      item.claims.forEach((c) => {
        if (c.claimer_name.trim().toLowerCase() === lower) {
          claimerSessions.add(c.claimer_session);
        }
      });
    });

    if (!isPayer && claimerSessions.size === 0) return;

    results.push({ split, isPayer, claimerSessions: [...claimerSessions] });
  });

  return results.sort((a, b) => b.split.created_at - a.split.created_at);
}

module.exports = { createSplit, getSplit, toggleClaim, recordPayment, getSplitsForName };

