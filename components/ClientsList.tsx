'use client'

import { useEffect, useState } from 'react'
import { Search, UserRound } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type ClientRow = { id:string; full_name:string; cpf:string; rg:string|null; city:string|null; state:string|null; created_at:string }

export function ClientsList() {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ClientRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { const t=setTimeout(load, 180); return ()=>clearTimeout(t) }, [query])

  async function load() {
    setLoading(true); setError('')
    const supabase = createClient()
    let request = supabase.from('clients').select('id,full_name,cpf,rg,city,state,created_at').order('full_name').limit(80)
    const trimmed=query.trim()
    if (trimmed) {
      const digits=trimmed.replace(/\D/g,'')
      const parts=[`full_name.ilike.%${trimmed.replace(/[,%_()]/g,' ')}%`]
      if (digits) parts.push(`cpf_norm.ilike.%${digits}%`)
      request=request.or(parts.join(','))
    }
    const { data, error } = await request
    if (error) setError('Não foi possível carregar os clientes.')
    setRows((data || []) as ClientRow[]); setLoading(false)
  }

  return <section className="paperSection">
    <div className="listToolbar"><div className="searchBox"><Search size={17}/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Buscar por nome ou CPF" /></div></div>
    {error && <div className="formError">{error}</div>}
    {loading ? <div className="emptyState">Carregando...</div> : !rows.length ? <div className="emptyState">Nenhum cliente encontrado.</div> : <div className="dataList">
      {rows.map(row=><div className="dataRow" key={row.id}><div className="rowIcon"><UserRound size={18}/></div><div className="rowMain"><strong>{row.full_name}</strong><span>CPF {row.cpf}{row.rg ? ` • RG ${row.rg}` : ''}</span></div><div className="rowMeta">{[row.city,row.state].filter(Boolean).join('/') || '—'}</div></div>)}
    </div>}
  </section>
}
