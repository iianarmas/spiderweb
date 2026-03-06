-- =============================================================
-- Spiderweb Thread Art App — Supabase Schema
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor)
-- =============================================================

-- 1. Profiles table (auto-populated on signup)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Trigger to auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id)
  values (new.id);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- 2. Projects table
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'Untitled Project',
  mode text not null check (mode in ('bw', 'color')),
  frame_shape text not null check (frame_shape in ('circle', 'square', 'rectangle')),
  nail_count integer not null,
  string_count integer not null,
  frame_dimensions jsonb,           -- { width: number, height: number } in cm
  nail_sequence jsonb,              -- number[] — ordered nail indices (B&W mode)
  color_layers jsonb,               -- { color: string, nailSequence: number[] }[] (color mode)
  original_image_url text,
  preview_image_url text,
  current_step integer not null default 0,
  current_color_layer integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.projects enable row level security;

create policy "Users can view their own projects"
  on public.projects for select
  using (auth.uid() = user_id);

create policy "Users can insert their own projects"
  on public.projects for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own projects"
  on public.projects for update
  using (auth.uid() = user_id);

create policy "Users can delete their own projects"
  on public.projects for delete
  using (auth.uid() = user_id);


-- 3. Storage bucket for project images
-- Run this after creating the bucket in the Supabase Dashboard (Storage > New Bucket > "project-images", public)
insert into storage.buckets (id, name, public)
values ('project-images', 'project-images', true)
on conflict (id) do nothing;

create policy "Authenticated users can upload images"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'project-images' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Anyone can view images"
  on storage.objects for select
  using (bucket_id = 'project-images');

create policy "Users can delete their own images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'project-images' and auth.uid()::text = (storage.foldername(name))[1]);
