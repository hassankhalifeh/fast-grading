# Grading SaaS — Dashboard App

A real Next.js app, built and verified (`npm run build` passes with zero errors) — not a mockup.

## Before running this app — required SQL files

This app is built against the **full, latest schema**, including the two upgrade files. Run these in order on your Grading SaaS Supabase project (separate from Buspulse) if you haven't already:

1. `01_schema.sql`, `02_triggers.sql`, `03_views_and_rls.sql` — already run ✅ (per your earlier testing)
2. `04_config_permissions_ranking.sql` — **not yet run**
3. `05_exam_components_and_overrides.sql` — **not yet run**
4. `06_rls_for_upgrade_tables.sql` — **new, not yet run** — see below, this closes a security gap in files 04/05

Until 04-06 are run, these sections will show errors: **أنواع الاختبارات، سياسة العلامات، الصلاحيات، المراحل**, and the class-level weight override / multi-component grading. Everything else (**المواد، الصفوف، الطلاب، الامتحانات، إدخال العلامات البسيط، التقارير**) works against files 01-03 alone.

### About file 06 — please run this one

While building this app, I found that files 04 and 05 created several new tables (`capabilities`, `user_capabilities`, `institutions`, `schools`, `stages`, `exam_types`, `exam_type_components`, `grading_policies`, `class_exam_type_weights`, `terms`) **without enabling Row Level Security** on them — an oversight in those files, not something that changed since. Without file 06, those tables are unprotected. Run it right after 04 and 05, before using the app for real data.

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
