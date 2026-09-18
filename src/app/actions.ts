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
