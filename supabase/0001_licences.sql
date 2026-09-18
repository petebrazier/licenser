-- Licensing for Bonza installations.
--
-- The licence does not "unlock" an installation: it leases the provider
-- credentials the installation runs on. Deactivating a key therefore stops the
-- next lease, and the installation loses the ability to call any model, scrape
-- any page or touch an ad account — whether or not its copy of the code still
-- contains the check.

create table if not exists public.licences (
  id             uuid primary key default gen_random_uuid(),
  -- Shown once at issue; only the hash is stored, like a password.
  key_hash       text        not null unique,
  -- The first 8 characters, so a human can tell two keys apart in a list.
  key_prefix     text        not null,
  customer       text        not null,
  contact_email  text,
  status         text        not null default 'active'
                 check (status in ('active', 'suspended', 'revoked')),
  -- null = perpetual. A past date stops the installation at the next lease.
  expires_at     timestamptz,
  -- Which hosts may use this key. Empty = any (first host seen is recorded).
  allowed_hosts  text[]      not null default '{}',
  -- How many distinct installations may hold it at once.
  max_installs   int         not null default 1,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Every installation that has ever presented a key, and when it last checked in.
create table if not exists public.licence_installations (
  id                uuid primary key default gen_random_uuid(),
  licence_id        uuid not null references public.licences(id) on delete cascade,
  -- Stable per deployment: a hash of the host + a value the install generates once.
  installation_id   text not null,
  host              text,
  app_version       text,
  last_seen_at      timestamptz not null default now(),
  last_ip           text,
  first_seen_at     timestamptz not null default now(),
  blocked           boolean not null default false,
  unique (licence_id, installation_id)
);

-- Leases, refusals and admin actions, so a dispute has a record.
create table if not exists public.licence_events (
  id              uuid primary key default gen_random_uuid(),
  licence_id      uuid references public.licences(id) on delete set null,
  installation_id text,
  kind            text not null,   -- lease.ok | lease.refused | admin.suspend | ...
  detail          text,
  host            text,
  ip              text,
  created_at      timestamptz not null default now()
);

create index if not exists licence_events_licence_idx on public.licence_events (licence_id, created_at desc);
create index if not exists licence_installations_seen_idx on public.licence_installations (last_seen_at desc);

-- The secrets handed out on a valid lease, encrypted with a key held only in
-- this service's environment. Rows are per plan so two customers can be given
-- different accounts, and so one can be cut off without touching the other.
create table if not exists public.licence_secrets (
  id           uuid primary key default gen_random_uuid(),
  -- null = the default bundle, used by any licence with no bundle of its own.
  licence_id   uuid references public.licences(id) on delete cascade,
  name         text not null,          -- e.g. OPENAI_API_KEY
  ciphertext   text not null,          -- AES-256-GCM, base64: iv.tag.data
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (licence_id, name)
);

alter table public.licences              enable row level security;
alter table public.licence_installations enable row level security;
alter table public.licence_events        enable row level security;
alter table public.licence_secrets       enable row level security;
-- No policies: the service reaches this with the service role, and nothing else
-- may read it. A leaked anon key must not expose a customer's credentials.
