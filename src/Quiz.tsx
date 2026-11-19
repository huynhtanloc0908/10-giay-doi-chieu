import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, FileSearch, RotateCcw, X } from 'lucide-react';
import { DemoNotice, Loading, Sources } from './components';
import { isLevel, levels, levelNames, newAttempt, questionsFor, score, submitAnswer, validateAttempt, type Level } from './domain';
import { useQuiz } from './quiz-context';
import { lessons } from './content';
import { Assistant } from './Assistant';
import { useAuth } from './auth';
import { saveQuizResult } from './quiz-results';

export function QuizPage() {
  const { data, loading, attempt, update } = useQuiz();
  const [params] = useSearchParams();
  const preferred = params.get('level');
  const [active, setActive] = useState(params.get('resume') === '1');
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState('');
  const [showAssistant, setShowAssistant] = useState(false);
  const navigate = useNavigate();
  if (loading) return <Loading />;
  const start = (level: Level) => { update(() => newAttempt(data, level)); setIndex(0); setSelected(''); setActive(true); };
  if (!active || !attempt || !validateAttempt(attempt, data)) return <div className="reading wide"><p className="eyebrow">MỖI CÂU HỎI, MỘT GÓC NHÌN</p><h1>Luyện thói quen đối chiếu</h1><p className="lead">Chọn một cấp độ. Đọc kỹ tình huống, đưa ra lựa chọn và khám phá lời giải thích.</p><DemoNotice />
    {attempt && <div className="panel resume"><div><h2>{attempt.completedAt ? 'Bạn đã hoàn thành lượt này' : 'Tiếp tục từ nơi bạn dừng'}</h2><p>{levelNames[attempt.level]} · {attempt.answers.length}/{questionsFor(data, attempt.level).length} câu đã trả lời</p></div>{attempt.completedAt ? <Link className="button secondary" to="/quiz/result">Xem kết quả</Link> : <button className="button secondary" onClick={() => { setIndex(Math.max(0, attempt.answers.length - 1)); setSelected(''); setActive(true); }}>Tiếp tục</button>}</div>}
    <div className="level-grid">{levels.map((level, i) => <section key={level} className={`panel level-card ${preferred === level ? 'recommended' : ''}`}><span className={`level-icon ${['blue', 'teal', 'orange'][i]}`}>0{i + 1}</span><h2>{levelNames[level]}</h2><p>{['Nhận diện nguồn và kiểm tra thông tin ban đầu.', 'Đặt hình ảnh và thông tin vào đúng bối cảnh.', 'Phân biệt dữ kiện, suy luận và giới hạn bằng chứng.'][i]}</p><small>{data.approvedForProduction ? '10 câu hỏi · Một lượt riêng biệt' : '1 câu mẫu · Không đánh giá kỹ năng'}</small><button className="button secondary" onClick={() => start(level)}>{data.approvedForProduction ? 'Bắt đầu' : 'Xem minh họa'} {levelNames[level]} <ArrowRight size={17} /></button></section>)}</div>
    {isLevel(preferred) && <p className="subtle">Cấp độ bạn chọn từ Home: {levelNames[preferred]}.</p>}</div>;
  const questions = questionsFor(data, attempt.level);
  const question = questions[Math.min(index, questions.length - 1)];
  const answer = attempt.answers.find(a => a.questionId === question.id);
  const correct = answer?.selectedOptionId === question.correctOptionId;
  const chosen = answer?.selectedOptionId ?? selected;
  return <div className={`quiz-workspace ${showAssistant ? 'assistant-open' : ''}`}><div className="reading"><DemoNotice /><div className="section-heading"><span className="eyebrow">{levelNames[attempt.level]}</span><span>Câu {index + 1}/{questions.length}</span></div><progress aria-label="Tiến độ trả lời" value={attempt.answers.length} max={questions.length} />
    <section className="panel question" key={question.id}><p className="eyebrow">{question.isSyntheticScenario ? 'TÌNH HUỐNG GIẢ ĐỊNH' : 'TÌNH HUỐNG ĐỐI CHIẾU'}</p><form onSubmit={e => { e.preventDefault(); if (selected && !answer) update(a => a ? submitAnswer(a, data, question.id, selected) : a); }}><fieldset disabled={!!answer}><legend><h1>{question.question}</h1></legend><div className="options">{question.options.map((o, i) => <label key={o.id} className={`option ${chosen === o.id ? 'selected' : ''} ${answer && o.id === question.correctOptionId ? 'correct' : ''}`}><input type="radio" name="answer" value={o.id} checked={chosen === o.id} onChange={() => setSelected(o.id)} /><span className="option-letter">{String.fromCharCode(65 + i)}</span><span>{o.text}</span></label>)}</div></fieldset>{!answer && <button type="submit" className="button primary" disabled={!selected}>Xác nhận câu trả lời <ArrowRight size={17} /></button>}</form>
      {answer && <div className={`feedback ${correct ? 'success' : ''}`} role="status"><h2>{correct ? 'Lựa chọn phù hợp!' : 'Cùng nhìn lại một chút'}</h2><p><b>Đáp án: </b>{question.options.find(o => o.id === question.correctOptionId)?.text}</p><p>{question.explanation}</p><Sources sources={question.sources} /><button className="button primary" onClick={() => { if (index === questions.length - 1) navigate('/quiz/result'); else { setIndex(i => i + 1); setSelected(''); window.scrollTo(0, 0); } }}>{index === questions.length - 1 ? 'Xem kết quả' : 'Câu tiếp theo'} <ArrowRight size={17} /></button></div>}
    </section><div className="quiz-actions"><button className="button secondary ask-ai" onClick={() => setShowAssistant(value => !value)}><FileSearch size={17} /> {showAssistant ? 'Ẩn trợ lý AI' : 'Hỏi AI khi làm Quiz'}</button><button className="text-button" onClick={() => setActive(false)}>Quay lại chọn cấp độ</button></div></div>{showAssistant && <aside className="quiz-assistant panel"><div className="quiz-assistant-heading"><h2>Hỏi AI trong lúc làm Quiz</h2><button className="icon-button" aria-label="Đóng trợ lý AI" onClick={() => setShowAssistant(false)}><X size={18} /></button></div><Assistant embedded /></aside>}</div>;
}

export function ResultPage() {
  const { data, loading, attempt, update } = useQuiz();
  const { user } = useAuth();
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const navigate = useNavigate();
  useEffect(() => {
    if (!user || loading || !attempt?.completedAt || !validateAttempt(attempt, data) || saveState !== 'idle') return;
    const points = score(attempt, data);
    setSaveState('saving');
    void saveQuizResult(attempt, data, points).then(result => {
      if (result.error) { setSaveError(result.error); setSaveState('error'); }
      else setSaveState('saved');
    });
  }, [attempt, data, loading, saveState, user]);
  if (loading) return <Loading />;
  if (!attempt?.completedAt || !validateAttempt(attempt, data)) return <section className="panel empty reading"><CheckCircle2 size={48} /><h1>Chưa có kết quả hoàn chỉnh</h1><p>Hoàn thành một lượt Quiz để xem lựa chọn và giải thích của bạn.</p><Link to="/quiz" className="button primary">Làm Quiz <ArrowRight size={18} /></Link></section>;
  const questions = questionsFor(data, attempt.level);
  const points = score(attempt, data);
  const mistakes = questions.filter(q => attempt.answers.find(a => a.questionId === q.id)?.selectedOptionId !== q.correctOptionId);
  const missedSkills = new Set(mistakes.map(q => q.skillTag));
  return <div className="reading"><DemoNotice />  <section className="panel result-hero"><div className="score-circle"><b>{points}<span>/{questions.length}</span></b><small>câu đúng</small></div><div><p className="eyebrow">{levelNames[attempt.level]}</p><h1>{data.approvedForProduction ? 'Một bước hiểu rõ hơn' : 'Bạn đã xem xong minh họa'}</h1><p>{data.approvedForProduction ? 'Điều đáng giữ lại là cách bạn kiểm tra thông tin.' : 'Kết quả này chỉ dành cho câu mẫu, không phản ánh năng lực của bạn.'}</p><progress aria-label="Số câu trả lời đúng" value={points} max={questions.length} />{saveState === 'saving' && <p className="subtle">Đang lưu kết quả…</p>}{saveState === 'saved' && <p className="account-message">Đã lưu kết quả: {Math.round((points / questions.length) * 100)}% ({points}/{questions.length} câu đúng).</p>}{saveState === 'error' && <p className="notice warning">Chưa lưu được kết quả: {saveError}</p>}</div></section>
    <div className="section-heading section"><h2>Cùng xem lại</h2><button className="text-button" onClick={() => { const allOpen = questions.every(q => expanded[q.id] ?? mistakes.includes(q)); setExpanded(Object.fromEntries(questions.map(q => [q.id, !allOpen]))); }}>Mở / đóng tất cả</button></div>
    <div className="review-list">{questions.map((q, i) => { const a = attempt.answers.find(a => a.questionId === q.id)!; const wrong = a.selectedOptionId !== q.correctOptionId; const open = expanded[q.id] ?? wrong;
      return <section className="panel review-item" key={q.id}><h3><button aria-expanded={open} aria-controls={`review-${q.id}`} onClick={() => setExpanded(v => ({ ...v, [q.id]: !open }))}><span className={wrong ? 'review-marker wrong' : 'review-marker'}>{i + 1}</span><span>{q.question}<small>{wrong ? 'Cần xem lại' : 'Trả lời đúng'}</small></span><span aria-hidden="true">{open ? '−' : '+'}</span></button></h3><div id={`review-${q.id}`} hidden={!open} className="review-body">{q.isSyntheticScenario && <p className="eyebrow">TÌNH HUỐNG GIẢ ĐỊNH</p>}<p><b>Bạn chọn: </b>{q.options.find(o => o.id === a.selectedOptionId)?.text}</p><p><b>Đáp án: </b>{q.options.find(o => o.id === q.correctOptionId)?.text}</p><p>{q.explanation}</p><Sources sources={q.sources} /><Link className="text-link" to={`/learn#${q.skillTag}`}>Học thêm kỹ năng này <ArrowRight size={16} /></Link></div></section>;
    })}</div>
    <section className="panel section"><h2>{missedSkills.size ? 'Gợi ý dành cho bạn' : 'Tiếp tục nuôi dưỡng thói quen'}</h2><p>{missedSkills.size ? 'Ôn lại các kỹ năng liên quan đến câu cần xem lại.' : 'Khám phá thêm cách kiểm tra và đối chiếu mỗi ngày.'}</p>{lessons.filter(l => missedSkills.size ? missedSkills.has(l.id) : l.id === 'cross-checking').map(l => <Link className="text-link" key={l.id} to={`/learn#${l.id}`}>{l.title} <ArrowRight size={16} /></Link>)}</section>
    <div className="actions"><button className="button primary" onClick={() => { update(() => newAttempt(data, attempt.level)); navigate(`/quiz?level=${attempt.level}&resume=1`); }}><RotateCcw size={18} /> Làm lại cùng cấp độ</button><Link className="button secondary" to="/quiz">Chọn cấp độ khác</Link><Link className="button secondary" to="/learn">Học thêm</Link></div></div>;
}
