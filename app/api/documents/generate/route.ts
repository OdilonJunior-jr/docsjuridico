import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { convertDocxToPdf, generateDocx } from '@/lib/document-templates'
import type { CompanyData, DocumentKind, PersonData } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function normalizedDigits(value: string) { return String(value || '').replace(/\D/g, '') }
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError || !authData.user) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

    const body = await request.json() as {
      kind: DocumentKind
      person: PersonData
      company?: CompanyData
      output: 'docx' | 'pdf'
      sourcePaths?: Array<{ kind: 'identity' | 'residence'; path: string; mimeType: string; originalName: string }>
    }

    if (!['procuracao', 'hipossuficiencia'].includes(body.kind)) return NextResponse.json({ error: 'Tipo de documento inválido.' }, { status: 400 })
    if (!['docx', 'pdf'].includes(body.output)) return NextResponse.json({ error: 'Formato inválido.' }, { status: 400 })

    const cpfNorm = normalizedDigits(body.person?.cpf)
    if (cpfNorm.length !== 11) return NextResponse.json({ error: 'CPF deve ser conferido antes da geração.' }, { status: 400 })

    const clientPayload = {
      owner_id: authData.user.id,
      full_name: body.person.nome.trim(),
      cpf: body.person.cpf.trim(),
      cpf_norm: cpfNorm,
      rg: body.person.rg.trim(),
      nationality: body.person.nacionalidade.trim(),
      marital_status: body.person.estadoCivil.trim(),
      profession: body.person.profissao.trim(),
      address_line: body.person.logradouro.trim(),
      address_number: body.person.numero.trim(),
      neighborhood: body.person.bairro.trim(),
      city: body.person.cidade.trim(),
      state: body.person.uf.trim().toUpperCase(),
      cep: body.person.cep.trim(),
      company_name: body.company?.empresaNome?.trim() || null,
      cnpj: body.company?.cnpj?.trim() || null,
      company_address_line: body.company?.empresaLogradouro?.trim() || null,
      company_address_number: body.company?.empresaNumero?.trim() || null,
      company_neighborhood: body.company?.empresaBairro?.trim() || null,
      company_city: body.company?.empresaCidade?.trim() || null,
      company_state: body.company?.empresaUf?.trim().toUpperCase() || null,
      updated_at: new Date().toISOString(),
    }

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .upsert(clientPayload, { onConflict: 'owner_id,cpf_norm' })
      .select('id')
      .single()
    if (clientError || !client) throw new Error(clientError?.message || 'Não foi possível salvar o cliente.')

    if (body.sourcePaths?.length) {
      const sourceRows = body.sourcePaths.map((source) => ({
        owner_id: authData.user.id,
        client_id: client.id,
        kind: source.kind,
        path: source.path,
        mime_type: source.mimeType,
        original_name: source.originalName,
      }))
      const { error: sourceError } = await supabase.from('source_files').upsert(sourceRows, { onConflict: 'owner_id,path' })
      if (sourceError) throw new Error(sourceError.message)
    }

    const docx = await generateDocx(body.kind, body.person, body.company)
    const documentId = crypto.randomUUID()
    const base = `${authData.user.id}/${client.id}/${documentId}`
    const kindSlug = body.kind === 'procuracao' ? 'procuracao' : 'declaracao_hipossuficiencia'
    const docxPath = `${base}/${kindSlug}.docx`
    const pdfPath = `${base}/${kindSlug}.pdf`

    const { error: docxUploadError } = await supabase.storage
      .from('generated-documents')
      .upload(docxPath, docx, { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', upsert: false })
    if (docxUploadError) throw new Error(docxUploadError.message)

    let pdf: Buffer | null = null
    if (body.output === 'pdf') {
      pdf = await convertDocxToPdf(docx, `${kindSlug}.docx`)
      const { error: pdfUploadError } = await supabase.storage
        .from('generated-documents')
        .upload(pdfPath, pdf, { contentType: 'application/pdf', upsert: false })
      if (pdfUploadError) throw new Error(pdfUploadError.message)
    }

    const { error: docInsertError } = await supabase.from('generated_documents').insert({
      id: documentId,
      owner_id: authData.user.id,
      client_id: client.id,
      kind: body.kind,
      docx_path: docxPath,
      pdf_path: pdf ? pdfPath : null,
    })
    if (docInsertError) throw new Error(docInsertError.message)

    const requestedPath = body.output === 'pdf' ? pdfPath : docxPath
    const { data: signed, error: signedError } = await supabase.storage.from('generated-documents').createSignedUrl(requestedPath, 120)
    if (signedError || !signed?.signedUrl) throw new Error('Documento gerado, mas não foi possível criar o link de download.')

    return NextResponse.json({ ok: true, documentId, url: signed.signedUrl, filename: requestedPath.split('/').pop() })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha inesperada ao gerar documento.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
