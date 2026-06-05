import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Receipt = {
  id: string
  title: string
  subtotal: number
  tax: number
  total: number
  qr_image_url: string | null
  created_at: string
}

export type ReceiptItem = {
  id: string
  receipt_id: string
  item_name: string
  quantity: number
  price: number
}

export type Participant = {
  id: string
  receipt_id: string
  name: string
  joined_at: string
}

export type Selection = {
  id: string
  participant_id: string
  receipt_item_id: string
  qty: number
}
