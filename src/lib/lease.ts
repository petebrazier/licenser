import { db } from './db'
import { decryptSecret, hashKey, signLease } from './crypto'

/**
 * How long an installation may run on one lease before it must ask again.
 * Short enough that a deactivation bites quickly; long enough that this service
 * being briefly unreachable is a non-event (see GRACE_SECONDS).
 */
const LEASE_TTL_SECONDS = 15 * 60

/**
 * How long an installation may keep working when it cannot reach this service
 * at all. The customer chose 48 hours: an outage here must never take down a
 * live ads platform, but a deliberate cut-off must not be survivable for long.
 *
 * This applies ONLY to silence. A lease that is refused — suspended, revoked,
 * expired, unknown key — stops the installation at once; there is nothing
 * ambiguous to be generous about.
 */
const GRACE_SECONDS = 48 * 60 * 60

export type LeaseRefusal = {
  ok: false
  reason: 'unknown_key' | 'suspended' | 'revoked' | 'expired' | 'too_many_installs' | 'host_not_allowed' | 'installation_blocked'
  message: string
}

export type LeaseGrant = {
  ok: true
  licence: { customer: string; expiresAt: string | null; status: string }
  leaseTtlSeconds: number
  graceSeconds: number
  secrets: Record<string, string>
}

type LicenceRow = {
  id: string
  customer: string
  status: string
  expires_at: string | null
  allowed_hosts: string[]
  max_installs: number
}

async function record(kind: string, detail: string, ctx: {
  licenceId?: string | null; installationId?: string; host?: string; ip?: string
}) {
  try {
    await db().from('licence_events').insert({
      licence_id: ctx.licenceId ?? null,
      installation_id: ctx.installationId ?? null,
      kind, detail,
      host: ctx.host ?? null,
      ip: ctx.ip ?? null,
    })
  } catch { /* an audit write must never be the reason a lease fails */ }
}

export async function lease(input: {
  key: string
  installationId: string
  host: string
  version?: string
  ip?: string
}): Promise<LeaseRefusal | LeaseGrant> {
  const sb = db()
  const ctx = { installationId: input.installationId, host: input.host, ip: input.ip }

  const { data: licence } = await sb
    .from('licences')
    .select('id, customer, status, expires_at, allowed_hosts, max_installs')
    .eq('key_hash', hashKey(input.key))
    .maybeSingle<LicenceRow>()

  if (!licence) {
    await record('lease.refused', 'unknown key', ctx)
    return { ok: false, reason: 'unknown_key', message: 'That licence key is not recognised.' }
  }

  const refuse = async (reason: LeaseRefusal['reason'], message: string): Promise<LeaseRefusal> => {
    await record('lease.refused', reason, { ...ctx, licenceId: licence.id })
    return { ok: false, reason, message }
  }

  if (licence.status === 'suspended') return refuse('suspended', 'This licence is suspended. Please get in touch.')
  if (licence.status === 'revoked') return refuse('revoked', 'This licence has been withdrawn.')
  if (licence.expires_at && new Date(licence.expires_at).getTime() < Date.now()) {
    return refuse('expired', `This licence expired on ${licence.expires_at.slice(0, 10)}.`)
  }

  // A host list, when set, is the difference between a licence for one client's
  // platform and a licence someone can stand up a second copy with.
  const host = (input.host || '').toLowerCase().replace(/^www\./, '')
  if (licence.allowed_hosts.length > 0) {
    const allowed = licence.allowed_hosts.some(h => {
      const a = h.toLowerCase().replace(/^www\./, '')
      return a === host || (a.startsWith('*.') && host.endsWith(a.slice(1)))
    })
    if (!allowed) return refuse('host_not_allowed', `This licence is not issued for ${host}.`)
  }

  // Seats. An installation already on the list is always let back in, so a
  // redeploy or a new lambda cannot lock a paying customer out of their own
  // platform; only a genuinely new installation counts against the limit.
  const { data: installs } = await sb
    .from('licence_installations')
    .select('installation_id, blocked')
    .eq('licence_id', licence.id)

  const existing = (installs || []).find(i => i.installation_id === input.installationId)
  if (existing?.blocked) return refuse('installation_blocked', 'This installation has been blocked.')
  if (!existing && (installs || []).length >= licence.max_installs) {
    return refuse('too_many_installs', `This licence covers ${licence.max_installs} installation(s), which are all in use.`)
  }

  await sb.from('licence_installations').upsert({
    licence_id: licence.id,
    installation_id: input.installationId,
    host: input.host,
    app_version: input.version ?? null,
    last_seen_at: new Date().toISOString(),
    last_ip: input.ip ?? null,
  }, { onConflict: 'licence_id,installation_id' })

  // The credentials themselves: this licence's own bundle, falling back to the
  // shared default. This is what the installation cannot obtain any other way.
  const { data: rows } = await sb
    .from('licence_secrets')
    .select('licence_id, name, ciphertext')
    .or(`licence_id.eq.${licence.id},licence_id.is.null`)

  const secrets: Record<string, string> = {}
  for (const row of (rows || []) as Array<{ licence_id: string | null; name: string; ciphertext: string }>) {
    // A per-licence value wins over the default of the same name.
    if (row.licence_id === null && secrets[row.name] !== undefined) continue
    try {
      secrets[row.name] = decryptSecret(row.ciphertext)
    } catch {
      // A secret that will not decrypt is a misconfiguration here, not a reason
      // to refuse the customer everything else.
      await record('lease.secret_undecryptable', row.name, { ...ctx, licenceId: licence.id })
    }
  }

  await record('lease.ok', `${Object.keys(secrets).length} secret(s)`, { ...ctx, licenceId: licence.id })

  return {
    ok: true,
    licence: { customer: licence.customer, expiresAt: licence.expires_at, status: licence.status },
    leaseTtlSeconds: LEASE_TTL_SECONDS,
    graceSeconds: GRACE_SECONDS,
    secrets,
  }
}

/** The body an installation verifies before trusting any of it. */
export function signed(body: Record<string, unknown>): { payload: string; signature: string } {
  const payload = JSON.stringify({ ...body, issuedAt: new Date().toISOString() })
  return { payload, signature: signLease(payload) }
}
