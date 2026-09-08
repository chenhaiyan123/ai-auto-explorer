import type { Project, ProblemNode } from '../types';

export const isOverviewNote = (node: ProblemNode) => node.noteType === 'readme' || node.noteType === 'overview';
export const overviewBrief = (project: Project) => project.overviewBrief ?? project.nodes.filter(n => n.noteType === 'readme').map(n => n.fullNote || n.notes || '').filter(Boolean).join('\n\n---\n\n');

/** One-time, lossless migration. Original IDs stay valid for links and exploration dependencies. */
export function migrateProjectOverview(project: Project): Project {
  if (project.overviewMigration) return project;
  const originals = project.nodes.filter(isOverviewNote);
  return { ...project, overviewBrief: overviewBrief(project), overviewMigration: {
    version: 1, at: Date.now(), originals: JSON.parse(JSON.stringify(originals)),
  } };
}

export function projectOverviewContext(project: Project): string {
  return [overviewBrief(project), ...project.nodes.filter(n => n.noteType === 'overview').map(n => n.fullNote || n.notes || '')].filter(Boolean).join('\n\n');
}

/** Include the user-owned brief in existing Markdown export paths without altering stored notes. */
export function overviewExportNodes(project: Project): ProblemNode[] {
  const brief = overviewBrief(project);
  return project.nodes.map(n => n.noteType === 'overview' && brief.trim() ? { ...n, fullNote: `# ${project.name} · 项目总览\n\n## 目标与范围\n\n${brief}\n\n## 研究摘要\n\n${n.fullNote || n.notes || ''}` } : n);
}
