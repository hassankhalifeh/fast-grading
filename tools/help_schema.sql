-- 53: in-app help center. Guides live in the database so access is enforced by RLS and the platform owner can edit them
-- from /platform without a redeploy. Seeded from guides/*.md by tools/build-help-seed.mjs.
--
-- audience: 'everyone' = any signed-in app user; 'school_admin' = has config.manage or users.manage;
--           'platform' = platform admins only. Platform admins can read every article (published or not) and are the
--           only ones who can write.
set search_path to fastgrading;

create table if not exists help_articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  title text not null check (length(trim(title)) > 0),
  summary text,
  audience text not null default 'everyone' check (audience in ('everyone', 'school_admin', 'platform')),
  sort_order integer not null default 0,
  published boolean not null default true,
  body_md text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table help_articles enable row level security;

drop policy if exists help_articles_read on help_articles;
create policy help_articles_read on help_articles for select using (
  is_platform_admin()
  or (
    published
    and current_app_user_id() is not null
    and (
      audience = 'everyone'
      or (audience = 'school_admin' and (has_capability('config.manage') or has_capability('users.manage')))
    )
  )
);

drop policy if exists help_articles_write on help_articles;
create policy help_articles_write on help_articles for all
  using (is_platform_admin()) with check (is_platform_admin());

-- every edit through the API stamps who/when (the seed leaves updated_by null, so it never overwrites an edited article)
create or replace function help_articles_stamp() returns trigger
language plpgsql security definer set search_path to 'fastgrading', 'pg_temp' as $$
begin
  new.updated_at := now();
  new.updated_by := current_app_user_id();
  return new;
end $$;

drop trigger if exists trg_help_articles_stamp on help_articles;
create trigger trg_help_articles_stamp before update on help_articles
  for each row execute function help_articles_stamp();

revoke all on help_articles from anon;
grant select, insert, update, delete on help_articles to authenticated;
grant all on help_articles to service_role;

