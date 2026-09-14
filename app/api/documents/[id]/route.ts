import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

    const { data: doc, error: readError } = await supabase
      .from('generated_documents')
      .select('id,docx_path,pdf_path')
      .eq('id', id)
      .eq('owner_id', auth.user.id)
      .maybeSingle()
    if (readError) throw new Error(readError.message)
    if (!doc) return NextResponse.json({ error: 'Documento não encontrado.' }, { status: 404 })

    const paths = [doc.docx_path, doc.pdf_path].filter((value): value is string => Boolean(value))
    if (paths.length) {
      const { error } = await supabase.storage.from('generated-documents').remove(paths)
      if (error) throw new Error(`Não foi possível remover os arquivos: ${error.message}`)
    }
    const { error: deleteError } = await supabase.from('generated_documents').delete().eq('id', id).eq('owner_id', auth.user.id)
    if (deleteError) throw new Error(deleteError.message)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Não foi possível excluir o documento.' }, { status: 500 })
  }
}
