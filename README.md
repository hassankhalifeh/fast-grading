# Grading SaaS — Dashboard App

A real Next.js app, built and verified (`npm run build` passes with zero errors) — not a mockup.

## Before running this app — required SQL files

**Status on the live Supabase project: everything below is already applied.** The base schema (01-06) was already live and is richer than the file names below suggest. Files `07_bulk_import.sql` through `12_security_fixes.sql` were added on top on 2026-09-17 and rewritten to match the real column names/types on the live database. The zip `grading-saas-migrations-07-12.zip` bundles the same files plus a `00_RUN_ALL_07_TO_12.sql` combined script — diff column names against the target environment's actual schema before replaying elsewhere.

`12_security_fixes.sql` addresses two items Supabase's advisor flagged (an access-control gap on `grade_history` and a hardening item on the reporting views) — see the file comments for specifics.

A few lower-priority advisor items (some pre-existing, unrelated to this change) are tracked separately and not yet addressed; ask for the current list if you need it.

## Running it locally

Same pattern as Buspulse:
```bash
npm install
cp .env.local.example .env.local   # fill in this project's Supabase URL + anon key
npm run dev
```
Open `http://localhost:3000` — you'll land on the login page, then `/dashboard`.

## What's in the dashboard

One shared dashboard (not separate role-specific apps like Buspulse) — the sidebar shows only the sections a user's granted capabilities allow:

- **المواد / المراحل / أنواع الاختبارات / سياسة العلامات** — the setup layer that must exist before grading can start
- **الصفوف / الطلاب** — roster management, including enrolling a student into a class from the same "Add Student" form
- **الامتحانات** — create exam records (class + subject + exam type + date)
- **إدخال العلامات** — pick an exam, see the roster, enter scores. Respects the grading-window lock and multi-component exams automatically. **Manual entry only** — the voice-to-data flow from the original design is a separate, larger build not included here.
- **الصلاحيات** — the literal "toggle switches per person" screen: every checkbox writes directly to `user_capabilities`.
- **التقارير** — `v_grade_report` (works today) and class rankings (needs files 04/05/06).

## First user setup

Same pattern as Buspulse: **Authentication → Users → Add user** in Supabase, then link them:
```sql
insert into app_users (account_id, auth_uid, full_name, role)
values ('<account-id>', '<auth-user-uid>', 'الاسم', 'solo_teacher');
```
Then, once file 04 is run, give them capabilities either via SQL (`select apply_default_capabilities('<app_user_id>', 'solo_teacher')`) or from the **الصلاحيات** screen itself once at least one capability is granted manually the first time.

## GitHub + Vercel

Identical steps to Buspulse — `git init`, push to a new repo, import into Vercel, set the two `NEXT_PUBLIC_SUPABASE_*` environment variables (pointing at the Grading SaaS project, not Buspulse's), deploy.

## What's deliberately not built yet

- Voice-to-data grade entry (manual entry only, for now)
- The parent notification Review & Compose Wizard
- A dedicated Exams-per-class-with-weight-override editor (`class_exam_type_weights` exists in the schema; editing it currently requires SQL — a natural next screen to add)
