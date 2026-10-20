/** Project caps limit cloud research; they do not purchase or transfer account credits. */
export interface ProjectBudget { totalTokens: number; dailyTokens: number; perCallTokens: number }
export interface ProjectMandate {
  projectId: string; revision: number; termsRevision: number; goal: string; acceptance: string; stopCondition: string;
  deadline: number; tools: string[]; budgets: Record<string, ProjectBudget>;
  status: 'active' | 'paused' | 'stopped' | 'completed'; effectiveStatus: string; uncertain: boolean;
  usage: Record<string, { spent: number; held: number; remaining: number; today: number }>;
  calls: { id: string; modelId: string; reserved: number; charged?: number; status: string; at: number; scope: { branchId?: string; role?: string } }[];
}
