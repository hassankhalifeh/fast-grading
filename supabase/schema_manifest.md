# Schema manifest — fastgrading (production baseline)

Recorded 2026-10-18 from Supabase project `xttdqktojkfbpombkkdp`, schema `fastgrading`, after migration 59 (function hashes now include execute privileges).
Produced by the summary form of [`tools/schema_manifest.sql`](../tools/schema_manifest.sql).

| kind       |   n | hash                               |
|------------|----:|------------------------------------|
| constraint | 275 | `671c2d1cf3aae862df4c55fd972a3ba2` |
| enum       |  20 | `cf75966bbb661ce626e87d6c2a87971d` |
| function   | 107 | `24dfe6945ba9530cff9431e94a461209` |
| grant      | 152 | `9a0600906a87ab6d01adfe15685d2b13` |
| index      | 171 | `968d7ef7d9bf68c802d739c6a62dfb8b` |
| policy     | 165 | `e46cefef446b27acbae5e4a11dec2a3a` |
| table      |  63 | `254a6d48af944134c800beff3c71232a` |
| trigger    |  34 | `2b9399ee9715963b613084a19685d1c7` |
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
