import { billingRequest, ReportSnapshot } from './billingClient';
import { zipStore } from './vault';
export interface ExportPackage { version: number; title: string; report: ReportSnapshot; contentHash: string; createdAt: number; notice: string }
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function exportFiles(pack: ExportPackage) {
  const r = pack.report;
  const sections = [['摘要 / Abstract', r.abstract], ...r.sections.map(s => [s.title, s.content]), ['结论 / Conclusions', r.conclusions.join('\n')], ['开放问题 / Open questions', r.openQuestions.join('\n')], ['参考来源 / References', r.references.map((v, i) => `[${i + 1}] ${v}`).join('\n')]];
  return [
    { path: 'report.html', content: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(r.title)}</title><style>body{font:16px/1.8 system-ui,sans-serif;max-width:840px;margin:48px auto;padding:0 24px;color:#172033}h1{font-size:30px}h2{font-size:20px;border-bottom:1px solid #ddd;margin-top:36px}p{white-space:pre-wrap;overflow-wrap:anywhere}small{color:#667}</style></head><body><small>HiExplore · ${escape(new Date(pack.createdAt).toISOString())}</small><h1>${escape(r.title)}</h1>${sections.map(([title, content]) => `<h2>${escape(title)}</h2><p>${escape(content)}</p>`).join('')}<hr><small>${escape(pack.notice)}<br>SHA-256: ${escape(pack.contentHash)}</small></body></html>` },
    { path: 'report.md', content: `# ${r.title}\n\n${sections.map(([title, content]) => `## ${title}\n\n${content}`).join('\n\n')}\n\n${pack.notice}` },
    { path: 'research-record.json', content: JSON.stringify(pack, null, 2) },
    { path: 'README.txt', content: 'HiExplore 研究成果包 / Research export\n\nreport.html：浏览器打开，可打印或另存为 PDF。\nreport.md：可编辑的 Markdown。\nresearch-record.json：来源、内容版本及 SHA-256 记录。\n\n这是已有研究内容的固定版本，不会在购买时重新生成结论。保存了引用不代表引用已核验，也不代表获得第三方文献的全文。\n\nThis is a snapshot of existing research. Exporting does not verify the findings or grant access to third-party full texts.' },
  ];
}
export async function downloadResearchExport(id: string) {
  const pack = await billingRequest<ExportPackage>(`/billing/artifacts/${id}/download`, 'POST');
  const blob = zipStore(exportFiles(pack)); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `${pack.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 80) || 'HiExplore'}-${id.slice(0, 8)}.zip`;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
