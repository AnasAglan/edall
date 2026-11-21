-- Student learning history and administrator-only wallet ledger.
-- All user-owned learning history is scoped to auth.uid(); no answer keys are returned.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_learning_history()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _student_id uuid := auth.uid();
  _courses jsonb;
BEGIN
  IF _student_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'course_id',course.id,
        'course_title',course.title,
        'enrolled_at',enrollment.enrolled_at,
        'exams',COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'exam_id',exam.id,
              'title',COALESCE(NULLIF(exam.title,''),lesson.title),
              'lesson_id',lesson.id,
              'lesson_title',lesson.title,
              'question_count',(
                SELECT count(*)::integer
                FROM public.exam_questions AS question
                WHERE question.exam_id = exam.id
              ),
              'attempts',COALESCE((
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'attempt_id',attempt_row.attempt_id,
                    'started_at',attempt_row.started_at,
                    'submitted_at',attempt_row.completed_at,
                    'score',attempt_row.score,
                    'passed',attempt_row.passed,
                    'has_essay',attempt_row.has_essay,
                    'essay_graded',attempt_row.essay_graded,
                    'essay_pending',COALESCE(attempt_row.has_essay,false)
                      AND NOT COALESCE(attempt_row.essay_graded,false),
                    'status',CASE
                      WHEN attempt_row.completed_at IS NULL THEN 'in_progress'
                      WHEN COALESCE(attempt_row.has_essay,false)
                           AND NOT COALESCE(attempt_row.essay_graded,false) THEN 'essay_pending'
                      WHEN COALESCE(attempt_row.passed,false) THEN 'passed'
                      ELSE 'completed'
                    END
                  )
                  ORDER BY attempt_row.started_at DESC NULLS LAST,
                           attempt_row.completed_at DESC NULLS LAST
                )
                FROM (
                  SELECT
                    attempt.id AS attempt_id,
                    attempt.started_at,
                    COALESCE(attempt.submitted_at,result.submitted_at) AS completed_at,
                    result.score,
                    result.passed,
                    result.has_essay,
                    result.essay_graded
                  FROM public.exam_attempts AS attempt
                  LEFT JOIN public.exam_results AS result
                    ON result.id = attempt.result_id
                  WHERE attempt.exam_id = exam.id
                    AND attempt.user_id = _student_id

                  UNION ALL

                  SELECT
                    NULL::uuid AS attempt_id,
                    NULL::timestamptz AS started_at,
                    result.submitted_at AS completed_at,
                    result.score,
                    result.passed,
                    result.has_essay,
                    result.essay_graded
                  FROM public.exam_results AS result
                  WHERE result.exam_id = exam.id
                    AND result.user_id = _student_id
                    AND NOT EXISTS (
                      SELECT 1
                      FROM public.exam_attempts AS attempt
                      WHERE attempt.result_id = result.id
                    )
                ) AS attempt_row
              ),'[]'::jsonb)
            )
            ORDER BY lesson.sort_order,COALESCE(exam.title,lesson.title)
          )
          FROM public.exams AS exam
          JOIN public.lessons AS lesson ON lesson.id = exam.lesson_id
          WHERE lesson.course_id = course.id
        ),'[]'::jsonb),
        'assignments',COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'assignment_id',assignment.id,
              'title',assignment.title,
              'description',assignment.description,
              'lesson_id',assignment.lesson_id,
              'lesson_title',lesson.title,
              'due_at',assignment.due_at,
              'max_score',assignment.max_score,
              'is_published',assignment.is_published,
              'submission_id',submission.id,
              'submitted_at',submission.submitted_at,
              'is_late',submission.is_late,
              'score',submission.score,
              'feedback',submission.feedback,
              'graded_at',submission.graded_at,
              'status',CASE
                WHEN submission.id IS NULL THEN 'not_submitted'
                WHEN submission.graded_at IS NULL THEN 'submitted_pending_grade'
                ELSE 'graded'
              END
            )
            ORDER BY assignment.due_at NULLS LAST,assignment.created_at DESC
          )
          FROM public.assignments AS assignment
          LEFT JOIN public.lessons AS lesson ON lesson.id = assignment.lesson_id
          LEFT JOIN public.assignment_submissions AS submission
            ON submission.assignment_id = assignment.id
           AND submission.student_id = _student_id
          WHERE assignment.course_id = course.id
            AND assignment.is_published = true
        ),'[]'::jsonb),
        'certificates',COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id',certificate.id,
              'certificate_number',certificate.certificate_number,
              'verification_token',certificate.verification_token,
              'issued_at',certificate.issued_at,
              'revoked_at',certificate.revoked_at,
              'is_valid',certificate.revoked_at IS NULL
            )
            ORDER BY certificate.issued_at DESC
          )
          FROM public.course_certificates AS certificate
          WHERE certificate.course_id = course.id
            AND certificate.student_id = _student_id
        ),'[]'::jsonb)
      )
      ORDER BY course.title
    ),
    '[]'::jsonb
  )
  INTO _courses
  FROM public.enrollments AS enrollment
  JOIN public.courses AS course ON course.id = enrollment.course_id
  WHERE enrollment.user_id = _student_id;

  RETURN jsonb_build_object(
    'student_id',_student_id,
    'courses',COALESCE(_courses,'[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_learning_history() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_learning_history() TO authenticated;

COMMENT ON FUNCTION public.get_my_learning_history()
  IS 'Returns only the authenticated student enrollment-scoped exam/assignment/certificate history. Never returns exam answers or answer keys.';

CREATE OR REPLACE FUNCTION public.wallet_user_ledger(
  _user_id uuid,
  _limit integer DEFAULT 50,
  _offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  amount numeric,
  type text,
  note text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _admin_id uuid := auth.uid();
BEGIN
  IF _admin_id IS NULL
     OR _user_id IS NULL
     OR NOT public.has_role(_admin_id,'admin'::public.app_role)
     OR NOT public.admin_mfa_verified() THEN
    RAISE EXCEPTION 'ADMIN_MFA_REQUIRED';
  END IF;

  RETURN QUERY
  SELECT transaction.id,
         transaction.amount,
         transaction.type,
         transaction.note,
         transaction.created_at
  FROM public.wallet_transactions AS transaction
  WHERE transaction.user_id = _user_id
  ORDER BY transaction.created_at DESC,transaction.id DESC
  LIMIT LEAST(GREATEST(COALESCE(_limit,50),1),100)
  OFFSET GREATEST(COALESCE(_offset,0),0);
END;
$function$;

REVOKE ALL ON FUNCTION public.wallet_user_ledger(uuid,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.wallet_user_ledger(uuid,integer,integer) TO authenticated;

COMMENT ON FUNCTION public.wallet_user_ledger(uuid,integer,integer)
  IS 'Read-only, paginated wallet transactions for a selected user. Requires administrator role and AAL2.';

NOTIFY pgrst, 'reload schema';

COMMIT;
