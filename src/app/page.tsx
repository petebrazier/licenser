import { db } from '@/lib/db'
import { issueLicence, setStatus, putSecret, removeSecret, blockInstall } from './actions'

export const dynamic = 'force-dynamic'

type Licence = {
  id: string; key_prefix: string; customer: string; contact_email: string | null
  status: string; expires_at: string | null; allowed_hosts: string[]; max_installs: number
  notes: string | null; created_at: string
}
type Install = {
  id: string; licence_id: string; installation_id: string; host: string | null
  app_version: string | null; last_seen_at: string; blocked: boolean
}
type Secret = { id: string; licence_id: string | null; name: string; updated_at: string }
type Event = { id: string; licence_id: string | null; kind: string; detail: string | null; host: string | null; created_at: string }

const card: React.CSSProperties = {
  background: '#171a21', border: '1px solid #262b36', borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '1rem',
}
const input: React.CSSProperties = {
  background: '#0f1115', border: '1px solid #2c323f', color: '#e7e9ee',
  borderRadius: 6, padding: '.4rem .55rem', font: 'inherit', marginRight: '.4rem', marginBottom: '.4rem',
}
const button: React.CSSProperties = { ...input, cursor: 'pointer', fontWeight: 600 }
const dim: React.CSSProperties = { color: '#8b93a5' }

const ago = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 60) return `${mins}m ago`
  if (mins < 60 * 48) return `${Math.round(mins / 60)}h ago`
  return `${Math.round(mins / 1440)}d ago`
}

export default async function Page({ searchParams }: { searchParams: Promise<{ issued?: string }> }) {
  const { issued } = await searchParams
  const sb = db()
  const [{ data: licences }, { data: installs }, { data: secrets }, { data: events }] = await Promise.all([
    sb.from('licences').select('*').order('created_at', { ascending: false }),
    sb.from('licence_installations').select('*').order('last_seen_at', { ascending: false }),
    sb.from('licence_secrets').select('id, licence_id, name, updated_at').order('name'),
    sb.from('licence_events').select('*').order('created_at', { ascending: false }).limit(25),
  ])

  const defaults = ((secrets || []) as Secret[]).filter(s => s.licence_id === null)

  return (
    <main style={{ maxWidth: 980, margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 .25rem', fontSize: '1.4rem' }}>Bonza licences</h1>
      <p style={{ ...dim, marginTop: 0 }}>
        A licence leases the credentials an installation runs on. Suspend or revoke one and its next
        lease is refused &mdash; within fifteen minutes it can no longer reach any model, scraper or ad account.
      </p>

      {issued && (
        <div style={{ ...card, borderColor: '#3f6b3f', background: '#16231a' }}>
          <strong>New licence key &mdash; copy it now.</strong>
          <p style={{ ...dim, margin: '.35rem 0' }}>It is stored only as a hash. This is the one time it is shown.</p>
          <code style={{ fontSize: '1.15rem', letterSpacing: '.04em' }}>{issued}</code>
        </div>
      )}

      <section style={card}>
        <h2 style={{ fontSize: '1rem', margin: '0 0 .6rem' }}>Issue a licence</h2>
        <form action={issueLicence}>
          <input style={input} name="customer" placeholder="Customer" required />
          <input style={input} name="contact_email" placeholder="Contact email" />
          <input style={input} name="expires_at" type="date" title="Expiry (blank = perpetual)" />
          <input style={input} name="allowed_hosts" placeholder="Hosts, comma separated (blank = any)" size={34} />
          <input style={{ ...input, width: 90 }} name="max_installs" type="number" min={1} defaultValue={1} title="Installations" />
          <input style={input} name="notes" placeholder="Notes" size={24} />
          <button style={button} type="submit">Issue</button>
        </form>
      </section>

      {((licences || []) as Licence[]).map(l => {
        const mine = ((installs || []) as Install[]).filter(i => i.licence_id === l.id)
        const own = ((secrets || []) as Secret[]).filter(s => s.licence_id === l.id)
        const expired = l.expires_at ? new Date(l.expires_at).getTime() < Date.now() : false
        const colour = l.status !== 'active' || expired ? '#e0656b' : '#63c98a'
        return (
          <section key={l.id} style={card}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.6rem', alignItems: 'baseline' }}>
              <strong style={{ fontSize: '1.05rem' }}>{l.customer}</strong>
              <code style={dim}>{l.key_prefix}&hellip;</code>
              <span style={{ color: colour, fontWeight: 600 }}>
                {expired && l.status === 'active' ? 'expired' : l.status}
              </span>
              <span style={dim}>
                {l.expires_at ? `expires ${l.expires_at.slice(0, 10)}` : 'perpetual'}
                {' · '}{mine.length}/{l.max_installs} installation{l.max_installs === 1 ? '' : 's'}
                {l.allowed_hosts.length > 0 && ` · ${l.allowed_hosts.join(', ')}`}
              </span>
              <span style={{ marginLeft: 'auto' }}>
                {(['active', 'suspended', 'revoked'] as const).filter(s => s !== l.status).map(s => (
                  <form key={s} action={setStatus} style={{ display: 'inline' }}>
                    <input type="hidden" name="id" value={l.id} />
                    <input type="hidden" name="status" value={s} />
                    <button style={button} type="submit">{s === 'active' ? 'Reactivate' : s === 'suspended' ? 'Suspend' : 'Revoke'}</button>
                  </form>
                ))}
              </span>
            </div>

            {l.notes && <p style={{ ...dim, margin: '.4rem 0 0' }}>{l.notes}</p>}

            {mine.length > 0 && (
              <table style={{ width: '100%', marginTop: '.8rem', borderCollapse: 'collapse', fontSize: 13 }}>
                <tbody>
                  {mine.map(i => (
                    <tr key={i.id} style={{ borderTop: '1px solid #262b36' }}>
                      <td style={{ padding: '.35rem 0' }}>{i.host || '(no host)'}</td>
                      <td style={dim}><code>{i.installation_id.slice(0, 12)}</code></td>
                      <td style={dim}>{i.app_version || ''}</td>
                      <td style={dim}>seen {ago(i.last_seen_at)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <form action={blockInstall} style={{ display: 'inline' }}>
                          <input type="hidden" name="id" value={i.id} />
                          <input type="hidden" name="blocked" value={String(!i.blocked)} />
                          <button style={{ ...button, color: i.blocked ? '#63c98a' : '#e0656b' }} type="submit">
                            {i.blocked ? 'Unblock' : 'Block'}
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <details style={{ marginTop: '.7rem' }}>
              <summary style={{ cursor: 'pointer', ...dim }}>
                Credentials for this licence ({own.length} override{own.length === 1 ? '' : 's'}, {defaults.length} shared)
              </summary>
              <div style={{ marginTop: '.5rem' }}>
                {own.map(s => (
                  <form key={s.id} action={removeSecret} style={{ display: 'inline-block', marginRight: '.5rem' }}>
                    <input type="hidden" name="id" value={s.id} />
                    <code>{s.name}</code> <button style={button} type="submit">remove</button>
                  </form>
                ))}
                <form action={putSecret} style={{ marginTop: '.5rem' }}>
                  <input type="hidden" name="licence_id" value={l.id} />
                  <input style={input} name="name" placeholder="OPENAI_API_KEY" />
                  <input style={input} name="value" type="password" placeholder="value" size={40} />
                  <button style={button} type="submit">Set for this customer</button>
                </form>
              </div>
            </details>
          </section>
        )
      })}

      <section style={card}>
        <h2 style={{ fontSize: '1rem', margin: '0 0 .6rem' }}>Shared credentials</h2>
        <p style={{ ...dim, marginTop: 0 }}>
          Leased to any licence without one of its own. Give a customer their own account wherever a
          provider allows it &mdash; then cutting them off is a revocation, not a rotation for everybody.
        </p>
        {defaults.map(s => (
          <form key={s.id} action={removeSecret} style={{ display: 'inline-block', marginRight: '.5rem' }}>
            <input type="hidden" name="id" value={s.id} />
            <code>{s.name}</code> <button style={button} type="submit">remove</button>
          </form>
        ))}
        <form action={putSecret} style={{ marginTop: '.5rem' }}>
          <input style={input} name="name" placeholder="OPENAI_API_KEY" />
          <input style={input} name="value" type="password" placeholder="value" size={40} />
          <button style={button} type="submit">Set shared</button>
        </form>
      </section>

      <section style={card}>
        <h2 style={{ fontSize: '1rem', margin: '0 0 .6rem' }}>Recent activity</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <tbody>
            {((events || []) as Event[]).map(e => (
              <tr key={e.id} style={{ borderTop: '1px solid #262b36' }}>
                <td style={{ padding: '.3rem 0', color: e.kind.includes('refused') ? '#e0656b' : undefined }}>{e.kind}</td>
                <td style={dim}>{e.detail}</td>
                <td style={dim}>{e.host}</td>
                <td style={{ ...dim, textAlign: 'right' }}>{ago(e.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  )
}
