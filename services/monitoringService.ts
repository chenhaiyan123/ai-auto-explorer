
import { UserStats } from '../types';
import { auth } from './authService';

const DB_KEY = 'exploration_users_metrics_db';
// 使用与 geminiService 相同的代理地址，假设后端已支持 /stats 路由
const REMOTE_STATS_API = 'https://aliyun-ai-proxy-mvyxjrfpcu.cn-hangzhou.fcapp.run/stats';

class MonitoringService {
  private usersTable: Record<string, UserStats>;
  private pushTimeout: any = null;

  constructor() {
    this.usersTable = this.load();
  }

  private load(): Record<string, UserStats> {
    try {
      const saved = localStorage.getItem(DB_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      console.error("Failed to load monitoring data:", e);
      return {};
    }
  }

  private refresh() {
    // 加载本地最新数据，保留内存中可能较新的数据（如果有合并逻辑需求，这里需优化）
    const local = this.load();
    this.usersTable = { ...local, ...this.usersTable };
  }

  private save() {
    localStorage.setItem(DB_KEY, JSON.stringify(this.usersTable));
    this.schedulePush();
  }

  // 防抖推送数据到云端
  private schedulePush() {
    if (this.pushTimeout) clearTimeout(this.pushTimeout);
    this.pushTimeout = setTimeout(() => {
      const user = auth.getUser();
      if (user && this.usersTable[user.username]) {
        this.pushStatsToCloud(this.usersTable[user.username]);
      }
    }, 5000); // 5秒延迟合并推送
  }

  private async pushStatsToCloud(stats: UserStats) {
    try {
      await fetch(REMOTE_STATS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stats)
      });
    } catch (e) {
      console.warn("云端统计同步失败 (可能是后端未部署):", e);
    }
  }

  // 从云端拉取所有用户数据并合并
  public async fetchCloudStats() {
    try {
      const response = await fetch(REMOTE_STATS_API);
      if (response.ok) {
        const cloudData: UserStats[] = await response.json();
        if (Array.isArray(cloudData)) {
          cloudData.forEach(stat => {
            // 合并逻辑：如果本地没有，或者云端的时间戳更新，则更新
            const localStat = this.usersTable[stat.username];
            if (!localStat || stat.lastActiveTimestamp > localStat.lastActiveTimestamp) {
              this.usersTable[stat.username] = stat;
            }
          });
          // 保存合并后的数据到本地
          localStorage.setItem(DB_KEY, JSON.stringify(this.usersTable));
        }
      }
    } catch (e) {
      console.warn("获取云端统计失败:", e);
    }
  }

  private ensureUserEntry() {
    const user = auth.getUser();
    if (!user) return null;
    
    // 写入前先同步最新数据，防止多标签页冲突
    this.refresh();

    if (!this.usersTable[user.username]) {
      this.usersTable[user.username] = {
        username: user.username,
        sessionCount: 0,
        totalActiveSeconds: 0,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        lastActiveTimestamp: Date.now()
      };
    }
    return user.username;
  }

  public trackTokens(prompt: number, completion: number) {
    const username = this.ensureUserEntry();
    if (username) {
      this.usersTable[username].totalPromptTokens += prompt;
      this.usersTable[username].totalCompletionTokens += completion;
      this.save();
    }
  }

  public updateHeartbeat() {
    const username = this.ensureUserEntry();
    if (username) {
      this.usersTable[username].totalActiveSeconds += 10;
      this.usersTable[username].lastActiveTimestamp = Date.now();
      this.save();
    }
  }

  public incrementSession() {
    const username = this.ensureUserEntry();
    if (username) {
      this.usersTable[username].sessionCount += 1;
      this.save();
    }
  }

  // 管理员专用：获取所有用户统计
  public getAllStats(): UserStats[] {
    this.refresh();
    if (!auth.isAdmin()) return [];
    return Object.values(this.usersTable).sort((a, b) => b.lastActiveTimestamp - a.lastActiveTimestamp);
  }

  public getSystemSummary() {
    this.refresh();
    const stats = this.getAllStats();
    return {
      "累计用户": stats.length,
      "总消耗 Token": stats.reduce((acc, s) => acc + s.totalPromptTokens + s.totalCompletionTokens, 0),
      "总探索时长 (h)": (stats.reduce((acc, s) => acc + s.totalActiveSeconds, 0) / 3600).toFixed(1)
    };
  }
}

export const monitor = new MonitoringService();
