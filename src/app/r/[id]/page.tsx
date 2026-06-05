'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase, Receipt, ReceiptItem, Participant, Selection } from '@/lib/supabase'
import { Loader2, CheckCircle } from 'lucide-react'

type Props = { params: Promise<{ id: string }> }

export default function ReceiptPage({ params }: Props) {
  const [receiptId, setReceiptId] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [items, setItems] = useState<ReceiptItem[]>([])
  const [participants, setParticipants] = useState<Participant[]>([])
  const [allSelections, setAllSelections] = useState<Selection[]>([])

  const [name, setName] = useState('')
  const [me, setMe] = useState<Participant | null>(null)
  const [paid, setPaid] = useState(false)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)

  // Resolve params
  useEffect(() => {
    params.then(p => setReceiptId(p.id))
  }, [params])

  const fetchAll = useCallback(async (rid: string) => {
    const [{ data: r }, { data: its }, { data: parts }, { data: sels }] = await Promise.all([
      supabase.from('receipts').select('*').eq('id', rid).single(),
      supabase.from('receipt_items').select('*').eq('receipt_id', rid),
      supabase.from('participants').select('*').eq('receipt_id', rid),
      supabase.from('selections').select('*'),
    ])
    if (r) setReceipt(r)
    if (its) setItems(its)
    if (parts) setParticipants(parts)
    if (sels) setAllSelections(sels)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!receiptId) return
    fetchAll(receiptId)

    // Realtime: selections changes
    const channel = supabase
      .channel(`receipt-${receiptId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'selections' }, () => {
        supabase.from('selections').select('*').then(({ data }) => { if (data) setAllSelections(data) })
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'participants', filter: `receipt_id=eq.${receiptId}` }, () => {
        supabase.from('participants').select('*').eq('receipt_id', receiptId).then(({ data }) => { if (data) setParticipants(data) })
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [receiptId, fetchAll])

  async function handleJoin() {
    if (!name.trim() || !receiptId) return
    setJoining(true)
    const { data, error } = await supabase
      .from('participants')
      .insert({ receipt_id: receiptId, name: name.trim() })
      .select()
      .single()
    if (!error && data) setMe(data)
    setJoining(false)
  }

  async function setItemQty(itemId: string, qty: number) {
    if (!me) return
    const bounded = Math.max(0, qty)
    const existing = allSelections.find(s => s.participant_id === me.id && s.receipt_item_id === itemId)
    if (bounded === 0) {
      if (existing) {
        await supabase.from('selections').delete().eq('id', existing.id)
        setAllSelections(prev => prev.filter(s => s.id !== existing.id))
      }
      return
    }
    if (existing) {
      const { data } = await supabase.from('selections').update({ qty: bounded }).eq('id', existing.id).select().single()
      if (data) setAllSelections(prev => prev.map(s => s.id === existing.id ? data : s))
    } else {
      const { data } = await supabase.from('selections').insert({ participant_id: me.id, receipt_item_id: itemId, qty: bounded }).select().single()
      if (data) setAllSelections(prev => [...prev, data])
    }
  }

  const mySelections = me ? allSelections.filter(s => s.participant_id === me.id) : []
  const selectedItemIds = new Set(mySelections.map(s => s.receipt_item_id))

  function getMyQty(itemId: string) {
    return mySelections.find(s => s.receipt_item_id === itemId)?.qty ?? 0
  }

  function getItemClaimCount(itemId: string) {
    return allSelections.filter(s => s.receipt_item_id === itemId).length
  }

  function getMyTotal() {
    if (!receipt) return 0
    const itemsTotal = mySelections.reduce((sum, sel) => {
      const item = items.find(i => i.id === sel.receipt_item_id)
      if (!item) return sum
      return sum + item.price * sel.qty
    }, 0)
    const taxShare = receipt.subtotal > 0 ? (itemsTotal / receipt.subtotal) * receipt.tax : 0
    return itemsTotal + (isNaN(taxShare) ? 0 : taxShare)
  }

  if (loading || !receiptId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-indigo-600" size={32} />
      </div>
    )
  }

  if (!receipt) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Receipt not found.</div>
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-10 px-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow p-6 space-y-5">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-indigo-600">BayarLah 🧾</h1>
          <p className="text-lg font-semibold text-gray-800 mt-1">{receipt.title}</p>
          <p className="text-sm text-gray-400">{participants.length} participant{participants.length !== 1 ? 's' : ''} joined</p>
        </div>

        {/* Join Form */}
        {!me && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600 text-center">Enter your name to join</p>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleJoin()}
              placeholder="Your name"
              className="w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <button
              onClick={handleJoin}
              disabled={joining || !name.trim()}
              className="w-full bg-indigo-600 text-white py-2.5 rounded-xl hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {joining && <Loader2 className="animate-spin" size={16} />}
              Join & Select Items
            </button>
          </div>
        )}

        {/* Items List */}
        {me && (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-gray-700">Select your items, {me.name} 👇</p>
            {items.map(item => {
              const myQty = getMyQty(item.id)
              const totalClaimed = allSelections.filter(s => s.receipt_item_id === item.id).reduce((sum, s) => sum + (s.qty ?? 1), 0)
              const remaining = item.quantity - totalClaimed + myQty
              const claimed = myQty > 0
              return (
                <div
                  key={item.id}
                  className={`w-full flex justify-between items-center px-4 py-3 rounded-xl border text-sm transition-all ${
                    claimed ? 'bg-indigo-50 border-indigo-400 text-indigo-800' : 'bg-white border-gray-200 text-gray-700'
                  }`}
                >
                  <span className="flex items-center gap-2 flex-1 min-w-0">
                    {claimed && <CheckCircle size={16} className="text-indigo-500 shrink-0" />}
                    <span className="truncate">{item.item_name}</span>
                    <span className="text-xs text-gray-400 shrink-0">(x{item.quantity})</span>
                  </span>
                  <span className="flex items-center gap-2 ml-2 shrink-0">
                    <span className="text-xs text-gray-500">RM {item.price.toFixed(2)}/unit</span>
                    <button
                      onClick={() => setItemQty(item.id, myQty - 1)}
                      className="w-7 h-7 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-100 disabled:opacity-30"
                      disabled={myQty === 0}
                    >−</button>
                    <span className="w-5 text-center font-semibold">{myQty}</span>
                    <button
                      onClick={() => setItemQty(item.id, myQty + 1)}
                      className="w-7 h-7 rounded-full border border-indigo-400 flex items-center justify-center text-indigo-600 hover:bg-indigo-50 disabled:opacity-30"
                      disabled={remaining <= 0}
                    >+</button>
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* Summary */}
        {me && (
          <div className="bg-indigo-50 rounded-xl px-4 py-3 space-y-1 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Receipt Total</span>
              <span>RM {receipt.total.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-bold text-indigo-700 text-base">
              <span>Your Share</span>
              <span>RM {getMyTotal().toFixed(2)}</span>
            </div>
          </div>
        )}

        {/* Payment Section */}
        {me && !paid && (
          <div className="space-y-3">
            {receipt.qr_image_url && (
              <div className="flex flex-col items-center gap-2">
                <p className="text-sm font-semibold text-gray-700">Scan to Pay 💳</p>
                <img
                  src={receipt.qr_image_url}
                  alt="Payment QR"
                  className="w-56 h-56 object-contain border rounded-xl"
                  onError={e => {
                    (e.target as HTMLImageElement).style.display = 'none';
                    (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden')
                  }}
                />
                <p className="text-xs text-red-400 hidden">QR image could not be loaded. Check Supabase Storage bucket is public.</p>
                <p className="text-xs text-gray-400">Scan with DuitNow / TNG app</p>
              </div>
            )}
          </div>
        )}

        {me && !paid && (
          <button
            onClick={() => setPaid(true)}
            className="w-full bg-green-600 text-white py-2.5 rounded-xl hover:bg-green-700"
          >
            ✅ I&apos;ve Paid RM {getMyTotal().toFixed(2)}
          </button>
        )}

        {paid && (
          <div className="text-center space-y-2">
            <div className="text-4xl">✅</div>
            <p className="font-semibold text-green-700">Payment marked complete!</p>
            <p className="text-sm text-gray-400">Thanks, {me?.name}!</p>
          </div>
        )}

        {/* Participants summary */}
        {participants.length > 0 && (
          <div className="border-t pt-4 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Participants</p>
            {participants.map(p => {
              const pSelections = allSelections.filter(s => s.participant_id === p.id)
              const pTotal = pSelections.reduce((sum, sel) => {
                const item = items.find(i => i.id === sel.receipt_item_id)
                return item ? sum + item.price * sel.qty : sum
              }, 0)
              return (
                <div key={p.id} className="flex justify-between text-sm text-gray-700">
                  <span>{p.name} {me?.id === p.id ? '(you)' : ''}</span>
                  <span>RM {pTotal.toFixed(2)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
