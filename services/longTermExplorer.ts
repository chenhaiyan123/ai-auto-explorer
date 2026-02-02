// 长期探索服务
// 重新导出types中的类型
export type { Discovery, ExplorationSession, ExplorationIntensity, ExplorationConfig } from '../types';

import { Discovery, ExplorationSession, ExplorationIntensity, ExplorationConfig } from '../types';
import { ProblemNode, NodeStatus } from '../types';
import { v4 as uuidv4 } from 'uuid';

// 长期探索管理器
export class LongTermExplorationManager {
  private session: ExplorationSession | null = null;
  private onDiscovery?: (discovery: Discovery) => void;
  private onProgress?: (explored: number, total: number) => void;

  startSession(
    projectId: string,
    nodes: ProblemNode[],
    config?: ExplorationConfig,
    onDiscovery?: (discovery: Discovery) => void,
    onProgress?: (explored: number, total: number) => void
  ): ExplorationSession {
    this.onDiscovery = onDiscovery;
    this.onProgress = onProgress;

    this.session = {
      id: uuidv4(),
      projectId,
      startTime: Date.now(),
      status: 'running',
      discoveries: [],
      nodesExplored: nodes.filter(n => n.status === NodeStatus.SOLVED).length,
      totalNodes: nodes.length,
      config: config || { intensity: 'medium' }
    };

    return this.session;
  }

  pauseSession(): void {
    if (this.session) {
      this.session.status = 'paused';
    }
  }

  resumeSession(): void {
    if (this.session) {
      this.session.status = 'running';
    }
  }

  endSession(): ExplorationSession | null {
    if (this.session) {
      this.session.status = 'completed';
      this.session.endTime = Date.now();
      const result = this.session;
      this.session = null;
      return result;
    }
    return null;
  }

  addDiscovery(discovery: Discovery): void {
    if (this.session) {
      this.session.discoveries.push(discovery);
      this.onDiscovery?.(discovery);
    }
  }

  updateProgress(explored: number, total: number): void {
    if (this.session) {
      this.session.nodesExplored = explored;
      this.session.totalNodes = total;
      this.onProgress?.(explored, total);
    }
  }

  setIntensity(intensity: ExplorationIntensity): void {
    if (this.session && this.session.config) {
      this.session.config.intensity = intensity;
    }
  }

  getSession(): ExplorationSession | null {
    return this.session;
  }
}

export const longTermExplorer = new LongTermExplorationManager();
