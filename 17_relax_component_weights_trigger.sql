-- =====================================================================
-- 17_relax_component_weights_trigger.sql
-- الواجهة تضيف مكوّناً واحداً كل مرة، والتريغر القديم كان يرفض أي حالة
-- مجموعها <> 100، فأول مكوّن (مثلاً 80%) كان يفشل دائماً. نمنع فقط تجاوز 100.
-- =====================================================================
CREATE OR REPLACE FUNCTION enforce_component_weights_sum_100()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
declare
  v_total numeric;
begin
  select sum(weight_percent) into v_total
  from exam_type_components
  where exam_type_id = coalesce(new.exam_type_id, old.exam_type_id);

  if v_total is not null and v_total > 100 then
    raise exception using
      errcode = 'P0005',
      message = format('Component weights for this exam type must not exceed 100 (currently %s).', v_total);
  end if;

  return new;
end;
$function$;
