-- Telefoncu CRM, Faz 1: veri modeli (spec §3)
-- Kiracı bütünlüğü: iş tablolarında üye/müşteri referansları (tenant_id, id) bileşik
-- yabancı anahtarla bağlanır; bir kiracının satırı başka kiracının üyesine/müşterisine işaret edemez.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- tenants
-- ---------------------------------------------------------------------------
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- tenant_settings
-- ---------------------------------------------------------------------------
create table public.tenant_settings (
  tenant_id uuid primary key references public.tenants on delete cascade,
  brand_name text not null default 'Marka Adı' check (btrim(brand_name) <> '' and length(brand_name) <= 80),
  brand_color text not null default '#FF5E2B' check (brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  logo_url text check (logo_url is null or logo_url ~* '^https?://'),
  max_attempts int not null default 3 check (max_attempts between 1 and 20),
  pool_wait_days int not null default 7 check (pool_wait_days between 1 and 365),
  max_rounds int not null default 2 check (max_rounds between 0 and 20),
  distribution_mode text not null default 'auto_even'
    check (distribution_mode in ('auto_even', 'free_pool', 'manual')),
  distribution_hour int not null default 8 check (distribution_hour between 0 and 23),
  summary_hour int not null default 19 check (summary_hour between 0 and 23),
  birthday_notice_days int not null default 3 check (birthday_notice_days between 0 and 60)
);

-- ---------------------------------------------------------------------------
-- members
-- ---------------------------------------------------------------------------
create table public.members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants,
  user_id uuid not null unique references auth.users on delete cascade,
  full_name text not null check (btrim(full_name) <> ''),
  role text not null check (role in ('manager', 'agent')),
  permissions jsonb not null default '{}'::jsonb check (jsonb_typeof(permissions) = 'object'),
  is_active boolean not null default true,
  absent_on date,
  created_at timestamptz default now(),
  unique (tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants,
  full_name text not null check (btrim(full_name) <> ''),
  phone text not null check (phone ~ '^05[0-9]{9}$'),
  phone_alt text check (phone_alt is null or phone_alt ~ '^05[0-9]{9}$'),
  operator text check (operator in ('VF', 'TC', 'TT')),
  birth_date date,
  source text not null default 'manual' check (source in ('manual', 'import', 'meta_api')),
  source_detail text,
  applied_at timestamptz,
  call_status text not null default 'pending'
    check (call_status in ('pending', 'retry', 'pool', 'done', 'unreachable', 'disqualified')),
  pipeline_stage text
    check (pipeline_stage in ('appointment', 'visited', 'applied', 'approved', 'rejected', 'completed', 'not_interested')),
  attempts_in_round int not null default 0 check (attempts_in_round >= 0),
  pool_count int not null default 0 check (pool_count >= 0),
  next_call_at timestamptz not null default now(),
  assigned_to uuid,
  last_outcome text,
  last_note text,
  consent boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (tenant_id, phone),
  unique (tenant_id, id),
  foreign key (tenant_id, assigned_to) references public.members (tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- daily_assignments
-- ---------------------------------------------------------------------------
create table public.daily_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants,
  day date not null,
  customer_id uuid not null,
  member_id uuid not null,
  position int not null check (position >= 1),
  created_at timestamptz default now(),
  unique (day, customer_id),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete cascade,
  foreign key (tenant_id, member_id) references public.members (tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- call_attempts
-- ---------------------------------------------------------------------------
create table public.call_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants,
  customer_id uuid not null,
  member_id uuid not null,
  outcome text not null
    check (outcome in ('appointment', 'callback', 'no_answer', 'busy', 'disqualified', 'not_interested', 'wrong_number')),
  note text,
  callback_at timestamptz,
  created_at timestamptz default now(),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete cascade,
  foreign key (tenant_id, member_id) references public.members (tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- pipeline_events
-- ---------------------------------------------------------------------------
create table public.pipeline_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants,
  customer_id uuid not null,
  member_id uuid not null,
  stage text not null
    check (stage in ('appointment', 'visited', 'applied', 'approved', 'rejected', 'completed', 'not_interested')),
  note text,
  created_at timestamptz default now(),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete cascade,
  foreign key (tenant_id, member_id) references public.members (tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigserial primary key,
  tenant_id uuid not null references public.tenants,
  member_id uuid references public.members on delete set null,
  action text not null,
  entity text,
  entity_id uuid,
  data jsonb,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- İndeksler
-- ---------------------------------------------------------------------------
create index customers_tenant_status_next_idx on public.customers (tenant_id, call_status, next_call_at);
create index customers_tenant_assigned_idx on public.customers (tenant_id, assigned_to);
create index daily_assignments_tenant_day_member_idx on public.daily_assignments (tenant_id, day, member_id);
create index daily_assignments_customer_idx on public.daily_assignments (customer_id, day);
create index call_attempts_customer_created_idx on public.call_attempts (customer_id, created_at desc);
create index call_attempts_tenant_member_created_idx on public.call_attempts (tenant_id, member_id, created_at);
create index pipeline_events_customer_created_idx on public.pipeline_events (customer_id, created_at desc);
create index audit_log_tenant_created_idx on public.audit_log (tenant_id, created_at desc);
create index members_tenant_idx on public.members (tenant_id);
