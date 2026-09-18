# Bonza licences

Issues and enforces licences for Bonza installations.

A licence does not unlock an installation — it **leases the credentials the
installation runs on**. A licensed deployment holds one environment variable of
consequence, `LICENCE_KEY`; the model keys, scraper, ad developer token and the
rest arrive with each lease and live only in the memory of the running process.

That is the point. A copy of the source code with the checks stripped out is an
application with no credentials, which cannot build a site, write a line of ad
copy, or reach an ad account.

## What happens when

| Situation | Installation |
|---|---|
| Lease granted | Runs normally. Renews every 15 minutes. |
| Suspended, revoked, expired, unknown key, host not allowed | **Stops at once.** Credentials are dropped from memory; the dashboard is replaced by a notice. |
| This service unreachable or erroring | Keeps working for **48 hours** on the last lease, warning as it goes, then stops. |

Silence is ambiguous and gets the benefit of the doubt; a refusal does not.

## Running it

Set the variables in `.env.example`. Generate the two keys with:

    node -e "const c=require('crypto');const{privateKey,publicKey}=c.generateKeyPairSync('ed25519');console.log('LEASE_SIGNING_KEY=',Buffer.from(privateKey.export({type:'pkcs8',format:'pem'})).toString('base64'));console.log('LICENCE_PUBLIC_KEY=',Buffer.from(publicKey.export({type:'spki',format:'pem'})).toString('base64'));console.log('SECRET_ENCRYPTION_KEY=',c.randomBytes(32).toString('base64'))"

Apply `supabase/0001_licences.sql` to the database.

## Issuing a licence

The admin page at `/` issues keys, suspends and revokes them, lists the
installations that have checked in, and holds the credentials to lease. A key is
displayed **once**, at issue; only its hash is stored.

Give a customer their own provider accounts wherever a provider allows it, and
attach those as per-licence credentials. Then cutting them off is a revocation
rather than a key rotation that disturbs everyone else.

## Setting up an installation

In the installation's environment:

    LICENCE_KEY=LIC-XXXX-XXXX-XXXX-XXXX
    LICENCE_SERVICE_URL=https://<this service>
    LICENCE_PUBLIC_KEY=<the public key printed above>

and **do not set** the provider keys it will be leasing. If one is present in
the environment it wins, and the licence stops being load-bearing.

## The honest limits

- An installation that holds a valid lease has the credentials in memory, and
  whoever runs that server can read them out of it. Revocation stops future
  access; it does not un-tell a secret. Per-customer accounts and rotation on
  revocation are the answer to that, not cleverness here.
- Anything the installation does entirely on its own — its own database, its own
  Vercel deploys — keeps working while the lease lasts and stops when the
  credentials do.
