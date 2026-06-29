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

  const res = await fetch('/api/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64, mimeType: file.type }),
  })

  if (!res.ok) throw new Error('All Gemini models are unavailable. Please try again in a moment.')
  const { text } = await res.json()
  return text
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
