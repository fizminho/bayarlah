import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!
  )
}

export async function POST(req: NextRequest) {
  const { title, subtotal, tax, total, qrBase64, qrMimeType, qrExt, items } = await req.json()
  const supabase = getSupabase()

  let qrImageUrl: string | null = null

  if (qrBase64 && qrExt) {
    const fileName = `qr_${Date.now()}.${qrExt}`
    const buffer = Buffer.from(qrBase64, 'base64')
    const { error: uploadError } = await supabase.storage
      .from('qr-images')
      .upload(fileName, buffer, { contentType: qrMimeType, upsert: true })
    if (!uploadError) {
      const { data } = supabase.storage.from('qr-images').getPublicUrl(fileName)
      qrImageUrl = data.publicUrl
    }
  }

  const { data: receipt, error: receiptError } = await supabase
    .from('receipts')
    .insert({ title, subtotal, tax, total, qr_image_url: qrImageUrl })
    .select()
    .single()

  if (receiptError || !receipt) {
    return NextResponse.json({ error: receiptError?.message }, { status: 500 })
  }

  const itemRows = items
    .filter((i: { item_name: string }) => i.item_name.trim())
    .map((i: { item_name: string; quantity: number; price: number }) => ({
      receipt_id: receipt.id,
      item_name: i.item_name,
      quantity: i.quantity,
      price: i.price,
    }))

  if (itemRows.length) await supabase.from('receipt_items').insert(itemRows)

  return NextResponse.json({ id: receipt.id })
}
