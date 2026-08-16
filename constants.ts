import { NodeStatus } from './types';

export const STATUS_COLORS: Record<NodeStatus, string> = {
  [NodeStatus.UNEXPLORED]: '#3b82f6', // blue-500
  [NodeStatus.EXPLORING]: '#eab308',  // yellow-500
  [NodeStatus.SOLVED]: '#22c55e',     // green-500
  [NodeStatus.INVALID]: '#ef4444',    // red-500
  [NodeStatus.NEEDS_REVIEW]: '#f97316', // orange-500
  [NodeStatus.VALIDATING]: '#a855f7',   // purple-500 · 等现实反馈
  [NodeStatus.CONTRADICTED]: '#ec4899'  // pink-500 · 被现实反驳
};

export const INITIAL_ROOT_NODE_ID = 'root-1';

export const GEMINI_MODEL = 'qwen-plus';