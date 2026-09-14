import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseBrazilianDocumentText } from '@/lib/ocr-parser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_FILE_SIZE = 950 * 1024
const TEST_OCRSPACE_KEY = 'helloworld'

type OcrSpaceResponse = {
  ParsedResults?: Array<{
    ParsedText?: string
    ErrorMessage?: string | string[]
    FileParseExitCode?: number
  }>
  OCRExitCode?: number
  IsErroredOnProcessing?: boolean
  ErrorMessage?: string | string[]
  ErrorDetails?: string
  ProcessingTimeInMilliseconds?: string
}

function normalizeProviderError(payload: OcrSpaceResponse): string {
  const raw = payload.ErrorMessage
    || payload.ParsedResults?.[0]?.ErrorMessage
    || payload.ErrorDetails
    || 'O serviço de OCR não conseguiu processar a imagem.'
  return Array.isArray(raw) ? raw.filter(Boolean).join(' ') : String(raw)
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError || !authData.user) {
      return NextResponse.json({ error: 'Sessão expirada. Entre novamente.' }, { status: 401 })
    }

    // Para teste imediato usamos a chave pública de demonstração do OCR.Space.
    // Se OCRSPACE_API_KEY existir na Vercel, ela tem prioridade automaticamente.
    const apiKey = process.env.OCRSPACE_API_KEY?.trim() || TEST_OCRSPACE_KEY

    const form = await request.formData()
    const file = form.get('file')
    const kind = String(form.get('kind') || '')

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Imagem não enviada.' }, { status: 400 })
    }
    if (!ALLOWED_MIME.has(file.type)) {
      return NextResponse.json({ error: 'Formato não suportado pelo leitor.' }, { status: 400 })
    }
    if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'A imagem preparada para OCR excedeu o limite de teste de 950 KB.' }, { status: 413 })
    }
    if (!['identity', 'residence'].includes(kind)) {
      return NextResponse.json({ error: 'Tipo de documento inválido.' }, { status: 400 })
    }

    const upstream = new FormData()
    upstream.append('file', file, file.name || 'documento.jpg')
    upstream.append('language', 'auto')
    upstream.append('OCREngine', '2')
    upstream.append('isOverlayRequired', 'false')
    upstream.append('detectOrientation', 'true')
    upstream.append('scale', 'true')

    const response = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      headers: { apikey: apiKey },
      body: upstream,
      cache: 'no-store',
    })

    let payload: OcrSpaceResponse
    try {
      payload = await response.json() as OcrSpaceResponse
    } catch {
      return NextResponse.json({ error: `Falha no serviço de OCR: resposta inválida (${response.status}).` }, { status: 502 })
    }

    if (!response.ok || payload.IsErroredOnProcessing || (payload.OCRExitCode && payload.OCRExitCode !== 1)) {
      return NextResponse.json({ error: `Falha no serviço de OCR: ${normalizeProviderError(payload)}` }, { status: 502 })
    }

    const text = (payload.ParsedResults || [])
      .map(item => item.ParsedText || '')
      .join('\n')
      .trim()

    if (!text) return NextResponse.json({ ok: true, text: '', parsed: {} })

    const all = parseBrazilianDocumentText(text)
    const parsed = kind === 'identity'
      ? {
          nome: all.nome || '',
          cpf: all.cpf || '',
          rg: all.rg || '',
          rawText: text,
        }
      : {
          logradouro: all.logradouro || '',
          numero: all.numero || '',
          bairro: all.bairro || '',
          cidade: all.cidade || '',
          uf: all.uf || '',
          cep: all.cep || '',
          rawText: text,
        }

    return NextResponse.json({ ok: true, text, parsed })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha inesperada no OCR.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
