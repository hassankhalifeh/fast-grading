# Schema manifest — fastgrading (production baseline)

Recorded 2026-10-18 from Supabase project `xttdqktojkfbpombkkdp`, schema `fastgrading`, after migration 65 (function hashes include execute privileges).
Produced by the summary form of [`tools/schema_manifest.sql`](../tools/schema_manifest.sql).

| kind       |   n | hash                               |
|------------|----:|------------------------------------|
| constraint | 303 | `a9090b945889dfea92b3075353ca0e43` |
| enum       |  20 | `cf75966bbb661ce626e87d6c2a87971d` |
| function   | 124 | `872152d632fa924ec495c3d4e8103f49` |
| grant      | 160 | `e687dbe9ae3a4cb3c0e196f374204a0c` |
| index      | 180 | `3bf8cf6a083ab22d99c4dceb698a5c02` |
| policy     | 171 | `cb412c240a932fa84b462ce55f63f329` |
| table      |  67 | `8118bfa0d72e364131d5656b46adb0d9` |
| trigger    |  36 | `a516e9c92d2539fa2fc3ef5c2190d246` |
| view       |  13 | `d43f445e37f672440272665c630249f7` |

## How to use it (parity gate)

Run the summary form of the query against any database that should match (a restored project, a branch, a new
environment, or production after a deploy). A kind whose count or hash differs has drifted: run the per-object
form of the query on both sides and diff the `kind, name, md5` rows to see exactly which objects differ.

After every migration that changes the schema, re-run the summary on production and update this file in the same PR.
That is what makes the table above a real baseline instead of a stale snapshot.

## Known gap: no migrations 01–06 in the repository

Migrations in this repo start at 07. The base tables created before that (accounts, app_users, audit_logs,
capabilities, class_enrollments, class_exam_type_weights, class_sections, class_subject_teachers, custom_roles,
exam_type_components, exam_types, exams, grade_history, grades, grading_policies, institutions,
notification_templates, notifications_log, schools, stages, students, subjects, subscription_profiles, terms,
user_capabilities), plus 5 functions (`block_audit_log_mutation`, `current_account_id`, `current_app_user`,
`enforce_school_setup_before_grading`, `has_capability`) and 7 triggers, exist in production but no file in the
repo creates them. Every other object created by files 07–53 was verified present in production on 2026-10-18.
A new empty database therefore cannot be built from the repo alone; the production database (or a backup) is
the source of truth for those base objects.
