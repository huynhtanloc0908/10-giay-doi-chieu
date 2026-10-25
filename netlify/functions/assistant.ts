type Source = { title: string; url: string; publisher: string; passage: string; claims?: string[]; topics?: string[]; sourceType?: string; checkedAt?: string };
const model = 'gemini-2.5-flash';
const maxSources = 5;
const allowedDomains = new Set(['bocongan.gov.vn', 'chinhphu.vn', 'hatinh.gov.vn', 'laichau.gov.vn', 'vov.vn', 'tienphong.vn', 'baolaocai.vn', 'baovanhoa.vn', 'nhadautu.vn', 'daibieunhandan.vn', 'baomoi.com', 'luatvietnam.vn', 'lsvn.vn', 'baophapluat.vn', 'luatminhkhue.vn', 'thanhtra.com.vn', 'thuvienphapluat.vn']);
const greetingPattern = /^(xin chào|chào|hello|hi|hey|alo|bạn ơi|yo)\b/i;
function isAllowedUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && [...allowedDomains].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch { return false; }
}

function configuredSources(): Source[] {
  try {
    const value: unknown = JSON.parse(process.env.ASSISTANT_SOURCES_JSON ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is Source => {
      if (!item || typeof item !== 'object') return false;
      const source = item as Record<string, unknown>;
      try { return typeof source.title === 'string' && typeof source.url === 'string' && isAllowedUrl(source.url)
        && typeof source.publisher === 'string' && typeof source.passage === 'string' && source.passage.length > 20; } catch { return false; }
    });
  } catch { return []; }
}

async function sources(request: Request): Promise<Source[]> {
  const configured = configuredSources();
  try {
    const response = await fetch(new URL('/data/quiz.official.json', request.url), { cache: 'no-store' });
    if (!response.ok) return configured;
    const dataset = await response.json() as { sourceCatalog?: Source[]; questions?: { question?: string; explanation?: string; sources?: Omit<Source, 'passage'>[] }[] };
    const catalogSources = (dataset.sourceCatalog ?? []).filter(source => source.passage.length > 20);
    const quizSources = (dataset.questions ?? []).flatMap(question => (question.sources ?? []).map(source => ({
      ...source,
      passage: `${question.question ?? ''} ${question.explanation ?? ''}`
    })));
    const all = [...configured, ...catalogSources, ...quizSources];
    return all.filter(source => isAllowedUrl(source.url)).filter((source, index) => all.findIndex(candidate => candidate.url === source.url) === index);
  } catch {
    return configured;
  }
}

function relevantSources(query: string, items: Source[]) {
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('vi');
  const terms = normalize(query).split(/[^a-z0-9]+/).filter(term => term.length > 2);
  return items.map(source => {
    const text = normalize(`${source.title} ${source.passage} ${(source.claims ?? []).join(' ')} ${(source.topics ?? []).join(' ')}`);
    const matched = terms.filter(term => text.includes(term));
    const titleMatches = terms.filter(term => normalize(source.title).includes(term)).length;
    return { source, score: matched.length + titleMatches, matches: matched.length };
  }).filter(item => item.matches >= 2 || item.score >= 3).sort((a, b) => b.score - a.score).slice(0, maxSources).map(item => item.source);
}

function relatedSources(query: string, items: Source[]) {
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('vi');
  const terms = normalize(query).split(/[^a-z0-9]+/).filter(term => term.length > 2);
  return items.map(source => ({
    source,
    score: terms.filter(term => normalize(`${source.title} ${source.publisher}`).includes(term)).length
  })).sort((a, b) => b.score - a.score).slice(0, maxSources).map(item => item.source);
}

type GroundedSearch = { answer: string; sources: { uri: string; title?: string }[] };
async function groundedSources(message: string, apiKey: string): Promise<GroundedSearch | null> {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Tìm tối đa 3 nguồn đáng tin liên quan đến câu hỏi sau, chỉ ưu tiên các miền được phép: ${[...allowedDomains].join(', ')}. Chỉ trả lời ngắn gọn bằng tiếng Việt, không suy đoán, và nếu không có nguồn phù hợp hãy nói chưa đủ bằng chứng.\n\nCâu hỏi: ${message}` }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.1 }
      })
    });
    if (!response.ok) return null;
    const payload = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] } }[] };
    const candidate = payload.candidates?.[0];
    const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
    const webSources = chunks.map(chunk => chunk.web).filter((web): web is { uri: string; title?: string } => Boolean(web?.uri));
    if (!webSources.length || webSources.some(source => !isAllowedUrl(source.uri))) return null;
    const unique = webSources.filter((source, index) => webSources.findIndex(item => item.uri === source.uri) === index).slice(0, 3);
    if (!candidate?.content?.parts?.[0]?.text || !unique.length) return null;
    return { answer: candidate.content.parts.map(part => part.text ?? '').join(' ').trim(), sources: unique };
  } catch { return null; }
}

async function answerFromGrounding(message: string, grounded: GroundedSearch, apiKey: string) {
  const citations = grounded.sources.map((source, index) => ({
    id: `S${index + 1}`, title: source.title ?? 'Nguồn từ Google Search', url: source.uri,
    publisher: new URL(source.uri).hostname, passage: grounded.answer, sourceType: 'web_search'
  }));
  const prompt = `Bạn là trợ lý kiểm chứng thông tin. Chỉ dùng SEARCH CONTEXT dưới đây. Không dùng kiến thức ngoài, không suy đoán và không bịa URL. Trả về đúng JSON gồm status (answered|partial|insufficient_evidence), answer tiếng Việt có marker [S1], [S2]..., confidence là mức độ khớp nguồn (0-100), confidenceLabel (high|medium|low), warning và citationIds. Nếu context không đủ để khẳng định, dùng insufficient_evidence.\n\nQUESTION:\n${message}\n\nSEARCH CONTEXT:\n${citations.map(source => `[${source.id}] ${source.title} | ${source.url}\n${source.passage}`).join('\n\n')}`;
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.1 } })
    });
    if (!response.ok) return null;
    const payload = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const answer = JSON.parse(payload.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
    const validIds = new Set(citations.map(source => source.id));
    if (!Array.isArray(answer.citationIds) || answer.citationIds.some((id: unknown) => typeof id !== 'string' || !validIds.has(id))) return null;
    return { ...answer, citations: citations.filter(source => answer.citationIds.includes(source.id)) };
  } catch { return null; }
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return Response.json({ status: 'error', answer: '', citations: [] }, { status: 405 });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ status: 'unavailable', answer: '', citations: [] }, { status: 503 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ status: 'error', answer: '', citations: [] }, { status: 400 }); }
  const message = body && typeof body === 'object' && typeof (body as Record<string, unknown>).message === 'string'
    ? ((body as Record<string, string>).message).trim() : '';
  if (!message || message.length > 1200) return Response.json({ status: 'error', answer: '', citations: [] }, { status: 400 });
  if (greetingPattern.test(message)) {
    return Response.json({
      status: 'greeting',
      answer: 'Xin chào! Tôi là trợ lý AI chuyên hỗ trợ đối chiếu thông tin trên mạng dựa trên các nguồn đã được đưa vào kho kiểm chứng. Bạn có thể hỏi tôi về nguồn gốc, bối cảnh, quy định hoặc cách kiểm tra một thông tin. Tôi sẽ cố gắng trả lời rõ ràng và luôn kèm dẫn chứng; nếu kho nguồn chưa đủ, tôi sẽ nói rõ để bạn không vội tin hoặc lan truyền.',
      citations: [],
      confidence: 100,
      confidenceLabel: 'high'
    });
  }
  const availableSources = await sources(request);
  const context = relevantSources(message, availableSources);
  if (!context.length) {
    const related = relatedSources(message, availableSources);
    const grounded = await groundedSources(message, apiKey);
    if (grounded) {
      const answer = await answerFromGrounding(message, grounded, apiKey);
      if (answer) return Response.json({
        ...answer,
        warning: answer.warning || 'Kết quả dùng tìm kiếm web có giới hạn và có thể thay đổi. Hãy mở từng nguồn để kiểm tra nội dung gốc; không nên lan truyền nếu chưa đối chiếu.'
      });
    }
    const citations = related.map((source, index) => ({ ...source, id: `S${index + 1}` }));
    return Response.json({
      status: 'insufficient_evidence',
      answer: citations.length
        ? `Xin lỗi, tôi chưa thể xác minh câu hỏi này từ kho nguồn đã duyệt. Độ tin cậy hiện tại chỉ khoảng 10% vì chưa có bằng chứng trực tiếp. Bạn có thể mở các nguồn liên quan ${citations.map(source => `[${source.id}]`).join(', ')} để tự đối chiếu.`
        : 'Xin lỗi, tôi chưa thể xác minh câu hỏi này vì chưa tìm thấy bằng chứng trực tiếp trong kho nguồn đã duyệt. Độ tin cậy hiện tại chỉ khoảng 10%.',
      citations, confidence: 10, confidenceLabel: 'low',
      warning: 'Cảnh báo: Đây chưa phải thông tin đã được xác thực. Không nên tin chắc, đăng lại hoặc lan truyền cho người khác. Hãy cung cấp nguồn gốc hoặc kiểm tra trực tiếp với cơ quan có thẩm quyền.'
    });
  }
  const prompt = `Bạn là trợ lý kiểm chứng thông tin. Chỉ dùng CONTEXT, không dùng kiến thức bên ngoài. Mỗi khẳng định quan trọng phải có marker [S1], [S2] tương ứng. Phân biệt rõ “nguồn nói/nhận định” với sự thật đã được kiểm chứng độc lập. Nếu CONTEXT không đủ, trả status insufficient_evidence, xin lỗi, không đoán. Trả về đúng JSON với các khóa: status (answered|partial|insufficient_evidence), answer (tiếng Việt, chèn [S1]...), confidence (0-100, mức độ khớp với nguồn chứ không phải xác suất sự thật), confidenceLabel (high|medium|low), warning (cảnh báo ngắn nếu chưa đủ bằng chứng), citationIds (mảng S1...). Không bịa URL, ngày tháng hay trích dẫn.\n\nQUESTION:\n${message}\n\nCONTEXT:\n${context.map((source, index) => `[S${index + 1}] ${source.title} | ${source.url} | loại nguồn: ${source.sourceType ?? 'unknown'}\nChủ đề: ${(source.topics ?? []).join(', ')}\n${source.passage}`).join('\n\n')}`;
  let response: Response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.1 } })
    });
  } catch { return Response.json({ status: 'error', answer: '', citations: [] }, { status: 502 }); }
  if (!response.ok) return Response.json({ status: response.status === 429 ? 'rate_limited' : 'error', answer: '', citations: [] }, { status: response.status === 429 ? 429 : 502 });
  try {
    const payload = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const answer = JSON.parse(payload.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
    const citations = context.map((source, index) => ({ ...source, id: `S${index + 1}` })).filter(source => Array.isArray(answer.citationIds) && answer.citationIds.includes(source.id));
    return Response.json({ ...answer, citations, warning: answer.warning || (answer.confidence < 70 ? 'Chưa đủ cơ sở để khẳng định. Không nên lan truyền khi chưa kiểm tra nguồn gốc.' : undefined) });
  } catch { return Response.json({ status: 'error', answer: '', citations: [] }, { status: 502 }); }
}
