'use client'

import { useEffect, useState } from 'react'
import { Building2, LoaderCircle, Pencil, Save, Search, Trash2, UserRound, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type ClientRow = {
  id:string
  full_name:string
  cpf:string
  rg:string|null
  nationality:string|null
  marital_status:string|null
  profession:string|null
  address_line:string|null
  address_number:string|null
  neighborhood:string|null
  city:string|null
  state:string|null
  cep:string|null
  company_name:string|null
  cnpj:string|null
  company_address_line:string|null
  company_address_number:string|null
  company_neighborhood:string|null
  company_city:string|null
  company_state:string|null
  created_at:string
  updated_at:string
}

type EditDraft = {
  full_name:string; cpf:string; rg:string; nationality:string; marital_status:string; profession:string
  address_line:string; address_number:string; neighborhood:string; city:string; state:string; cep:string
  has_company:boolean; company_name:string; cnpj:string; company_address_line:string; company_address_number:string
  company_neighborhood:string; company_city:string; company_state:string
}

function value(v:string|null|undefined){ return v || '' }
function toDraft(row:ClientRow):EditDraft {
  return {
    full_name:row.full_name, cpf:row.cpf, rg:value(row.rg), nationality:value(row.nationality), marital_status:value(row.marital_status), profession:value(row.profession),
    address_line:value(row.address_line), address_number:value(row.address_number), neighborhood:value(row.neighborhood), city:value(row.city), state:value(row.state), cep:value(row.cep),
    has_company:Boolean(row.company_name || row.cnpj), company_name:value(row.company_name), cnpj:value(row.cnpj), company_address_line:value(row.company_address_line),
    company_address_number:value(row.company_address_number), company_neighborhood:value(row.company_neighborhood), company_city:value(row.company_city), company_state:value(row.company_state),
  }
}

export function ClientsList() {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ClientRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<ClientRow|null>(null)
  const [draft, setDraft] = useState<EditDraft|null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState('')

  useEffect(() => { const t=setTimeout(load, 180); return ()=>clearTimeout(t) }, [query])

  async function load() {
    setLoading(true); setError('')
    const supabase = createClient()
    let request = supabase.from('clients').select('id,full_name,cpf,rg,nationality,marital_status,profession,address_line,address_number,neighborhood,city,state,cep,company_name,cnpj,company_address_line,company_address_number,company_neighborhood,company_city,company_state,created_at,updated_at').order('full_name').limit(100)
    const trimmed=query.trim()
    if (trimmed) {
      const digits=trimmed.replace(/\D/g,'')
      const safe=trimmed.replace(/[,%_()]/g,' ')
      const parts=[`full_name.ilike.%${safe}%`]
      if (digits) parts.push(`cpf_norm.ilike.%${digits}%`)
      request=request.or(parts.join(','))
    }
    const { data, error } = await request
    if (error) setError('Não foi possível carregar os clientes.')
    setRows((data || []) as ClientRow[]); setLoading(false)
  }

  function openEdit(row:ClientRow) { setEditing(row); setDraft(toDraft(row)); setError('') }
  function closeEdit() { if (!saving) { setEditing(null); setDraft(null) } }
  function setField<K extends keyof EditDraft>(key:K, val:EditDraft[K]) { setDraft(old=>old ? {...old,[key]:val} : old) }

  async function saveClient() {
    if (!editing || !draft) return
    setSaving(true); setError('')
    try {
      const response=await fetch(`/api/clients/${editing.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft)})
      const data=await response.json()
      if(!response.ok) throw new Error(data.error || 'Não foi possível salvar as alterações.')
      setEditing(null); setDraft(null); await load()
    } catch(e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar as alterações.') }
    finally { setSaving(false) }
  }

  async function deleteClient(row:ClientRow) {
    const ok=window.confirm(`Excluir ${row.full_name}? Os documentos gerados e arquivos enviados desse cliente também serão removidos do armazenamento privado.`)
    if(!ok) return
    setDeletingId(row.id); setError('')
    try {
      const response=await fetch(`/api/clients/${row.id}`,{method:'DELETE'})
      const data=await response.json()
      if(!response.ok) throw new Error(data.error || 'Não foi possível excluir o cliente.')
      await load()
    } catch(e) { setError(e instanceof Error ? e.message : 'Não foi possível excluir o cliente.') }
    finally { setDeletingId('') }
  }

  return <>
    <section className="paperSection">
      <div className="listToolbar"><div className="searchBox"><Search size={17}/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Buscar por nome ou CPF" /></div></div>
      {error && <div className="formError listError">{error}</div>}
      {loading ? <div className="emptyState">Carregando...</div> : !rows.length ? <div className="emptyState">Nenhum cliente encontrado.</div> : <div className="dataList">
        {rows.map(row=><div className="dataRow clientDataRow" key={row.id}>
          <div className="rowIcon"><UserRound size={18}/></div>
          <div className="rowMain"><strong>{row.full_name}</strong><span>CPF {row.cpf}{row.rg ? ` • RG ${row.rg}` : ''}</span></div>
          <div className="rowMeta">{[row.city,row.state].filter(Boolean).join('/') || '—'}{row.company_name ? <><br/><small>{row.company_name}</small></> : null}</div>
          <div className="rowActions">
            <button onClick={()=>openEdit(row)} title="Editar cliente"><Pencil size={15}/> Editar</button>
            <button className="dangerAction" onClick={()=>deleteClient(row)} disabled={deletingId===row.id} title="Excluir cliente">{deletingId===row.id?<LoaderCircle className="spin" size={15}/>:<Trash2 size={15}/>} Excluir</button>
          </div>
        </div>)}
      </div>}
    </section>

    {editing && draft && <div className="modalBackdrop" role="presentation" onMouseDown={(e)=>{if(e.currentTarget===e.target) closeEdit()}}>
      <section className="editModal" role="dialog" aria-modal="true" aria-labelledby="edit-client-title">
        <div className="modalHeader"><div><p className="eyebrow">Cliente salvo</p><h2 id="edit-client-title">Editar dados do cliente</h2><p>Altere somente o que precisar e salve. Os documentos já gerados não são reescritos automaticamente.</p></div><button className="iconButton" onClick={closeEdit} disabled={saving} aria-label="Fechar"><X size={18}/></button></div>
        <div className="modalBody">
          <div className="subsectionTitle"><span>Dados pessoais</span></div>
          <div className="fieldsGrid">
            <EditField label="Nome completo" value={draft.full_name} onChange={v=>setField('full_name',v)} wide />
            <EditField label="Nacionalidade" value={draft.nationality} onChange={v=>setField('nationality',v)} />
            <EditField label="Estado civil" value={draft.marital_status} onChange={v=>setField('marital_status',v)} />
            <EditField label="Profissão" value={draft.profession} onChange={v=>setField('profession',v)} />
            <EditField label="CPF" value={draft.cpf} onChange={v=>setField('cpf',v)} />
            <EditField label="RG" value={draft.rg} onChange={v=>setField('rg',v)} />
            <EditField label="Logradouro" value={draft.address_line} onChange={v=>setField('address_line',v)} wide />
            <EditField label="Número / complemento" value={draft.address_number} onChange={v=>setField('address_number',v)} />
            <EditField label="Bairro" value={draft.neighborhood} onChange={v=>setField('neighborhood',v)} />
            <EditField label="Cidade" value={draft.city} onChange={v=>setField('city',v)} />
            <EditField label="UF" value={draft.state} onChange={v=>setField('state',v.toUpperCase().slice(0,2))} />
            <EditField label="CEP" value={draft.cep} onChange={v=>setField('cep',v)} />
          </div>

          <div className="companyToggleBox compactToggle">
            <label className="switchRow"><input type="checkbox" checked={draft.has_company} onChange={e=>setField('has_company',e.target.checked)}/><span className="switchVisual" aria-hidden="true"><i/></span><span><strong>Cliente possui pessoa jurídica</strong><small>Exibe os dados empresariais vinculados a este cliente.</small></span></label>
          </div>
          {draft.has_company && <>
            <div className="subsectionTitle"><span><Building2 size={15}/> Dados da pessoa jurídica</span></div>
            <div className="fieldsGrid">
              <EditField label="Razão social / nome empresarial" value={draft.company_name} onChange={v=>setField('company_name',v)} wide />
              <EditField label="CNPJ" value={draft.cnpj} onChange={v=>setField('cnpj',v)} />
              <EditField label="Logradouro da empresa" value={draft.company_address_line} onChange={v=>setField('company_address_line',v)} wide />
              <EditField label="Número" value={draft.company_address_number} onChange={v=>setField('company_address_number',v)} />
              <EditField label="Bairro" value={draft.company_neighborhood} onChange={v=>setField('company_neighborhood',v)} />
              <EditField label="Cidade" value={draft.company_city} onChange={v=>setField('company_city',v)} />
              <EditField label="UF" value={draft.company_state} onChange={v=>setField('company_state',v.toUpperCase().slice(0,2))} />
            </div>
          </>}
        </div>
        <div className="modalFooter"><button className="secondaryButton" onClick={closeEdit} disabled={saving}>Cancelar</button><button className="primaryButton" onClick={saveClient} disabled={saving}>{saving?<LoaderCircle className="spin" size={16}/>:<Save size={16}/>} {saving?'Salvando...':'Salvar alterações'}</button></div>
      </section>
    </div>}
  </>
}

function EditField({label,value,onChange,wide}:{label:string;value:string;onChange:(value:string)=>void;wide?:boolean}) {
  return <label className={wide?'field wide':'field'}><span>{label}</span><input value={value} onChange={e=>onChange(e.target.value)} placeholder="Preencher" /></label>
}
