import { UserStats } from '../types';

// 云端 API 地址 - 阿里云函数
const STATS_API_URL = 'https://aliyun-ai-proxy-mvyxjrfpcu.cn-hangzhou.fcapp.run/stats';

class MonitoringService {
  private currentUser: string | null = null;
  private sessionStartTime: number = 0;
  private heartbeatTimer: number | null = null;
  private localCache: Map<string, UserStats> = new Map();
  private lastSyncTime: number = 0;
  private syncInterval: number = 30000; // 30秒同步一次

  // 开始新会话
  incrementSession() {
    const user = this.getCurrentUsername();
    if (!user) return;

    this.currentUser = user;
    this.sessionStartTime = Date.now();
    
    // 立即同步一次
    this.syncToCloud();
  }

  // 更新心跳
  updateHeartbeat() {
    if (!this.currentUser) return;
    
    const now = Date.now();
    // 每30秒同步一次到云端
    if (now - this.lastSyncTime > this.syncInterval) {
      this.syncToCloud();
    }
  }

  // 记录 token 使用
  recordTokenUsage(promptTokens: number, completionTokens: number) {
    const user = this.getCurrentUsername();
    if (!user) return;

    const stats = this.getOrCreateStats(user);
    stats.totalPromptTokens += promptTokens;
    stats.totalCompletionTokens += completionTokens;
    stats.lastActiveTimestamp = Date.now();
    
    this.localCache.set(user, stats);
    
    // 有 token 消耗时立即同步
    this.syncToCloud();
  }

  // 同步到云端
  private async syncToCloud() {
    const user = this.getCurrentUsername();
    if (!user) return;

    const stats = this.getOrCreateStats(user);
    
    // 更新活跃时间
    if (this.sessionStartTime > 0) {
      const activeSeconds = Math.floor((Date.now() - this.sessionStartTime) / 1000);
      stats.totalActiveSeconds += activeSeconds;
      this.sessionStartTime = Date.now(); // 重置计时
    }
    
    stats.lastActiveTimestamp = Date.now();

    try {
      const response = await fetch(STATS_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(stats)
      });

      if (response.ok) {
        this.lastSyncTime = Date.now();
        console.log('📊 统计数据已同步到云端');
      } else {
        console.error('❌ 同步失败:', response.status);
      }
    } catch (error) {
      console.error('❌ 同步到云端失败:', error);
      // 失败时保存到本地作为备份
      this.saveToLocalBackup(stats);
    }
  }

  // 从云端获取所有统计数据
  async fetchCloudStats(): Promise<UserStats[]> {
    try {
      const response = await fetch(STATS_API_URL, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (response.ok) {
        const data = await response.json();
        console.log('📊 从云端获取数据成功:', data.length, '条记录');
        return data;
      } else {
        console.error('❌ 获取云端数据失败:', response.status);
        return [];
      }
    } catch (error) {
      console.error('❌ 从云端获取数据失败:', error);
      return [];
    }
  }

  // 获取所有统计数据(供管理员看板使用)
  getAllStats(): UserStats[] {
    // 这个方法现在改为异步调用 fetchCloudStats
    // 为了兼容现有代码,返回本地缓存
    return Array.from(this.localCache.values());
  }

  // 获取系统摘要
  getSystemSummary() {
    const allStats = Array.from(this.localCache.values());
    return {
      '总用户数': allStats.length,
      '总会话数': allStats.reduce((sum, s) => sum + s.sessionCount, 0),
      '总活跃时长(小时)': (allStats.reduce((sum, s) => sum + s.totalActiveSeconds, 0) / 3600).toFixed(1),
      '总Token消耗': allStats.reduce((sum, s) => sum + s.totalPromptTokens + s.totalCompletionTokens, 0).toLocaleString()
    };
  }

  // 获取或创建用户统计
  private getOrCreateStats(username: string): UserStats {
    if (!this.localCache.has(username)) {
      this.localCache.set(username, {
        username,
        sessionCount: 1,
        totalActiveSeconds: 0,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        lastActiveTimestamp: Date.now()
      });
    }
    return this.localCache.get(username)!;
  }

  // 获取当前用户名
  private getCurrentUsername(): string | null {
    try {
      const userStr = localStorage.getItem('current_user');
      if (!userStr) return null;
      const user = JSON.parse(userStr);
      return user.username || null;
    } catch {
      return null;
    }
  }

  // 本地备份(当云端同步失败时)
  private saveToLocalBackup(stats: UserStats) {
    try {
      const backup = localStorage.getItem('stats_backup');
      const backupData = backup ? JSON.parse(backup) : [];
      
      const index = backupData.findIndex((s: UserStats) => s.username === stats.username);
      if (index >= 0) {
        backupData[index] = stats;
      } else {
        backupData.push(stats);
      }
      
      localStorage.setItem('stats_backup', JSON.stringify(backupData));
    } catch (e) {
      console.error('本地备份失败:', e);
    }
  }

  // 加载云端数据到本地缓存
  async loadCloudData() {
    const cloudData = await this.fetchCloudStats();
    this.localCache.clear();
    cloudData.forEach(stats => {
      this.localCache.set(stats.username, stats);
    });
  }
}

export const monitor = new MonitoringService();