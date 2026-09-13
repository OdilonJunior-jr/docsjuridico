import Link from 'next/link'
import { ArrowRight, FilePlus2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'

export default async function HomePage() {
  const supabase = await createClient()
  const { data: docs } = await supabase
    .from('generated_documents')
    .select('id,kind,created_at,clients(full_name,cpf)')
    .order('created_at', { ascending: false })
    .limit(5)

  return (
    <div className="page narrowHome">
      <div className="pageHeader homeHeader">
        <div><p className="eyebrow">Área de trabalho</p><h1>Documentos do escritório</h1><p>Crie documentos a partir dos dados conferidos do cliente.</p></div>
        <Link className="primaryButton" href="/app/novo"><FilePlus2 size={17}/> Novo documento</Link>
      </div>
      <section className="paperSection">
        <div className="sectionHeader"><h2>Documentos recentes</h2><Link href="/app/documentos">Ver todos <ArrowRight size={15}/></Link></div>
        {!docs?.length ? <div className="emptyState">Nenhum documento gerado ainda.</div> : (
          <div className="documentRows">
            {docs.map((doc: any) => <div className="documentRow" key={doc.id}>
              <div><strong>{doc.kind === 'procuracao' ? 'Procuração' : 'Declaração de hipossuficiência'}</strong><span>{doc.clients?.full_name || 'Cliente'}</span></div>
              <time>{new Intl.DateTimeFormat('pt-BR').format(new Date(doc.created_at))}</time>
            </div>)}
          </div>
        )}
      </section>
    </div>
  )
}
