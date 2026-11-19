import { supabase } from './auth';
import type { Attempt, Dataset, Level } from './domain';

export async function saveQuizResult(attempt: Attempt, data: Dataset, correctAnswers: number) {
  if (!supabase) return { error: 'Supabase chưa được cấu hình.' };
  const questions = data.questions.filter(question => question.level === attempt.level);
  const totalQuestions = questions.length;
  const result = await supabase.from('quiz_attempts').insert({
    attempt_id: attempt.attemptId,
    dataset_version: attempt.datasetVersion,
    level: attempt.level as Level,
    total_questions: totalQuestions,
    correct_answers: correctAnswers,
    score_percent: Math.round((correctAnswers / totalQuestions) * 100),
    answers: attempt.answers.map(answer => ({
      questionId: answer.questionId,
      selectedOptionId: answer.selectedOptionId
    }))
  });
  if (result.error?.code === '23505') return { error: null };
  return { error: result.error?.message ?? null };
}
