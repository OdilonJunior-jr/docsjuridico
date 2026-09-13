import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseBrazilianDocumentText } from '@/lib/ocr-parser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_FILE_SIZE = 4 * 1024 * 1024
const BUNDLED_GOOGLE_CLOUD_VISION_API_KEY = 'AIzaSyA_ANVyUdQAE2Q41MWmnsPhK6X9fiTkVmc'

type VisionResponse = {
  responses?: Array<{
    fullTextAnnotation?: { text?: string }
    textAnnotations?: Array<{ description?: string }>
    error?: { code?: number; message?: string }
  }>
  error?: { code?: number; message?: string }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError || !authData.user) {
      return NextResponse.json({ error: 'Sessão expirada. Entre novamente.' }, { status: 401 })
    }

    const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY?.trim() || BUNDLED_GOOGLE_CLOUD_VISION_API_KEY
    if (!apiKey) {
      return NextResponse.json({
        error: 'OCR não está configurado no servidor.',
      }, { status: 503 })
    }

    const form = await request.formData()
    const file = form.get('file')
    const kind = String(form.get('kind') || '')
    if (!(file instanceof File)) return NextResponse.json({ error: 'Imagem não enviada.' }, { status: 400 })
    if (!ALLOWED_MIME.has(file.type)) return NextResponse.json({ error: 'Formato não suportado pelo leitor.' }, { status: 400 })
    if (file.size <= 0 || file.size > MAX_FILE_SIZE) return NextResponse.json({ error: 'A imagem preparada para OCR excedeu o limite de 4 MB.' }, { status: 413 })
    if (!['identity', 'residence'].includes(kind)) return NextResponse.json({ error: 'Tipo de documento inválido.' }, { status: 400 })

    const bytes = Buffer.from(await file.arrayBuffer())
    const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { content: bytes.toString('base64') },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
          imageContext: { languageHints: ['pt', 'en'] },
        }],
      }),
      cache: 'no-store',
    })

    const payload = await response.json() as VisionResponse
    const item = payload.responses?.[0]
    const providerError = item?.error?.message || payload.error?.message
    if (!response.ok || providerError) {
      const message = providerError || `Google Vision respondeu com status ${response.status}.`
      return NextResponse.json({ error: `Falha no serviço de OCR: ${message}` }, { status: 502 })
    }

    const text = (item?.fullTextAnnotation?.text || item?.textAnnotations?.[0]?.description || '').trim()
    if (!text) return NextResponse.json({ ok: true, text: '', parsed: {} })

    const all = parseBrazilianDocumentText(text)
    const parsed = kind === 'identity'
      ? { nome: all.nome || '', cpf: all.cpf || '', rg: all.rg || '', rawText: text }
      : { logradouro: all.logradouro || '', numero: all.numero || '', bairro: all.bairro || '', cidade: all.cidade || '', uf: all.uf || '', cep: all.cep || '', rawText: text }
    // Não persistimos nem registramos o texto OCR aqui. Ele existe apenas durante esta requisição.
    return NextResponse.json({ ok: true, text, parsed })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha inesperada no OCR.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
