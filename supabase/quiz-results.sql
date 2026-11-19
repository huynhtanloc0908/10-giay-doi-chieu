create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  attempt_id text not null,
  dataset_version text not null,
  level text not null check (level in ('basic', 'intermediate', 'advanced')),
  total_questions integer not null check (total_questions > 0),
  correct_answers integer not null check (correct_answers between 0 and total_questions),
  score_percent integer not null check (score_percent between 0 and 100),
  answers jsonb not null,
  unique (attempt_id)
);

-- Migration for an existing quiz_attempts table.
drop policy if exists "Users can read their own quiz results" on public.quiz_attempts;
drop policy if exists "Users can insert their own quiz results" on public.quiz_attempts;
drop policy if exists "Users can update their own quiz results" on public.quiz_attempts;
drop policy if exists "Authenticated users can insert quiz results" on public.quiz_attempts;

alter table public.quiz_attempts drop constraint if exists quiz_attempts_user_id_attempt_id_key;
alter table public.quiz_attempts
  drop column if exists user_id,
  drop column if exists started_at,
  drop column if exists completed_at,
  drop column if exists created_at;

update public.quiz_attempts
set answers = (
  select jsonb_agg(
    jsonb_build_object(
      'questionId', elem->>'questionId',
      'selectedOptionId', elem->>'selectedOptionId'
    )
    order by ordinality
  )
  from jsonb_array_elements(answers) with ordinality as item(elem, ordinality)
)
where jsonb_typeof(answers) = 'array';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quiz_attempts_attempt_id_key'
      and conrelid = 'public.quiz_attempts'::regclass
  ) then
    alter table public.quiz_attempts add constraint quiz_attempts_attempt_id_key unique (attempt_id);
  end if;
end $$;

alter table public.quiz_attempts enable row level security;

drop policy if exists "Authenticated users can insert quiz results" on public.quiz_attempts;
create policy "Authenticated users can insert quiz results"
  on public.quiz_attempts for insert
  to authenticated
  with check (true);
