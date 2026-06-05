-- Run this in Supabase SQL Editor

create table receipts (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'My Receipt',
  subtotal decimal(10,2) not null default 0,
  tax decimal(10,2) not null default 0,
  total decimal(10,2) not null default 0,
  qr_image_url text,
  created_at timestamptz not null default now()
);

create table receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references receipts(id) on delete cascade,
  item_name text not null,
  quantity int not null default 1,
  price decimal(10,2) not null default 0
);

create table participants (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references receipts(id) on delete cascade,
  name text not null,
  joined_at timestamptz not null default now()
);

create table selections (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  receipt_item_id uuid not null references receipt_items(id) on delete cascade,
  unique(participant_id, receipt_item_id)
);

-- Enable Realtime
alter publication supabase_realtime add table selections;
alter publication supabase_realtime add table participants;

-- Row Level Security (open for MVP)
alter table receipts enable row level security;
alter table receipt_items enable row level security;
alter table participants enable row level security;
alter table selections enable row level security;

create policy "public read receipts" on receipts for select using (true);
create policy "public insert receipts" on receipts for insert with check (true);

create policy "public read items" on receipt_items for select using (true);
create policy "public insert items" on receipt_items for insert with check (true);

create policy "public read participants" on participants for select using (true);
create policy "public insert participants" on participants for insert with check (true);

create policy "public read selections" on selections for select using (true);
create policy "public insert selections" on selections for insert with check (true);
create policy "public delete selections" on selections for delete using (true);

-- Run this if selections table already exists:
alter table selections add column if not exists qty int not null default 1;

-- In Supabase Dashboard > Storage: create a public bucket named "qr-images"

-- Storage bucket policies for qr-images
insert into storage.buckets (id, name, public) values ('qr-images', 'qr-images', true)
  on conflict (id) do update set public = true;

create policy "public read qr-images" on storage.objects
  for select using (bucket_id = 'qr-images');

create policy "public insert qr-images" on storage.objects
  for insert with check (bucket_id = 'qr-images');

create policy "public update qr-images" on storage.objects
  for update using (bucket_id = 'qr-images');
