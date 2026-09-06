// Shared receipt-scanning logic: sends a photo to a free OCR service,
// then pulls out item/price pairs, a guessed restaurant name, and a
// guessed tax+tip amount (total minus the sum of items) from the text.

async function runReceiptOCR(file) {
  // Try OCR engine 2 first with table-detection mode on, which handles
  // receipts with a wide item-name/price column layout much better.
  let result = await attemptOCR(file, 2, true);
  if (result.items.length > 0) return result;

  // If that came back empty, retry with engine 1 (a different underlying
  // model) before giving up — some receipt layouts favor one over the other.
  const retry = await attemptOCR(file, 1, true);
  return retry.items.length > 0 ? retry : result;
}

async function attemptOCR(file, engine, isTable) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('apikey', 'helloworld'); // free demo key, rate-limited — swap in your own free key from ocr.space for real use
  formData.append('OCREngine', String(engine));
  formData.append('scale', 'true');
  formData.append('isTable', String(isTable));

  const res = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body: formData });
  const data = await res.json();

  if (data.IsErroredOnProcessing || !data.ParsedResults || !data.ParsedResults[0]) {
    throw new Error('Could not read the receipt');
  }

  const text = data.ParsedResults[0].ParsedText || '';
  const items = parseReceiptItems(text);
  const restaurantName = guessRestaurantName(text);
  const taxTip = guessTaxTip(text, items);

  return { items, restaurantName, taxTip, rawText: text };
}

function parseReceiptItems(text) {
  const skipWords = /total|subtotal|tax|tip|change|cash|card|balance|visa|mastercard|amex|auth|approved|server|table|guests?\b|qty|item\s*#|order\s*#|phone|www\.|http|\btime\b|\bam\b|\bpm\b/i;
  const rawLines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Clean up common OCR noise: dot-leaders ("Pizza .... 18.00" or "Pizza . . . 18.00"),
  // stray pipes/underscores/dashes used as spacers
  const lines = rawLines.map(l =>
    l.replace(/(\.\s?){2,}/g, ' ')
     .replace(/[\-_]{2,}/g, ' ')
     .replace(/\s{2,}/g, ' ')
     .trim()
  );

  const strictPattern = /^(.{2,40}?)\s+\$?(\d{1,4}(?:[.,]\d{2}))\s*$/;      // price ends the line
  const loosePattern = /^(.{2,40}?)\s+\$?(\d{1,4}(?:[.,]\d{2}))\b/;         // allow trailing junk after price

  const items = [];
  lines.forEach(line => {
    if (skipWords.test(line)) return;

    const match = line.match(strictPattern) || line.match(loosePattern);
    if (!match) return;

    let name = match[1].replace(/^\d+\s*x?\s*/i, '').replace(/^[^a-zA-Z0-9]+/, '').trim();
    const price = parseFloat(match[2].replace(',', '.'));

    if (name.length < 2 || !/[a-zA-Z]/.test(name)) return; // must contain letters, not just numbers/codes
    if (price <= 0 || price > 500) return;

    items.push({ name, price });
  });

  return items;
}

function guessRestaurantName(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const skipFirstLine = /^\d|receipt|order|table|server|welcome/i;
  for (const line of lines.slice(0, 4)) {
    if (line.length < 3 || line.length > 40) continue;
    if (skipFirstLine.test(line)) continue;
    if (/^\$?\d/.test(line)) continue;
    return line.replace(/[^a-zA-Z0-9&'.,\s]/g, '').trim();
  }
  return '';
}

function guessTaxTip(text, items) {
  if (items.length === 0) return null; // "total minus items" is meaningless with no items found
  const totalMatch = text.match(/(?<!sub)total\s*\$?(\d{1,4}\.\d{2})/i);
  if (!totalMatch) return null;
  const total = parseFloat(totalMatch[1]);
  const itemsSum = items.reduce((s, i) => s + i.price, 0);
  const diff = total - itemsSum;
  if (diff <= 0 || diff > total) return null;
  return Math.round(diff * 100) / 100;
}
