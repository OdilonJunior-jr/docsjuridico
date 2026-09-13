'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LockKeyhole, Scale } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) {
      setError('E-mail ou senha inválidos.')
      return
    }
    router.replace('/app')
    router.refresh()
  }

  return (
    <main className="loginPage">
      <section className="loginPanel" aria-labelledby="login-title">
        <div className="legalMark"><Scale size={20} strokeWidth={1.8} /></div>
        <div className="loginHeading">
          <p className="eyebrow">Escritório de advocacia</p>
          <h1 id="login-title">Documentos Jurídicos</h1>
          <p>Acesso restrito ao ambiente de documentos.</p>
        </div>
        <form className="loginForm" onSubmit={onSubmit}>
          <label>E-mail<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label>Senha<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          {error && <div className="formError" role="alert">{error}</div>}
          <button className="primaryButton fullButton" disabled={loading} type="submit">
            <LockKeyhole size={16} /> {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </section>
    </main>
  )
}
