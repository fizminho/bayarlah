import Tesseract from 'tesseract.js'

export type ParsedItem = {
  item_name: string
  quantity: number
  price: number
}

export async function extractTextFromImage(file: File): Promise<string> {
  const { data } = await Tesseract.recognize(file, 'eng')
  return data.text
}

export function parseReceiptText(text: string): ParsedItem[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const items: ParsedItem[] = []

  // qty at start, then item name, then price: "2 Nasi Lemak 12.50" or "2x Nasi Lemak 12.50"
  const qtyPattern = /^(\d+)\s*[xX]?\s+(.+?)\s+(\d+\.\d{2})$/
  const pricePattern = /^(.+?)\s+(\d+\.\d{2})$/
  const totalKeyword = /^total\b/i
  const skipKeyword = /subtotal|rounding|discount|change|cash|balance/i
  const taxKeyword = /\btax\b|\bgst\b|\bsst\b|\bservice charge\b/i

  let pastTotal = false

  for (const line of lines) {
    // Once we hit a total line, only allow tax-related lines through
    if (totalKeyword.test(line)) {
      pastTotal = true
      continue
    }

    if (pastTotal) {
      // After total, only capture tax lines
      const priceMatch = line.match(pricePattern)
      if (priceMatch && taxKeyword.test(priceMatch[1])) {
        items.push({
          item_name: priceMatch[1].trim(),
          quantity: 1,
          price: parseFloat(priceMatch[2]),
        })
      }
      continue
    }

    if (skipKeyword.test(line)) continue

    const qtyMatch = line.match(qtyPattern)
    if (qtyMatch) {
      const qty = parseInt(qtyMatch[1])
      const lineTotal = parseFloat(qtyMatch[3])
      items.push({
        item_name: qtyMatch[2].trim(),
        quantity: qty,
        price: parseFloat((lineTotal / qty).toFixed(2)),
      })
      continue
    }

    const priceMatch = line.match(pricePattern)
    if (priceMatch) {
      const name = priceMatch[1].trim()
      if (skipKeyword.test(name)) continue
      items.push({
        item_name: name,
        quantity: 1,
        price: parseFloat(priceMatch[2]),
      })
    }
  }

  return items
}
