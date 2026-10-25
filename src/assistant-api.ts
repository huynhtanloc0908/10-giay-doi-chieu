import { isSource, nonempty, record, type Source } from './domain';
export const statuses = ['answered', 'partial', 'insufficient_evidence', 'greeting', 'out_of_scope', 'rate_limited', 'unavailable', 'error'] as const;
const allowedDomains = ['bocongan.gov.vn', 'chinhphu.vn', 'hatinh.gov.vn', 'laichau.gov.vn', 'vov.vn', 'tienphong.vn', 'baolaocai.vn', 'baovanhoa.vn', 'nhadautu.vn', 'daibieunhandan.vn', 'baomoi.com', 'luatvietnam.vn', 'lsvn.vn', 'baophapluat.vn', 'luatminhkhue.vn', 'thanhtra.com.vn', 'thuvienphapluat.vn'];
function allowedSourceUrl(value: string) {
  try {
    const hostname = new URL(value).hostname;
    return new URL(value).protocol === 'https:' && allowedDomains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch { return false; }
}
export type AnswerStatus = typeof statuses[number] | 'timeout' | 'offline';
export interface Citation extends Source { id: string; passage?: string }
export interface AssistantResponse {
  status: AnswerStatus;
  answer: string;
  citations: Citation[];
  confidence?: number;
  confidenceLabel?: 'high' | 'medium' | 'low';
  warning?: string;
  limitations?: string;
  requestId?: string;
}
export interface AssistantConfig { enabled: boolean; endpoint: string | null; verifiedFreeThrough: string | null; approvedSources: Source[] }
export const disabledConfig: AssistantConfig = { enabled: false, endpoint: null, verifiedFreeThrough: null, approvedSources: [] };
export const messages: Record<AnswerStatus, { title: string; detail: string }> = {
  answered: { title: 'Câu trả lời có nguồn', detail: 'Mở tài liệu để kiểm tra từng dẫn chứng.' },
  partial: { title: 'Mới có một phần bằng chứng', detail: 'Một số khía cạnh chưa được tài liệu hỗ trợ. Chưa nên kết luận toàn bộ.' },
  insufficient_evidence: { title: 'Chưa đủ bằng chứng', detail: 'Không tìm thấy bằng chứng không có nghĩa là thông tin sai. Hãy bổ sung nguồn hoặc bối cảnh.' },
  greeting: { title: 'Lời chào', detail: 'Bạn có thể đặt câu hỏi để bắt đầu đối chiếu thông tin.' },
  out_of_scope: { title: 'Ngoài phạm vi hỗ trợ', detail: 'Hãy hỏi về kiểm tra nguồn, bối cảnh hình ảnh hoặc cách đối chiếu thông tin.' },
  rate_limited: { title: 'Đã đến giới hạn yêu cầu', detail: 'Vui lòng đợi một lúc rồi thử lại.' },
  unavailable: { title: 'Trợ lý AI chưa khả dụng', detail: 'Chưa có dịch vụ AI miễn phí và kho nguồn được xác nhận cho website. Bạn có thể đọc hướng dẫn tại Góc kiến thức.' },
  timeout: { title: 'Phản hồi quá thời gian chờ', detail: 'Yêu cầu đã dừng sau 20 giây. Bạn có thể thử lại.' },
  offline: { title: 'Không thể kết nối', detail: 'Kiểm tra kết nối mạng rồi thử lại. Chưa có câu trả lời được xác minh.' },
  error: { title: 'Chưa thể xử lý câu trả lời', detail: 'Dữ liệu phản hồi không hợp lệ hoặc dịch vụ gặp lỗi. Hãy thử lại sau.' },
};
export function result(status: AnswerStatus): AssistantResponse { return { status, answer: '', citations: [] }; }
export function validConfig(value: unknown): value is AssistantConfig {
  return record(value) && value.enabled === true && value.endpoint === '/api/assistant'
    && typeof value.verifiedFreeThrough === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.verifiedFreeThrough)
    && Number.isFinite(Date.parse(value.verifiedFreeThrough)) && value.verifiedFreeThrough >= '2026-11-09'
    && Date.parse(`${value.verifiedFreeThrough}T23:59:59+07:00`) >= Date.now()
    && Array.isArray(value.approvedSources) && value.approvedSources.length > 0 && value.approvedSources.every(isSource);
}
export function parseResponse(value: unknown, config: AssistantConfig): AssistantResponse {
  if (!record(value) || !statuses.includes(value.status as typeof statuses[number]) || typeof value.answer !== 'string' || value.answer.length > 12000 || !Array.isArray(value.citations)
    || value.citations.length > 20 || (value.limitations !== undefined && typeof value.limitations !== 'string')
    || (value.confidence !== undefined && (typeof value.confidence !== 'number' || !Number.isInteger(value.confidence) || value.confidence < 0 || value.confidence > 100))
    || (value.confidenceLabel !== undefined && !['high', 'medium', 'low'].includes(value.confidenceLabel as string))
    || (value.warning !== undefined && typeof value.warning !== 'string')
    || (value.requestId !== undefined && !nonempty(value.requestId))) return result('error');
  const ids = new Set<string>();
  for (const c of value.citations) {
    if (!record(c) || !isSource(c) || !nonempty(c.id) || !/^[a-zA-Z0-9_-]{1,40}$/.test(c.id) || ids.has(c.id)
      || (c.passage !== undefined && typeof c.passage !== 'string')
      || (!config.approvedSources.some(s => s.url === c.url && s.title === c.title) && !allowedSourceUrl(c.url))
      || !value.answer.includes(`[${c.id}]`)) return result('error');
    ids.add(c.id);
  }
  // Unknown source markers are rejected rather than rendered as invented citations.
  for (const marker of value.answer.matchAll(/\[([a-zA-Z0-9_-]+)\]/g)) if (!ids.has(marker[1])) return result('error');
  if (['answered', 'partial'].includes(value.status as string) && (!nonempty(value.answer) || value.citations.length === 0)) return result('insufficient_evidence');
  return value as unknown as AssistantResponse;
}
export async function askAssistant(prompt: string, config: AssistantConfig, signal: AbortSignal): Promise<AssistantResponse> {
  if (!validConfig(config)) return result('unavailable');
  if (!prompt.trim() || prompt.length > 1200) return result('error');
  if (!navigator.onLine) return result('offline');
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 20_000);
  try {
    const response = await fetch(config.endpoint!, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: prompt.trim() }), signal: controller.signal, credentials: 'omit', cache: 'no-store' });
    if (response.status === 429) return result('rate_limited');
    if (response.status === 503) return result('unavailable');
    if (!response.ok) return result('error');
    return parseResponse(await response.json(), config);
  } catch (error) {
    if (signal.aborted) throw error;
    return result(timedOut ? 'timeout' : error instanceof SyntaxError ? 'error' : 'offline');
  } finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); }
}
