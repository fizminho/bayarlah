'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase, Receipt, ReceiptItem, Participant, Selection } from '@/lib/supabase'
import { Loader2, CheckCircle } from 'lucide-react'

type Props = { params: Promise<{ id: string }> }

function Divider() {
  return <div className="border-t border-dashed border-gray-400 my-2" />
}

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

  useEffect(() => { params.then(p => setReceiptId(p.id)) }, [params])

  const fetchAll = useCallback(async (rid: string) => {
    const [{ data: r }, { data: its }, { data: parts }, { data: sels }] = await Promise.all([
      supabase.from('receipts').select('*').eq('id', rid).single(),
      supabase.from('receipt_items').select('*').eq('receipt_id', rid),
      supabase.from('participants').select('*').eq('receipt_id', rid),
      supabase.from('selections').select('*, participants!inner(receipt_id)').eq('participants.receipt_id', rid),
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
    const channel = supabase
      .channel(`receipt-${receiptId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'selections' }, () => {
        supabase.from('selections').select('*, participants!inner(receipt_id)').eq('participants.receipt_id', receiptId).then(({ data }) => { if (data) setAllSelections(data) })
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
    const { data, error } = await supabase.from('participants').insert({ receipt_id: receiptId, name: name.trim() }).select().single()
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

  function getMyQty(itemId: string) {
    return mySelections.find(s => s.receipt_item_id === itemId)?.qty ?? 0
  }

  function calcTotal(sels: Selection[]) {
    if (!receipt) return 0
    const itemsTotal = sels.reduce((sum, sel) => {
      const item = items.find(i => i.id === sel.receipt_item_id)
      return item ? sum + item.price * sel.qty : sum
    }, 0)
    const taxShare = receipt.subtotal > 0 ? (itemsTotal / receipt.subtotal) * receipt.tax : 0
    return itemsTotal + (isNaN(taxShare) ? 0 : taxShare)
  }

  function getMyTotal() { return calcTotal(mySelections) }

  const collectedTotal = participants.reduce((sum, p) => {
    return sum + calcTotal(allSelections.filter(s => s.participant_id === p.id))
  }, 0)

  if (loading || !receiptId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-200">
        <Loader2 className="animate-spin text-gray-600" size={32} />
      </div>
    )
  }

  if (!receipt) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-200 text-gray-500 text-sm">Receipt not found.</div>
  }

  return (
    <div className="min-h-screen bg-gray-200 flex flex-col items-center py-8 px-3">
      <div className="w-full max-w-sm bg-white shadow-xl" style={{ fontFamily: "'Courier New', Courier, monospace" }}>
        {/* torn top */}
        <div className="w-full h-3" style={{ background: 'repeating-linear-gradient(90deg, white 0px, white 8px, #e5e7eb 8px, #e5e7eb 10px)' }} />

        <div className="px-5 pb-6 pt-2 space-y-4">
          {/* Header */}
          <div className="text-center space-y-0.5 pt-2">
            <p className="text-xl font-bold tracking-widest">BayarLah</p>
            <p className="text-xs tracking-widest text-gray-500">SPLIT YOUR BILL</p>
            <Divider />
            <p className="text-base font-bold tracking-wide">{receipt.title}</p>
            <p className="text-xs text-gray-400">{participants.length} PARTICIPANT{participants.length !== 1 ? 'S' : ''} JOINED</p>
          </div>

          <Divider />

          {/* Join Form */}
          {!me && (
            <div className="space-y-3">
              <p className="text-xs text-gray-400 text-center tracking-wide">ENTER YOUR NAME TO JOIN</p>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleJoin()}
                placeholder="Your name"
                className="w-full border-b border-gray-300 py-2 text-sm focus:outline-none focus:border-gray-600 bg-transparent text-center tracking-wide"
              />
              <button
                onClick={handleJoin}
                disabled={joining || !name.trim()}
                className="w-full bg-black text-white text-sm py-3 hover:bg-gray-800 disabled:opacity-50 flex items-center justify-center gap-2 tracking-wide"
              >
                {joining && <Loader2 className="animate-spin" size={14} />}
                JOIN & SELECT ITEMS
              </button>
            </div>
          )}

          {/* Items List */}
          {me && (
            <div className="space-y-2">
              <p className="text-xs text-gray-400 tracking-wide">SELECT YOUR ITEMS, {me.name.toUpperCase()} 👇</p>
              <div className="flex text-xs text-gray-400 tracking-wide">
                <span className="flex-1">ITEM</span>
                <span className="text-right">AMT</span>
              </div>
              <Divider />
              {items.map(item => {
                const myQty = getMyQty(item.id)
                const totalClaimed = allSelections.filter(s => s.receipt_item_id === item.id).reduce((sum, s) => sum + (s.qty ?? 1), 0)
                const remaining = item.quantity - totalClaimed + myQty
                const claimed = myQty > 0
                return (
                  <div key={item.id} className={`py-2 ${claimed ? 'bg-gray-50' : ''}`}>
                    {/* Item name row — full width, wraps naturally */}
                    <div className="flex items-start gap-1 mb-1">
                      {claimed && <CheckCircle size={13} className="text-gray-600 shrink-0 mt-0.5" />}
                      <span className="text-sm flex-1 leading-snug break-words">{item.item_name}</span>
                      <span className="text-xs text-gray-500 shrink-0 ml-1 mt-0.5">RM {(item.price * (myQty || item.quantity)).toFixed(2)}</span>
                    </div>
                    {/* Controls row */}
                    <div className="flex items-center justify-between pl-4">
                      <span className="text-xs text-gray-400">
                        {item.quantity > 1 ? `x${item.quantity} @ RM${item.price.toFixed(2)}` : `RM ${item.price.toFixed(2)}`}
                        {remaining < item.quantity && remaining > 0 && <span className="text-orange-400 ml-1">({remaining} left)</span>}
                        {remaining === 0 && myQty === 0 && <span className="text-red-400 ml-1">(taken)</span>}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setItemQty(item.id, myQty - 1)}
                          disabled={myQty === 0}
                          className="w-7 h-7 border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-100 disabled:opacity-30 text-base"
                        >−</button>
                        <span className="w-5 text-center text-sm font-bold">{myQty}</span>
                        <button
                          onClick={() => setItemQty(item.id, myQty + 1)}
                          disabled={remaining <= 0}
                          className="w-7 h-7 border border-gray-800 flex items-center justify-center text-gray-800 hover:bg-gray-100 disabled:opacity-30 text-base"
                        >+</button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* My Total Summary */}
          {me && (
            <>
              <Divider />
              <div className="space-y-1 text-sm">
                <div className="flex justify-between text-xs text-gray-400">
                  <span>RECEIPT TOTAL</span>
                  <span>RM {receipt.total.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold text-base">
                  <span>YOUR SHARE</span>
                  <span>RM {getMyTotal().toFixed(2)}</span>
                </div>
              </div>
            </>
          )}

          {/* Payment QR */}
          {me && !paid && receipt.qr_image_url && (
            <>
              <Divider />
              <div className="flex flex-col items-center gap-2">
                <p className="text-xs tracking-widest text-gray-500">SCAN TO PAY</p>
                <img
                  src={receipt.qr_image_url}
                  alt="Payment QR"
                  className="w-48 h-48 object-contain border border-dashed border-gray-300"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
                <p className="text-xs text-gray-400">DuitNow / TNG</p>
              </div>
            </>
          )}

          {/* Pay Button */}
          {me && !paid && (
            <>
              <Divider />
              <button
                onClick={() => setPaid(true)}
                className="w-full bg-black text-white text-sm py-3 hover:bg-gray-800 tracking-wide"
              >
                ✅ I&apos;VE PAID RM {getMyTotal().toFixed(2)}
              </button>
            </>
          )}

          {paid && (
            <div className="text-center space-y-1 py-2">
              <p className="text-3xl">✅</p>
              <p className="text-sm font-bold tracking-widest">PAYMENT COMPLETE!</p>
              <p className="text-xs text-gray-400">THANK YOU, {me?.name.toUpperCase()}!</p>
            </div>
          )}

          {/* Participants Summary */}
          {participants.length > 0 && (
            <>
              <Divider />
              <div className="space-y-2">
                <p className="text-xs text-gray-400 tracking-widest">PARTICIPANTS</p>
                {participants.map(p => {
                  const pTotal = calcTotal(allSelections.filter(s => s.participant_id === p.id))
                  return (
                    <div key={p.id} className="flex justify-between text-sm">
                      <span className="truncate flex-1 mr-2">
                        {p.name} {me?.id === p.id ? <span className="text-xs text-gray-400">(you)</span> : ''}
                      </span>
                      <span className="shrink-0">RM {pTotal.toFixed(2)}</span>
                    </div>
                  )
                })}
                <Divider />
                <div className="flex justify-between text-sm font-bold">
                  <span>COLLECTED / TOTAL</span>
                  <span className={collectedTotal >= receipt.total ? 'text-green-700' : 'text-orange-500'}>
                    RM {collectedTotal.toFixed(2)} / RM {receipt.total.toFixed(2)}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* torn bottom */}
        <div className="w-full h-3" style={{ background: 'repeating-linear-gradient(90deg, white 0px, white 8px, #e5e7eb 8px, #e5e7eb 10px)' }} />
      </div>
    </div>
  )
}
