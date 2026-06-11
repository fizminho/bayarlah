'use client'

import { useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { extractTextFromImage, parseReceiptText, ParsedItem } from '@/lib/ocr'
import { Loader2, Trash2, Plus, Upload } from 'lucide-react'

type Step = 'upload' | 'review' | 'qr' | 'share'

function ReceiptShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-200 flex flex-col items-center py-8 px-3">
      <div className="w-full max-w-sm bg-white shadow-xl" style={{ fontFamily: "'Courier New', Courier, monospace" }}>
        {/* torn top edge */}
        <div className="w-full overflow-hidden h-3" style={{ background: 'repeating-linear-gradient(90deg, white 0px, white 8px, #e5e7eb 8px, #e5e7eb 10px)' }} />
        <div className="px-5 pb-6 pt-2 space-y-4">
          {children}
        </div>
        {/* torn bottom edge */}
        <div className="w-full overflow-hidden h-3" style={{ background: 'repeating-linear-gradient(90deg, white 0px, white 8px, #e5e7eb 8px, #e5e7eb 10px)' }} />
      </div>
    </div>
  )
}

function Divider() {
  return <div className="border-t border-dashed border-gray-400 my-2" />
}

function ReceiptHeader({ title }: { title?: string }) {
  return (
    <div className="text-center space-y-0.5 pt-2">
      <p className="text-xl font-bold tracking-widest">BayarLah</p>
      <p className="text-xs tracking-widest text-gray-500">SPLIT YOUR BILL</p>
      {title && <p className="text-sm font-semibold mt-1">{title}</p>}
    </div>
  )
}

export default function Home() {
  const [step, setStep] = useState<Step>('upload')
  const [ocrLoading, setOcrLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const [receiptTitle, setReceiptTitle] = useState('My Receipt')
  const [items, setItems] = useState<ParsedItem[]>([])
  const [tax, setTax] = useState(0)

  const [qrFile, setQrFile] = useState<File | null>(null)
  const [qrPreview, setQrPreview] = useState<string | null>(null)
  const [shareLink, setShareLink] = useState('')

  const receiptInputRef = useRef<HTMLInputElement>(null)
  const qrInputRef = useRef<HTMLInputElement>(null)

  async function handleReceiptUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setOcrLoading(true)
    try {
      const text = await extractTextFromImage(file)
      const { items: parsed, tax: parsedTax } = parseReceiptText(text)
      setItems(Array.isArray(parsed) && parsed.length ? parsed : [{ item_name: '', quantity: 1, price: 0 }])
      if (parsedTax > 0) setTax(parsedTax)
      setStep('review')
    } catch {
      alert('OCR failed. Please try again or add items manually.')
      setItems([{ item_name: '', quantity: 1, price: 0 }])
      setStep('review')
    } finally {
      setOcrLoading(false)
    }
  }

  function updateItem(index: number, field: keyof ParsedItem, value: string | number) {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item))
  }

  function addItem() {
    setItems(prev => [...prev, { item_name: '', quantity: 1, price: 0 }])
  }

  function removeItem(index: number) {
    setItems(prev => prev.filter((_, i) => i !== index))
  }

  function handleQrChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setQrFile(file)
    setQrPreview(URL.createObjectURL(file))
  }

  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const total = subtotal + tax

  async function handleSave() {
    setSaving(true)
    try {
      let qrImageUrl: string | null = null
      if (qrFile) {
        const ext = qrFile.name.split('.').pop()
        const fileName = `qr_${Date.now()}.${ext}`
        const { error: uploadError } = await supabase.storage.from('qr-images').upload(fileName, qrFile, { upsert: true })
        if (!uploadError) {
          const { data } = supabase.storage.from('qr-images').getPublicUrl(fileName)
          qrImageUrl = data.publicUrl
        }
      }

      const { data: receipt, error: receiptError } = await supabase
        .from('receipts')
        .insert({ title: receiptTitle, subtotal, tax, total, qr_image_url: qrImageUrl })
        .select().single()

      if (receiptError || !receipt) throw receiptError

      const itemRows = items
        .filter(i => i.item_name.trim())
        .map(i => ({ receipt_id: receipt.id, item_name: i.item_name, quantity: i.quantity, price: i.price }))

      if (itemRows.length) await supabase.from('receipt_items').insert(itemRows)

      setShareLink(`${window.location.origin}/r/${receipt.id}`)
      setStep('share')
    } catch (err) {
      console.error(err)
      alert('Failed to save receipt. Check your Supabase config.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ReceiptShell>
      <ReceiptHeader title={step !== 'upload' ? receiptTitle : undefined} />
      <Divider />

      {/* STEP: Upload */}
      {step === 'upload' && (
        <div className="flex flex-col items-center gap-4 py-4">
          <p className="text-xs text-gray-500 text-center tracking-wide">UPLOAD RECEIPT IMAGE TO BEGIN</p>
          <button
            onClick={() => receiptInputRef.current?.click()}
            disabled={ocrLoading}
            className="flex items-center gap-2 bg-black text-white text-sm px-6 py-3 w-full justify-center hover:bg-gray-800 disabled:opacity-50"
          >
            {ocrLoading ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}
            {ocrLoading ? 'SCANNING...' : 'UPLOAD RECEIPT'}
          </button>
          <input ref={receiptInputRef} type="file" accept="image/*" className="hidden" onChange={handleReceiptUpload} />
          <Divider />
          <button
            onClick={() => { setItems([{ item_name: '', quantity: 1, price: 0 }]); setStep('review') }}
            className="text-xs text-gray-400 underline tracking-wide"
          >
            ENTER ITEMS MANUALLY
          </button>
        </div>
      )}

      {/* STEP: Review Items */}
      {step === 'review' && (
        <div className="space-y-3">
          <input
            value={receiptTitle}
            onChange={e => setReceiptTitle(e.target.value)}
            className="w-full text-center text-sm font-bold border-b border-dashed border-gray-300 pb-1 focus:outline-none bg-transparent"
          />
          <Divider />

          {/* Column headers */}
          <div className="flex text-xs text-gray-400 tracking-wide px-0.5">
            <span className="flex-1">ITEM</span>
            <span className="w-8 text-center">QTY</span>
            <span className="w-20 text-right">PRICE</span>
            <span className="w-6" />
          </div>

          {/* Items */}
          <div className="space-y-2">
            {items.map((item, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-center gap-1">
                  <input
                    value={item.item_name}
                    onChange={e => updateItem(i, 'item_name', e.target.value)}
                    placeholder="Item name"
                    className="flex-1 text-sm border-b border-gray-200 focus:outline-none focus:border-gray-500 bg-transparent py-0.5 min-w-0"
                  />
                  <input
                    type="number" min={1}
                    value={item.quantity}
                    onChange={e => updateItem(i, 'quantity', parseInt(e.target.value) || 1)}
                    className="w-8 text-center text-sm border-b border-gray-200 focus:outline-none focus:border-gray-500 bg-transparent py-0.5"
                  />
                  <input
                    type="number" min={0} step={0.01}
                    value={item.price}
                    onChange={e => updateItem(i, 'price', parseFloat(e.target.value) || 0)}
                    className="w-20 text-right text-sm border-b border-gray-200 focus:outline-none focus:border-gray-500 bg-transparent py-0.5"
                  />
                  <button onClick={() => removeItem(i)} className="w-6 flex justify-center text-red-300 hover:text-red-500 shrink-0">
                    <Trash2 size={13} />
                  </button>
                </div>
                {item.quantity > 1 && item.price > 0 && (
                  <p className="text-xs text-gray-400 text-right pr-7">
                    = RM {(item.price * item.quantity).toFixed(2)}
                  </p>
                )}
              </div>
            ))}
          </div>

          <button onClick={addItem} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 tracking-wide">
            <Plus size={12} /> ADD ITEM
          </button>

          <Divider />

          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>TAX / SERVICE (RM)</span>
            <input
              type="number" min={0} step={0.01}
              value={tax}
              onChange={e => setTax(parseFloat(e.target.value) || 0)}
              className="w-20 text-right border-b border-gray-200 focus:outline-none bg-transparent text-sm"
            />
          </div>

          <Divider />

          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-gray-500 text-xs">
              <span>SUBTOTAL</span>
              <span>RM {subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-gray-500 text-xs">
              <span>TAX</span>
              <span>RM {tax.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-bold text-base pt-1">
              <span>TOTAL</span>
              <span>RM {total.toFixed(2)}</span>
            </div>
          </div>

          <Divider />

          <button onClick={() => setStep('qr')} className="w-full bg-black text-white text-sm py-3 hover:bg-gray-800 tracking-wide">
            NEXT: ADD PAYMENT QR →
          </button>
        </div>
      )}

      {/* STEP: QR Upload */}
      {step === 'qr' && (
        <div className="flex flex-col items-center gap-4 py-2">
          <p className="text-xs text-gray-400 text-center tracking-wide">UPLOAD DUITNOW / TNG QR CODE</p>
          {qrPreview && <img src={qrPreview} alt="QR Preview" className="w-44 h-44 object-contain border border-dashed border-gray-300" />}
          <button
            onClick={() => qrInputRef.current?.click()}
            className="flex items-center gap-2 border border-gray-400 text-gray-700 text-xs px-5 py-2.5 w-full justify-center hover:bg-gray-50 tracking-wide"
          >
            <Upload size={14} /> {qrPreview ? 'CHANGE QR IMAGE' : 'UPLOAD QR IMAGE'}
          </button>
          <input ref={qrInputRef} type="file" accept="image/*" className="hidden" onChange={handleQrChange} />
          <Divider />
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full bg-black text-white text-sm py-3 hover:bg-gray-800 disabled:opacity-50 flex items-center justify-center gap-2 tracking-wide"
          >
            {saving && <Loader2 className="animate-spin" size={14} />}
            {saving ? 'SAVING...' : 'GENERATE SHARE LINK'}
          </button>
          <button onClick={() => setStep('review')} className="text-xs text-gray-400 underline tracking-wide">← BACK</button>
        </div>
      )}

      {/* STEP: Share */}
      {step === 'share' && (
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <p className="text-2xl">🎉</p>
          <p className="text-sm font-bold tracking-widest">RECEIPT READY!</p>
          <p className="text-xs text-gray-400 tracking-wide">SHARE THIS LINK WITH YOUR FRIENDS</p>
          <Divider />
          <p className="text-xs font-mono break-all text-gray-700 bg-gray-50 w-full px-3 py-2 border border-dashed border-gray-300">{shareLink}</p>
          <button
            onClick={() => { navigator.clipboard.writeText(shareLink); alert('Link copied!') }}
            className="w-full bg-black text-white text-sm py-3 hover:bg-gray-800 tracking-wide"
          >
            COPY LINK
          </button>
          <button
            onClick={() => { setStep('upload'); setItems([]); setShareLink(''); setQrPreview(null); setQrFile(null) }}
            className="text-xs text-gray-400 underline tracking-wide"
          >
            CREATE ANOTHER RECEIPT
          </button>
        </div>
      )}
    </ReceiptShell>
  )
}
