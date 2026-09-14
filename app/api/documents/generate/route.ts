import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateDocx, generatePdf } from '@/lib/document-templates'
import type { CompanyData, DocumentKind, PersonData } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 45

function normalizedDigits(value: string) { return String(value || '').replace(/\D/g, '') }
function present(value: unknown) { return String(value ?? '').trim() }

function validatePayload(person: PersonData, company: CompanyData, includeCompany: boolean) {
  const requiredPerson: Array<[keyof PersonData, string]> = [
    ['nome','Nome'], ['nacionalidade','Nacionalidade'], ['estadoCivil','Estado civil'], ['profissao','Profissão'],
    ['cpf','CPF'], ['rg','RG'], ['logradouro','Logradouro'], ['numero','Número'], ['bairro','Bairro'],
    ['cidade','Cidade'], ['uf','UF'], ['cep','CEP'],
  ]
  const missingPerson = requiredPerson.filter(([key]) => !present(person?.[key])).map(([, label]) => label)
  const missingCompany: string[] = []
  if (includeCompany) {
    const requiredCompany: Array<[keyof CompanyData, string]> = [
      ['empresaNome','Razão social'], ['cnpj','CNPJ'], ['empresaLogradouro','Logradouro da empresa'],
      ['empresaNumero','Número da empresa'], ['empresaBairro','Bairro da empresa'], ['empresaCidade','Cidade da empresa'], ['empresaUf','UF da empresa'],
    ]
    missingCompany.push(...requiredCompany.filter(([key]) => !present(company?.[key])).map(([, label]) => label))
  }
  if (missingPerson.length || missingCompany.length) {
    throw new Error(`Preencha antes de gerar: ${[...missingPerson, ...missingCompany].join(', ')}.`)
  }
  const cpfNorm = normalizedDigits(person.cpf)
  if (cpfNorm.length !== 11) throw new Error('CPF deve ser conferido antes da geração.')
  if (includeCompany) {
    const cnpjNorm = normalizedDigits(company.cnpj)
    if (cnpjNorm.length !== 14) throw new Error('CNPJ deve ser conferido antes da geração.')
  }
  return { cpfNorm }
}

type GeneratedFile = {
  kind: DocumentKind
  format: 'docx' | 'pdf'
  path: string
  filename: string
  url?: string
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError || !authData.user) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

    const body = await request.json() as {
      person: PersonData
      company: CompanyData
      includeCompany?: boolean
      sourcePaths?: Array<{ kind: 'identity' | 'residence'; path: string; mimeType: string; originalName: string }>
    }
    const includeCompany = body.includeCompany === true
    const { cpfNorm } = validatePayload(body.person, body.company, includeCompany)

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
      ...(includeCompany ? {
        company_name: body.company.empresaNome.trim(),
        cnpj: body.company.cnpj.trim(),
        company_address_line: body.company.empresaLogradouro.trim(),
        company_address_number: body.company.empresaNumero.trim(),
        company_neighborhood: body.company.empresaBairro.trim(),
        company_city: body.company.empresaCidade.trim(),
        company_state: body.company.empresaUf.trim().toUpperCase(),
      } : {}),
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

    const procId = crypto.randomUUID()
    const procBase = `${authData.user.id}/${client.id}/${procId}`
    const [procDocx, procPdf] = await Promise.all([
      generateDocx('procuracao', body.person),
      generatePdf('procuracao', body.person),
    ])

    const files: Array<GeneratedFile & { bytes: Buffer; contentType: string }> = [
      { kind: 'procuracao', format: 'docx', path: `${procBase}/procuracao.docx`, filename: 'procuracao.docx', bytes: procDocx, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      { kind: 'procuracao', format: 'pdf', path: `${procBase}/procuracao.pdf`, filename: 'procuracao.pdf', bytes: procPdf, contentType: 'application/pdf' },
    ]

    let declId: string | null = null
    if (includeCompany) {
      declId = crypto.randomUUID()
      const declBase = `${authData.user.id}/${client.id}/${declId}`
      const [declDocx, declPdf] = await Promise.all([
        generateDocx('hipossuficiencia', body.person, body.company),
        generatePdf('hipossuficiencia', body.person, body.company),
      ])
      files.push(
        { kind: 'hipossuficiencia', format: 'docx', path: `${declBase}/declaracao_hipossuficiencia.docx`, filename: 'declaracao_hipossuficiencia.docx', bytes: declDocx, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { kind: 'hipossuficiencia', format: 'pdf', path: `${declBase}/declaracao_hipossuficiencia.pdf`, filename: 'declaracao_hipossuficiencia.pdf', bytes: declPdf, contentType: 'application/pdf' },
      )
    }

    const uploadedPaths:string[] = []
    try {
      for (const file of files) {
        const { error: uploadError } = await supabase.storage
          .from('generated-documents')
          .upload(file.path, file.bytes, { contentType: file.contentType, upsert: false })
        if (uploadError) throw new Error(`Falha ao armazenar ${file.filename}: ${uploadError.message}`)
        uploadedPaths.push(file.path)
      }
    } catch (uploadFailure) {
      if (uploadedPaths.length) await supabase.storage.from('generated-documents').remove(uploadedPaths)
      throw uploadFailure
    }

    const documentRows: Array<{ id:string; owner_id:string; client_id:string; kind:DocumentKind; docx_path:string; pdf_path:string }> = [
      {
        id: procId,
        owner_id: authData.user.id,
        client_id: client.id,
        kind: 'procuracao',
        docx_path: `${procBase}/procuracao.docx`,
        pdf_path: `${procBase}/procuracao.pdf`,
      },
    ]
    if (includeCompany && declId) {
      const declBase = `${authData.user.id}/${client.id}/${declId}`
      documentRows.push({
        id: declId,
        owner_id: authData.user.id,
        client_id: client.id,
        kind: 'hipossuficiencia',
        docx_path: `${declBase}/declaracao_hipossuficiencia.docx`,
        pdf_path: `${declBase}/declaracao_hipossuficiencia.pdf`,
      })
    }
    const { error: docInsertError } = await supabase.from('generated_documents').insert(documentRows)
    if (docInsertError) {
      await supabase.storage.from('generated-documents').remove(uploadedPaths)
      throw new Error(docInsertError.message)
    }

    const responseFiles: GeneratedFile[] = []
    for (const file of files) {
      const { data: signed, error: signedError } = await supabase.storage.from('generated-documents').createSignedUrl(file.path, 300)
      if (signedError || !signed?.signedUrl) throw new Error(`Arquivos gerados, mas não foi possível criar o link de ${file.filename}.`)
      responseFiles.push({ kind: file.kind, format: file.format, path: file.path, filename: file.filename, url: signed.signedUrl })
    }

    return NextResponse.json({ ok: true, documentIds: { procuracao: procId, hipossuficiencia: declId }, files: responseFiles })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha inesperada ao gerar documentos.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
