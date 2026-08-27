// Mirrors 01_schema.sql, 02_triggers.sql, 03_views_and_rls.sql, and the
// upgrade files 04_config_permissions_ranking.sql /
// 05_exam_components_and_overrides.sql. Keep in sync if the schema changes.
//
// IMPORTANT: the Setup and Permissions screens in this app depend on
// tables created by upgrade files 04 and 05 (capabilities,
// user_capabilities, stages, exam_types, exam_type_components,
// grading_policies, class_exam_type_weights, terms). If those files
// haven't been run yet on your Supabase project, those specific
// screens will error — everything else (Subjects, Class Sections,
// Students) works against the original 01_schema.sql alone.

export type AccountType = "solo_teacher" | "school_enterprise" | "data_entry_freelancer";
export type UserRole = "solo_teacher" | "school_admin" | "assistant_admin" | "subject_teacher" | "custom_role";

export interface AppUser {
  id: string;
  account_id: string;
  auth_uid: string;
  full_name: string;
  email: string | null;
  role: UserRole;
  is_active: boolean;
}

export interface Account {
  id: string;
  account_type: AccountType;
  display_name: string;
}

export interface Subject {
  id: string;
  account_id: string;
  name: string;
}

export interface Stage {
  id: string;
  account_id: string;
  stage_name: string;
  order_index: number;
}

export interface ClassSection {
  id: string;
  account_id: string;
  name: string;
  grade_level: string | null;
  section_label: string | null;
  stage_id: string | null;
  is_active: boolean;
}

export interface Student {
  id: string;
  account_id: string;
  full_name: string;
  parent_name: string | null;
  parent_email: string | null;
  parent_phone: string | null;
}

export type ExamCategory = "Coursework" | "Term" | "Final";

export interface ExamType {
  id: string;
  account_id: string;
  name: string;
  weight_percent: number;
  category: ExamCategory | null;
}

export interface ExamTypeComponent {
  id: string;
  exam_type_id: string;
  component_name: string;
  weight_percent: number;
}

export interface GradingPolicy {
  id: string;
  account_id: string;
  formula_type: string;
  passing_threshold_percent: number;
}

export interface Capability {
  key: string;
  label_ar: string;
  category: string;
}

export interface Exam {
  id: string;
  account_id: string;
  class_section_id: string;
  subject_id: string;
  exam_name: string;
  exam_date: string;
  max_score: number;
  grading_window_open: boolean;
  exam_type_id: string | null;
  term_id: string | null;
}

export interface Term {
  id: string;
  account_id: string;
  name: string;
}

export interface GradeReportRow {
  account_name: string;
  class_name: string;
  subject_name: string;
  exam_name: string;
  exam_date: string;
  student_name: string;
  score: number;
  max_score: number;
  percentage: number;
  passing_status: string;
  grade_status: string;
}
