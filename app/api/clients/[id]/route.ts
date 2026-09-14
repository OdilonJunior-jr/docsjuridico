import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function text(value: unknown) { return String(value ?? '').trim() }
function digits(value: unknown) { return text(value).replace(/\D/g, '') }

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

    const body = await request.json() as Record<string, unknown>
    const fullName = text(body.full_name)
    const cpf = text(body.cpf)
    const cpfNorm = digits(cpf)
    if (!fullName) return NextResponse.json({ error: 'Informe o nome do cliente.' }, { status: 400 })
    if (cpfNorm.length !== 11) return NextResponse.json({ error: 'Confira o CPF antes de salvar.' }, { status: 400 })
    const hasCompany = body.has_company === true

    const payload = {
      full_name: fullName,
      cpf,
      cpf_norm: cpfNorm,
      rg: text(body.rg) || null,
      nationality: text(body.nationality) || null,
      marital_status: text(body.marital_status) || null,
      profession: text(body.profession) || null,
      address_line: text(body.address_line) || null,
      address_number: text(body.address_number) || null,
      neighborhood: text(body.neighborhood) || null,
      city: text(body.city) || null,
      state: text(body.state).toUpperCase().slice(0, 2) || null,
      cep: text(body.cep) || null,
      company_name: hasCompany ? text(body.company_name) || null : null,
      cnpj: hasCompany ? text(body.cnpj) || null : null,
      company_address_line: hasCompany ? text(body.company_address_line) || null : null,
      company_address_number: hasCompany ? text(body.company_address_number) || null : null,
      company_neighborhood: hasCompany ? text(body.company_neighborhood) || null : null,
      company_city: hasCompany ? text(body.company_city) || null : null,
      company_state: hasCompany ? text(body.company_state).toUpperCase().slice(0, 2) || null : null,
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await supabase.from('clients').update(payload).eq('id', id).eq('owner_id', auth.user.id).select('id').maybeSingle()
    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: 'Já existe outro cliente com esse CPF.' }, { status: 409 })
      throw new Error(error.message)
    }
    if (!data) return NextResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Não foi possível atualizar o cliente.' }, { status: 500 })
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

    const { data: client } = await supabase.from('clients').select('id').eq('id', id).eq('owner_id', auth.user.id).maybeSingle()
    if (!client) return NextResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 })

    const [{ data: sources, error: sourceReadError }, { data: docs, error: docsReadError }] = await Promise.all([
      supabase.from('source_files').select('path').eq('client_id', id).eq('owner_id', auth.user.id),
      supabase.from('generated_documents').select('docx_path,pdf_path').eq('client_id', id).eq('owner_id', auth.user.id),
    ])
    if (sourceReadError) throw new Error(sourceReadError.message)
    if (docsReadError) throw new Error(docsReadError.message)

    const sourcePaths = (sources || []).map(row => row.path).filter(Boolean)
    const generatedPaths = (docs || []).flatMap(row => [row.docx_path, row.pdf_path]).filter((value): value is string => Boolean(value))
    if (sourcePaths.length) {
      const { error } = await supabase.storage.from('source-documents').remove(sourcePaths)
      if (error) throw new Error(`Não foi possível remover os arquivos enviados: ${error.message}`)
    }
    if (generatedPaths.length) {
      const { error } = await supabase.storage.from('generated-documents').remove(generatedPaths)
      if (error) throw new Error(`Não foi possível remover os documentos gerados: ${error.message}`)
    }

    const { error: deleteError } = await supabase.from('clients').delete().eq('id', id).eq('owner_id', auth.user.id)
    if (deleteError) throw new Error(deleteError.message)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Não foi possível excluir o cliente.' }, { status: 500 })
  }
}
