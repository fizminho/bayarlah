export type ParsedItem = {
  item_name: string
  quantity: number
  price: number
}

export async function extractTextFromImage(file: File): Promise<string> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

  const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY
  const body = JSON.stringify({
    contents: [{
      parts: [
        {
          text: `You are a receipt parser. Extract all purchased line items and tax from this receipt image. Return ONLY a valid JSON object, no markdown, no explanation.

Rules:
- "items" array: each object must have item_name (string), quantity (integer), price (number, per-unit price in RM)
- "tax" field: total of all tax/SST/GST/service charge lines combined as a single RM number (0 if none)
- The rightmost number column on the receipt is the LINE TOTAL (quantity x unit price)
- Calculate unit price = line total / quantity
- Every item MUST have a price greater than 0.00 unless it is explicitly marked as free or RM0.00 on the receipt
- If you cannot read a price clearly, make your best estimate based on surrounding context
- Ignore lines for: subtotal, rounding, total, cash, change, credit, debit

Format: {"items":[{"item_name":"...","quantity":1,"price":0.00}],"tax":0.00}`
        },
        {
          inline_data: { mime_type: file.type, data: base64 }
        }
      ]
    }]
  })

  const MODELS = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
  ]
  const RETRYABLE = new Set([429, 503, 502, 500])

  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        const delay = attempt * 5000
        console.warn(`[OCR] Retrying ${model} in ${delay / 1000}s... (attempt ${attempt + 1})`)
        await new Promise(r => setTimeout(r, delay))
      }
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      if (!RETRYABLE.has(res.status)) {
        const json = await res.json()
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]'
        console.log(`[OCR] ${model} response:`, text)
        return text
      }
      console.warn(`[OCR] ${model} got ${res.status}, retrying...`)
    }
    console.warn(`[OCR] ${model} exhausted, trying next model...`)
  }

  throw new Error('All Gemini models are unavailable. Please try again in a moment.')
}

export type ParsedReceipt = { items: ParsedItem[], tax: number }

export function parseReceiptText(text: string): ParsedReceipt {
  try {
    const cleaned = text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(cleaned)
    const items: ParsedItem[] = Array.isArray(parsed.items) ? parsed.items : []
    const tax: number = typeof parsed.tax === 'number' ? parsed.tax : 0
    console.log('[OCR] Parsed items:', items, 'tax:', tax)
    return { items, tax }
  } catch {
    console.error('[OCR] Failed to parse Gemini response:', text)
    return { items: [], tax: 0 }
  }
}
