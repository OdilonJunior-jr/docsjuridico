import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { mergeExtractionCandidates, parseBrazilianDocumentText } from '@/lib/ocr-parser'
import type { ExtractionResult } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 45

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_FILE_SIZE = 980 * 1024
const TEST_OCRSPACE_KEY = 'helloworld'

type OcrSpaceResponse = {
  ParsedResults?: Array<{ ParsedText?: string; ErrorMessage?: string | string[]; FileParseExitCode?: number }>
  OCRExitCode?: number
  IsErroredOnProcessing?: boolean
  ErrorMessage?: string | string[]
  ErrorDetails?: string
}

type ProviderResult = { text: string; parsed: ExtractionResult }

function normalizeProviderError(payload: OcrSpaceResponse): string {
  const raw = payload.ErrorMessage || payload.ParsedResults?.[0]?.ErrorMessage || payload.ErrorDetails || 'O serviço de OCR não conseguiu processar a imagem.'
  return Array.isArray(raw) ? raw.filter(Boolean).join(' ') : String(raw)
}

async function runOcr(file: File, apiKey: string, engine: 2 | 3, kind: 'identity' | 'residence'): Promise<ProviderResult> {
  const upstream = new FormData()
  upstream.append('file', file, file.name || 'documento.jpg')
  upstream.append('language', 'por')
  upstream.append('OCREngine', String(engine))
  upstream.append('isOverlayRequired', 'false')
  upstream.append('detectOrientation', 'true')
  upstream.append('scale', 'true')

  const response = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST', headers: { apikey: apiKey }, body: upstream, cache: 'no-store',
  })
  let payload: OcrSpaceResponse
  try { payload = await response.json() as OcrSpaceResponse }
  catch { throw new Error(`Resposta inválida do OCR (${response.status}).`) }
  if (!response.ok || payload.IsErroredOnProcessing || (payload.OCRExitCode && payload.OCRExitCode !== 1)) {
    throw new Error(normalizeProviderError(payload))
  }
  const text = (payload.ParsedResults || []).map(item => item.ParsedText || '').join('\n').trim()
  return { text, parsed: parseBrazilianDocumentText(text, kind) }
}

function needsFallback(kind: 'identity' | 'residence', parsed: ExtractionResult) {
  return kind === 'identity'
    ? !parsed.nome || !parsed.cpf || !parsed.rg
    : !parsed.nome || !parsed.cep || !parsed.logradouro || !parsed.numero || !parsed.bairro || !parsed.cidade || !parsed.uf
}

async function enrichAddressByCep(parsed: ExtractionResult): Promise<ExtractionResult> {
  const cep = String(parsed.cep || '').replace(/\D/g, '')
  if (cep.length !== 8) return parsed
  try {
    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { cache: 'no-store' })
    if (!response.ok) return parsed
    const data = await response.json() as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string }
    if (data.erro) return parsed
    const parsedUf = String(parsed.uf || '').trim().toUpperCase()
    const apiUf = String(data.uf || '').trim().toUpperCase()
    const normalizePlace = (input: string) => input.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    const parsedCity = normalizePlace(String(parsed.cidade || ''))
    const apiCity = normalizePlace(String(data.localidade || ''))
    if (parsedUf && apiUf && parsedUf !== apiUf) return parsed
    if (parsedCity && apiCity && parsedCity !== apiCity && !parsedCity.includes(apiCity) && !apiCity.includes(parsedCity)) return parsed
    return {
      ...parsed,
      // CEP confirmado corrige grafia somente quando cidade/UF também são compatíveis.
      logradouro: data.logradouro?.trim() || parsed.logradouro || '',
      bairro: data.bairro?.trim() || parsed.bairro || '',
      cidade: data.localidade?.trim() || parsed.cidade || '',
      uf: apiUf || parsed.uf || '',
    }
  } catch { return parsed }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError || !authData.user) return NextResponse.json({ error: 'Sessão expirada. Entre novamente.' }, { status: 401 })

    const apiKey = process.env.OCRSPACE_API_KEY?.trim() || TEST_OCRSPACE_KEY
    const form = await request.formData()
    const file = form.get('file')
    const kindRaw = String(form.get('kind') || '')
    if (!(file instanceof File)) return NextResponse.json({ error: 'Imagem não enviada.' }, { status: 400 })
    if (!ALLOWED_MIME.has(file.type)) return NextResponse.json({ error: 'Formato não suportado pelo leitor.' }, { status: 400 })
    if (file.size <= 0 || file.size > MAX_FILE_SIZE) return NextResponse.json({ error: 'A imagem preparada para OCR excedeu o limite de 980 KB.' }, { status: 413 })
    if (kindRaw !== 'identity' && kindRaw !== 'residence') return NextResponse.json({ error: 'Tipo de documento inválido.' }, { status: 400 })
    const kind = kindRaw

    // Faz duas leituras sempre que possível: Engine 3 prioriza precisão e Engine 2 serve como
    // conferência independente. Isso ajuda a recuperar letras que um único OCR omitiu no nome/endereço.
    let primary: ProviderResult
    try { primary = await runOcr(file, apiKey, 3, kind) }
    catch { primary = await runOcr(file, apiKey, 2, kind) }

    let parsed = primary.parsed
    let text = primary.text
    if (kind === 'identity' || needsFallback(kind, parsed)) {
      try {
        const secondary = await runOcr(file, apiKey, 2, kind)
        parsed = mergeExtractionCandidates(parsed, secondary.parsed)
        text = [text, secondary.text].filter(Boolean).join('\n\n--- SEGUNDA LEITURA ---\n\n')
      } catch { /* mantém a melhor leitura já obtida */ }
    }

    if (kind === 'residence') parsed = await enrichAddressByCep(parsed)
    if (!text.trim()) return NextResponse.json({ ok: true, text: '', parsed: {} })

    const safeParsed = kind === 'identity'
      ? { nome: parsed.nome || '', nacionalidade: parsed.nacionalidade || '', cpf: parsed.cpf || '', rg: parsed.rg || '', rawText: text }
      : { nome: parsed.nome || '', cpf: parsed.cpf || '', logradouro: parsed.logradouro || '', numero: parsed.numero || '', bairro: parsed.bairro || '', cidade: parsed.cidade || '', uf: parsed.uf || '', cep: parsed.cep || '', rawText: text }

    return NextResponse.json({ ok: true, text, parsed: safeParsed })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha inesperada no OCR.'
    return NextResponse.json({ error: `Falha no serviço de OCR: ${message}` }, { status: 502 })
  }
}
