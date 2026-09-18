'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { encryptSecret, generateKey, hashKey } from '@/lib/crypto'

/**
 * A new key is shown once, here, and then only its hash is kept. There is no
 * "show me the key again" — reissue instead, which is also what you want if it
 * has been somewhere it shouldn't.
 */
export async function issueLicence(formData: FormData): Promise<void> {
  const customer = String(formData.get('customer') || '').trim()
  if (!customer) return
  const expires = String(formData.get('expires_at') || '').trim()
  const hosts = String(formData.get('allowed_hosts') || '')
    .split(',').map(h => h.trim()).filter(Boolean)

  const key = generateKey()
  await db().from('licences').insert({
    key_hash: hashKey(key),
    key_prefix: key.slice(0, 8),
    customer,
    contact_email: String(formData.get('contact_email') || '').trim() || null,
    expires_at: expires || null,
    allowed_hosts: hosts,
    max_installs: Number(formData.get('max_installs')) || 1,
    notes: String(formData.get('notes') || '').trim() || null,
  })

  // Carried in the URL because it exists nowhere else after this request.
  revalidatePath('/')
  const { redirect } = await import('next/navigation')
  redirect(`/?issued=${encodeURIComponent(key)}`)
}

export async function setStatus(formData: FormData): Promise<void> {
  const id = String(formData.get('id') || '')
  const status = String(formData.get('status') || '')
  if (!id || !['active', 'suspended', 'revoked'].includes(status)) return
  await db().from('licences').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
  await db().from('licence_events').insert({ licence_id: id, kind: `admin.${status}`, detail: 'changed in admin' })
  revalidatePath('/')
}

export async function putSecret(formData: FormData): Promise<void> {
  const name = String(formData.get('name') || '').trim()
  const value = String(formData.get('value') || '')
  if (!name || !value) return
  const licenceId = String(formData.get('licence_id') || '').trim() || null
  await db().from('licence_secrets').upsert({
    licence_id: licenceId,
    name,
    ciphertext: encryptSecret(value),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'licence_id,name' })
  revalidatePath('/')
}

/**
 * Take a whole .env block at once.
 *
 * Twenty-five credentials is a normal size for a bundle, and entering them one
 * at a time is where mistakes come from: a value pasted into the wrong row is
 * invisible afterwards, since nothing here can be read back. Pasting the block
 * you already have keeps names and values together.
 */
export async function putSecretsBulk(formData: FormData): Promise<void> {
  const licenceId = String(formData.get('licence_id') || '').trim() || null
  const text = String(formData.get('bulk') || '')
  if (!text.trim()) return

  const rows: { licence_id: string | null; name: string; ciphertext: string; updated_at: string }[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const i = trimmed.indexOf('=')
    if (i < 1) continue
    const name = trimmed.slice(0, i).trim().replace(/^export\s+/, '')
    // Values are taken verbatim apart from one layer of surrounding quotes,
    // which is what a copied .env line usually carries.
    let value = trimmed.slice(i + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!name || !value) continue
    rows.push({ licence_id: licenceId, name, ciphertext: encryptSecret(value), updated_at: new Date().toISOString() })
  }
  if (rows.length === 0) return

  await db().from('licence_secrets').upsert(rows, { onConflict: 'licence_id,name' })
  revalidatePath('/')
}

export async function removeSecret(formData: FormData): Promise<void> {
  const id = String(formData.get('id') || '')
  if (!id) return
  await db().from('licence_secrets').delete().eq('id', id)
  revalidatePath('/')
}

export async function blockInstall(formData: FormData): Promise<void> {
  const id = String(formData.get('id') || '')
  const blocked = String(formData.get('blocked') || '') === 'true'
  if (!id) return
  await db().from('licence_installations').update({ blocked }).eq('id', id)
  revalidatePath('/')
}
