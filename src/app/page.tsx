'use client'

import { useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { extractTextFromImage, parseReceiptText, ParsedItem } from '@/lib/ocr'
import { Loader2, Trash2, Plus, Upload } from 'lucide-react'

type Step = 'upload' | 'review' | 'qr' | 'share'

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
      const parsed = parseReceiptText(text)
      setItems(parsed.length ? parsed : [{ item_name: '', quantity: 1, price: 0 }])
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
        const { error: uploadError } = await supabase.storage
          .from('qr-images')
          .upload(fileName, qrFile, { upsert: true })
        if (!uploadError) {
          const { data } = supabase.storage.from('qr-images').getPublicUrl(fileName)
          qrImageUrl = data.publicUrl
        }
      }

      const { data: receipt, error: receiptError } = await supabase
        .from('receipts')
        .insert({ title: receiptTitle, subtotal, tax, total, qr_image_url: qrImageUrl })
        .select()
        .single()

      if (receiptError || !receipt) throw receiptError

      const itemRows = items
        .filter(i => i.item_name.trim())
        .map(i => ({ receipt_id: receipt.id, item_name: i.item_name, quantity: i.quantity, price: i.price }))

      if (itemRows.length) {
        await supabase.from('receipt_items').insert(itemRows)
      }

      const link = `${window.location.origin}/r/${receipt.id}`
      setShareLink(link)
      setStep('share')
    } catch (err) {
      console.error(err)
      alert('Failed to save receipt. Check your Supabase config.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-10 px-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow p-6 space-y-6">
        <h1 className="text-2xl font-bold text-center text-indigo-600">BayarLah 🧾</h1>

        {/* STEP: Upload */}
        {step === 'upload' && (
          <div className="flex flex-col items-center gap-4">
            <p className="text-gray-600 text-center">Upload a receipt image to get started</p>
            <button
              onClick={() => receiptInputRef.current?.click()}
              disabled={ocrLoading}
              className="flex items-center gap-2 bg-indigo-600 text-white px-6 py-3 rounded-xl hover:bg-indigo-700 disabled:opacity-50"
            >
              {ocrLoading ? <Loader2 className="animate-spin" size={18} /> : <Upload size={18} />}
              {ocrLoading ? 'Scanning...' : 'Upload Receipt'}
            </button>
            <input ref={receiptInputRef} type="file" accept="image/*" className="hidden" onChange={handleReceiptUpload} />
            <button
              onClick={() => { setItems([{ item_name: '', quantity: 1, price: 0 }]); setStep('review') }}
              className="text-sm text-indigo-500 underline"
            >
              Enter items manually
            </button>
          </div>
        )}

        {/* STEP: Review Items */}
        {step === 'review' && (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Receipt Title</label>
              <input
                value={receiptTitle}
                onChange={e => setReceiptTitle(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>

            <div className="space-y-2">
              <div className="grid grid-cols-12 gap-1 text-xs font-semibold text-gray-500 px-1">
                <span className="col-span-5">Item</span>
                <span className="col-span-2 text-center">Qty</span>
                <span className="col-span-3 text-right">Price (RM)</span>
                <span className="col-span-2" />
              </div>
              {items.map((item, i) => (
                <div key={i} className="grid grid-cols-12 gap-1 items-center">
                  <input
                    value={item.item_name}
                    onChange={e => updateItem(i, 'item_name', e.target.value)}
                    placeholder="Item name"
                    className="col-span-5 border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                  <input
                    type="number" min={1}
                    value={item.quantity}
                    onChange={e => updateItem(i, 'quantity', parseInt(e.target.value) || 1)}
                    className="col-span-2 border rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                  <input
                    type="number" min={0} step={0.01}
                    value={item.price}
                    onChange={e => updateItem(i, 'price', parseFloat(e.target.value) || 0)}
                    className="col-span-3 border rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                  <button onClick={() => removeItem(i)} className="col-span-2 flex justify-center text-red-400 hover:text-red-600">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <button onClick={addItem} className="flex items-center gap-1 text-sm text-indigo-500 hover:text-indigo-700">
                <Plus size={14} /> Add item
              </button>
            </div>

            <div className="flex items-center gap-2 text-sm">
              <label className="text-gray-600 w-24">Tax (RM)</label>
              <input
                type="number" min={0} step={0.01}
                value={tax}
                onChange={e => setTax(parseFloat(e.target.value) || 0)}
                className="border rounded-lg px-3 py-1.5 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>

            <div className="text-right text-sm text-gray-700 space-y-1">
              <p>Subtotal: <strong>RM {subtotal.toFixed(2)}</strong></p>
              <p>Tax: <strong>RM {tax.toFixed(2)}</strong></p>
              <p className="text-base font-bold text-indigo-700">Total: RM {total.toFixed(2)}</p>
            </div>

            <button onClick={() => setStep('qr')} className="w-full bg-indigo-600 text-white py-2.5 rounded-xl hover:bg-indigo-700">
              Next: Upload Payment QR →
            </button>
          </div>
        )}

        {/* STEP: QR Upload */}
        {step === 'qr' && (
          <div className="space-y-4 flex flex-col items-center">
            <p className="text-gray-600 text-center text-sm">Upload your DuitNow / TNG payment QR code</p>
            {qrPreview && <img src={qrPreview} alt="QR Preview" className="w-48 h-48 object-contain border rounded-xl" />}
            <button
              onClick={() => qrInputRef.current?.click()}
              className="flex items-center gap-2 border border-indigo-400 text-indigo-600 px-5 py-2.5 rounded-xl hover:bg-indigo-50"
            >
              <Upload size={16} /> {qrPreview ? 'Change QR Image' : 'Upload QR Image'}
            </button>
            <input ref={qrInputRef} type="file" accept="image/*" className="hidden" onChange={handleQrChange} />
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-indigo-600 text-white py-2.5 rounded-xl hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving && <Loader2 className="animate-spin" size={16} />}
              {saving ? 'Saving...' : 'Generate Share Link'}
            </button>
            <button onClick={() => setStep('review')} className="text-sm text-gray-400 underline">← Back</button>
          </div>
        )}

        {/* STEP: Share */}
        {step === 'share' && (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="text-5xl">🎉</div>
            <h2 className="text-xl font-semibold text-gray-800">Receipt Ready!</h2>
            <p className="text-sm text-gray-500">Share this link with your friends:</p>
            <div className="w-full bg-gray-100 rounded-xl px-4 py-3 text-sm font-mono break-all text-indigo-700">
              {shareLink}
            </div>
            <button
              onClick={() => { navigator.clipboard.writeText(shareLink); alert('Link copied!') }}
              className="w-full bg-indigo-600 text-white py-2.5 rounded-xl hover:bg-indigo-700"
            >
              Copy Link
            </button>
            <button onClick={() => { setStep('upload'); setItems([]); setShareLink(''); setQrPreview(null); setQrFile(null) }}
              className="text-sm text-gray-400 underline">
              Create another receipt
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
