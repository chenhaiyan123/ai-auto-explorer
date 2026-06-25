
import React, { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import * as d3 from 'd3';
import { ProblemNode, NodeStatus } from '../types';
import { STATUS_COLORS } from '../constants';
import { buildAssocEdges } from '../services/noteLinks';

interface GraphVisualizationProps {
  nodes: ProblemNode[];
  onNodeClick: (node: ProblemNode) => void;
  onNodeContextMenu: (node: ProblemNode, x: number, y: number) => void;
  onToggleCollapse?: (nodeId: string) => void;
  onBatchUpdateNodes?: (updates: { id: string; changes: Partial<ProblemNode> }[]) => void;
}

// 层级颜色
const LEVEL_COLORS = [
  '#8b5cf6', // 0: 紫色 - 核心
  '#6366f1', // 1: 靛蓝 - 主干
  '#3b82f6', // 2: 蓝色
  '#0ea5e9', // 3: 天蓝
  '#14b8a6', // 4: 青色
  '#10b981', // 5+: 绿色
];

// 计算节点层级
const calculateNodeLevels = (nodes: ProblemNode[]): Map<string, number> => {
  const levels = new Map<string, number>();
  const rootNodes = nodes.filter(n => !n.dependencies || n.dependencies.length === 0);
  rootNodes.forEach(n => levels.set(n.id, 0));
  
  const queue = [...rootNodes];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLevel = levels.get(current.id) || 0;
    nodes.forEach(n => {
      if (n.dependencies?.includes(current.id) && !levels.has(n.id)) {
        levels.set(n.id, currentLevel + 1);
        queue.push(n);
      }
    });
  }
  return levels;
};

// 计算隐藏子节点数
const countHiddenChildren = (nodeId: string, allNodes: ProblemNode[], visibleIds: Set<string>): number => {
  let count = 0;
  const countRecursive = (id: string) => {
    allNodes.forEach(n => {
      if (n.dependencies?.includes(id)) {
        if (!visibleIds.has(n.id)) count++;
        countRecursive(n.id);
      }
    });
  };
  countRecursive(nodeId);
  return count;
};

// 简化标题
const simplifyTitle = (title: string, maxLen: number = 8): string => {
  if (!title) return '...';
  let t = title.replace(/^(如何|怎么|怎样|为什么|什么是|关于)/, '').replace(/[？?]$/, '');
  return t.length > maxLen ? t.slice(0, maxLen - 1) + '…' : t;
};

const GraphVisualization: React.FC<GraphVisualizationProps> = ({ 
  nodes, 
  onNodeClick, 
  onNodeContextMenu,
  onToggleCollapse,
  onBatchUpdateNodes
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const miniMapRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // 控制状态
  const [maxLevel, setMaxLevel] = useState(3); // 显示层级
  const [layoutMode, setLayoutMode] = useState<'tree' | 'force'>('tree');
  const [viewMode, setViewMode] = useState<'graph' | 'outline'>('graph');
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [showAssoc, setShowAssoc] = useState(true); // 关联(wikilink)连线显隐

  const nodeLevels = useMemo(() => calculateNodeLevels(nodes || []), [nodes]);
  
  // 最大层级
  const maxAvailableLevel = useMemo(() => {
    let max = 0;
    nodeLevels.forEach(level => { if (level > max) max = level; });
    return max;
  }, [nodeLevels]);

  // 可见节点（考虑折叠 + 层级过滤）
  const { visibleNodes, hiddenChildrenCount } = useMemo(() => {
    const hiddenNodeIds = new Set<string>();
    const list = nodes || [];
    
    const checkHidden = (nodeId: string): boolean => {
      if (hiddenNodeIds.has(nodeId)) return true;
      const node = list.find(n => n.id === nodeId);
      if (!node) return false;
      
      // 层级过滤
      const level = nodeLevels.get(nodeId) || 0;
      if (level > maxLevel) {
        hiddenNodeIds.add(nodeId);
        return true;
      }
      
      for (const depId of node.dependencies || []) {
        const parent = list.find(n => n.id === depId);
        if (parent && (parent.isCollapsed || checkHidden(depId))) {
          hiddenNodeIds.add(nodeId);
          return true;
        }
      }
      return false;
    };

    list.forEach(n => checkHidden(n.id));
    
    const visible = list.filter(n => !hiddenNodeIds.has(n.id));
    const visibleIds = new Set(visible.map(n => n.id));
    
    const hiddenCounts = new Map<string, number>();
    visible.forEach(n => {
      const count = countHiddenChildren(n.id, list, visibleIds);
      if (count > 0) hiddenCounts.set(n.id, count);
    });
    
    return { visibleNodes: visible, hiddenChildrenCount: hiddenCounts };
  }, [nodes, nodeLevels, maxLevel]);

  // 一键折叠/展开
  const handleCollapseAll = useCallback((collapse: boolean) => {
    if (!onBatchUpdateNodes) return;
    const updates = nodes
      .filter(n => nodes.some(child => child.dependencies?.includes(n.id)))
      .map(n => ({ id: n.id, changes: { isCollapsed: collapse } }));
    onBatchUpdateNodes(updates);
  }, [nodes, onBatchUpdateNodes]);

  const handleNodeClick = useCallback((event: any, d: ProblemNode) => {
    if (event.defaultPrevented) return;
    const hasChildren = nodes.some(n => n.dependencies?.includes(d.id));
    if (hasChildren && onToggleCollapse) {
      onToggleCollapse(d.id);
    }
    onNodeClick(d);
  }, [nodes, onNodeClick, onToggleCollapse]);

  // ========== 图谱渲染 ==========
  useEffect(() => {
    if (!svgRef.current || !containerRef.current || visibleNodes.length === 0 || viewMode !== 'graph') return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const g = svg.append("g");

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 3])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
        updateMiniMap(event.transform);
      });

    svg.call(zoom);

    // 连线数据（纵向 / 层级）
    const links: { source: string; target: string }[] = [];
    const nodeIdSet = new Set(visibleNodes.map(n => n.id));
    visibleNodes.forEach(node => {
      (node.dependencies || []).forEach(depId => {
        if (depId && nodeIdSet.has(depId)) {
          links.push({ source: depId, target: node.id });
        }
      });
    });

    // 关联连线（横向 / wikilink）：仅两端都可见
    const assocLinks = showAssoc ? buildAssocEdges(visibleNodes) : [];

    const getNodeRadius = (nodeId: string): number => {
      const level = nodeLevels.get(nodeId) || 0;
      return Math.max(32 - level * 4, 16);
    };

    const getNodeColor = (node: ProblemNode): string => {
      if (node.status === NodeStatus.SOLVED) return '#10b981';
      if (node.status === NodeStatus.EXPLORING) return '#f59e0b';
      if (node.status === NodeStatus.NEEDS_REVIEW) return '#ef4444';
      const level = nodeLevels.get(node.id) || 0;
      return LEVEL_COLORS[Math.min(level, LEVEL_COLORS.length - 1)];
    };

    // ===== 树形布局 =====
    if (layoutMode === 'tree') {
      const levelGroups = new Map<number, ProblemNode[]>();
      visibleNodes.forEach(n => {
        const level = nodeLevels.get(n.id) || 0;
        if (!levelGroups.has(level)) levelGroups.set(level, []);
        levelGroups.get(level)!.push(n);
      });

      const nodePositions = new Map<string, { x: number; y: number }>();
      const levelHeight = 100;
      const nodeSpacing = 120;

      levelGroups.forEach((nodesInLevel, level) => {
        const totalWidth = (nodesInLevel.length - 1) * nodeSpacing;
        const startX = (width - totalWidth) / 2;
        const y = 60 + level * levelHeight;
        nodesInLevel.forEach((node, index) => {
          nodePositions.set(node.id, { x: startX + index * nodeSpacing, y });
        });
      });

      // 箭头
      svg.append("defs").append("marker")
        .attr("id", "arrow")
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 15).attr("refY", 0)
        .attr("markerWidth", 5).attr("markerHeight", 5)
        .attr("orient", "auto")
        .append("path").attr("d", "M0,-4L10,0L0,4").attr("fill", "#64748b");

      // 关联连线（横向 wikilink，紫色虚线弧）——先画，置于层级连线之下
      assocLinks.forEach(link => {
        const s = nodePositions.get(link.source);
        const t = nodePositions.get(link.target);
        if (!s || !t) return;
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const dr = Math.hypot(dx, dy) * 1.1;
        g.append("path")
          .attr("d", `M${s.x},${s.y} A${dr},${dr} 0 0,1 ${t.x},${t.y}`)
          .attr("fill", "none").attr("stroke", "#a855f7").attr("stroke-width", 1.2)
          .attr("stroke-opacity", 0.55).attr("stroke-dasharray", "4,3");
      });

      // 连线（纵向 / 层级）
      links.forEach(link => {
        const s = nodePositions.get(link.source);
        const t = nodePositions.get(link.target);
        if (!s || !t) return;
        const sr = getNodeRadius(link.source);
        const tr = getNodeRadius(link.target);
        const midY = (s.y + t.y) / 2;
        g.append("path")
          .attr("d", `M${s.x},${s.y + sr} Q${s.x},${midY} ${(s.x + t.x) / 2},${midY} Q${t.x},${midY} ${t.x},${t.y - tr - 6}`)
          .attr("fill", "none").attr("stroke", "#475569").attr("stroke-width", 1.5).attr("stroke-opacity", 0.5)
          .attr("marker-end", "url(#arrow)");
      });

      // 节点
      const nodeGroup = g.append("g").selectAll("g").data(visibleNodes).enter().append("g")
        .attr("transform", d => { const p = nodePositions.get(d.id); return p ? `translate(${p.x},${p.y})` : ''; })
        .attr("cursor", "pointer")
        .on("click", handleNodeClick)
        .on("contextmenu", (e, d) => { e.preventDefault(); onNodeContextMenu(d, e.pageX, e.pageY); });

      // 折叠环
      nodeGroup.append("circle").attr("r", d => getNodeRadius(d.id) + 3)
        .attr("fill", "transparent").attr("stroke", d => d.isCollapsed ? "#fbbf24" : "transparent")
        .attr("stroke-width", 2).attr("stroke-dasharray", "4,2");

      // 主圆
      nodeGroup.append("circle").attr("r", d => getNodeRadius(d.id))
        .attr("fill", d => getNodeColor(d))
        .attr("stroke", d => (nodeLevels.get(d.id) || 0) <= 1 ? "#fff" : "#64748b")
        .attr("stroke-width", d => (nodeLevels.get(d.id) || 0) <= 1 ? 2.5 : 1.5)
        .style("filter", d => (nodeLevels.get(d.id) || 0) === 0 ? "drop-shadow(0 3px 6px rgba(139,92,246,0.4))" : "none")
        .classed("animate-pulse", d => d.status === NodeStatus.EXPLORING);

      // 标记
      nodeGroup.each(function(d) {
        const ng = d3.select(this);
        const r = getNodeRadius(d.id);
        const hc = hiddenChildrenCount.get(d.id);
        if (hc && hc > 0) {
          ng.append("circle").attr("r", 10).attr("cx", r + 4).attr("cy", 0).attr("fill", "#f59e0b").attr("stroke", "#fff").attr("stroke-width", 1.5);
          ng.append("text").attr("x", r + 4).attr("y", 3).attr("font-size", "9px").attr("fill", "#fff").attr("text-anchor", "middle").attr("font-weight", "bold").text(`+${hc}`);
        }
        if (d.status === NodeStatus.NEEDS_REVIEW) {
          ng.append("circle").attr("r", 7).attr("cx", r - 5).attr("cy", -r + 5).attr("fill", "#ef4444").attr("stroke", "#fff").attr("stroke-width", 1.5);
          ng.append("text").attr("x", r - 5).attr("y", -r + 8).attr("font-size", "9px").attr("fill", "#fff").attr("text-anchor", "middle").attr("font-weight", "bold").text("!");
        }
        if (d.isCritical) {
          ng.append("text").attr("x", -r + 3).attr("y", -r + 3).attr("font-size", "10px").text("⭐");
        }
      });

      // 标题
      nodeGroup.append("text").text(d => simplifyTitle(d.title, (nodeLevels.get(d.id) || 0) === 0 ? 10 : 8))
        .attr("dy", d => getNodeRadius(d.id) + 14).attr("text-anchor", "middle").attr("fill", "#e2e8f0")
        .attr("font-size", d => (nodeLevels.get(d.id) || 0) === 0 ? "12px" : "10px")
        .attr("font-weight", d => (nodeLevels.get(d.id) || 0) <= 1 ? "600" : "400");

      // 居中
      setTimeout(() => {
        const bounds = g.node()?.getBBox();
        if (bounds && bounds.width > 0) {
          const scale = Math.min((width - 40) / bounds.width, (height - 40) / bounds.height, 1.2);
          const tx = (width - bounds.width * scale) / 2 - bounds.x * scale;
          const ty = (height - bounds.height * scale) / 2 - bounds.y * scale;
          svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(Math.max(scale, 0.4)));
        }
      }, 50);

    } else {
      // ===== 力导向布局 =====
      svg.append("defs").append("marker")
        .attr("id", "arrow").attr("viewBox", "0 -5 10 10").attr("refX", 20).attr("refY", 0)
        .attr("markerWidth", 5).attr("markerHeight", 5).attr("orient", "auto")
        .append("path").attr("d", "M0,-4L10,0L0,4").attr("fill", "#64748b");

      const simulation = d3.forceSimulation(visibleNodes as any)
        .force("link", d3.forceLink(links).id((d: any) => d.id).distance(100).strength(0.5))
        .force("charge", d3.forceManyBody().strength(-300))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide().radius((d: any) => getNodeRadius(d.id) + 20));

      const nodeById = new Map(visibleNodes.map(n => [n.id, n as any]));

      // 关联连线（横向 wikilink，紫色虚线）——先画，置于层级连线之下
      const assocLine = g.append("g").selectAll("line").data(assocLinks).enter().append("line")
        .attr("stroke", "#a855f7").attr("stroke-width", 1.2).attr("stroke-opacity", 0.55).attr("stroke-dasharray", "4,3");

      const link = g.append("g").selectAll("line").data(links).enter().append("line")
        .attr("stroke", "#475569").attr("stroke-width", 1.5).attr("stroke-opacity", 0.5).attr("marker-end", "url(#arrow)");

      const nodeGroup = g.append("g").selectAll("g").data(visibleNodes).enter().append("g")
        .attr("cursor", "pointer")
        .on("click", handleNodeClick)
        .on("contextmenu", (e, d) => { e.preventDefault(); onNodeContextMenu(d, e.pageX, e.pageY); })
        .call(d3.drag<SVGGElement, any>()
          .on("start", (e) => { if (!e.active) simulation.alphaTarget(0.3).restart(); e.subject.fx = e.subject.x; e.subject.fy = e.subject.y; })
          .on("drag", (e) => { e.subject.fx = e.x; e.subject.fy = e.y; })
          .on("end", (e) => { if (!e.active) simulation.alphaTarget(0); e.subject.fx = null; e.subject.fy = null; }) as any);

      nodeGroup.append("circle").attr("r", d => getNodeRadius(d.id) + 3)
        .attr("fill", "transparent").attr("stroke", d => d.isCollapsed ? "#fbbf24" : "transparent").attr("stroke-width", 2).attr("stroke-dasharray", "4,2");

      nodeGroup.append("circle").attr("r", d => getNodeRadius(d.id)).attr("fill", d => getNodeColor(d))
        .attr("stroke", d => (nodeLevels.get(d.id) || 0) <= 1 ? "#fff" : "#64748b")
        .attr("stroke-width", d => (nodeLevels.get(d.id) || 0) <= 1 ? 2.5 : 1.5)
        .classed("animate-pulse", d => d.status === NodeStatus.EXPLORING);

      nodeGroup.each(function(d) {
        const ng = d3.select(this);
        const r = getNodeRadius(d.id);
        const hc = hiddenChildrenCount.get(d.id);
        if (hc && hc > 0) {
          ng.append("circle").attr("r", 10).attr("cx", r + 4).attr("cy", 0).attr("fill", "#f59e0b").attr("stroke", "#fff").attr("stroke-width", 1.5);
          ng.append("text").attr("x", r + 4).attr("y", 3).attr("font-size", "9px").attr("fill", "#fff").attr("text-anchor", "middle").attr("font-weight", "bold").text(`+${hc}`);
        }
      });

      nodeGroup.append("text").text(d => simplifyTitle(d.title, 8))
        .attr("dy", d => getNodeRadius(d.id) + 14).attr("text-anchor", "middle").attr("fill", "#e2e8f0").attr("font-size", "10px");

      simulation.on("tick", () => {
        link.attr("x1", (d: any) => d.source.x).attr("y1", (d: any) => d.source.y).attr("x2", (d: any) => d.target.x).attr("y2", (d: any) => d.target.y);
        assocLine
          .attr("x1", (d: any) => nodeById.get(d.source)?.x ?? 0).attr("y1", (d: any) => nodeById.get(d.source)?.y ?? 0)
          .attr("x2", (d: any) => nodeById.get(d.target)?.x ?? 0).attr("y2", (d: any) => nodeById.get(d.target)?.y ?? 0);
        nodeGroup.attr("transform", (d: any) => `translate(${d.x},${d.y})`);
      });

      return () => { simulation.stop(); };
    }

    // 小地图更新函数
    function updateMiniMap(transform: any) {
      if (!miniMapRef.current || !showMiniMap) return;
      const miniSvg = d3.select(miniMapRef.current);
      miniSvg.select(".viewport")
        .attr("x", -transform.x / transform.k / 5)
        .attr("y", -transform.y / transform.k / 5)
        .attr("width", width / transform.k / 5)
        .attr("height", height / transform.k / 5);
    }

  }, [visibleNodes, nodeLevels, hiddenChildrenCount, handleNodeClick, onNodeContextMenu, layoutMode, viewMode, showMiniMap, showAssoc]);

  // ========== 小地图 ==========
  useEffect(() => {
    if (!miniMapRef.current || !showMiniMap || viewMode !== 'graph' || visibleNodes.length === 0) return;
    
    const miniSvg = d3.select(miniMapRef.current);
    miniSvg.selectAll("*").remove();

    const miniG = miniSvg.append("g").attr("transform", "scale(0.2)");
    
    // 简化的节点显示
    visibleNodes.forEach(node => {
      const level = nodeLevels.get(node.id) || 0;
      const levelGroups = new Map<number, number>();
      let idx = 0;
      visibleNodes.forEach(n => {
        const l = nodeLevels.get(n.id) || 0;
        if (!levelGroups.has(l)) levelGroups.set(l, 0);
        if (n.id === node.id) idx = levelGroups.get(l)!;
        levelGroups.set(l, levelGroups.get(l)! + 1);
      });
      
      const count = visibleNodes.filter(n => (nodeLevels.get(n.id) || 0) === level).length;
      const x = 300 + (idx - count / 2) * 80;
      const y = 50 + level * 80;
      
      miniG.append("circle")
        .attr("cx", x).attr("cy", y).attr("r", 12)
        .attr("fill", LEVEL_COLORS[Math.min(level, LEVEL_COLORS.length - 1)])
        .attr("opacity", 0.8);
    });

    // 视口框
    miniSvg.append("rect").attr("class", "viewport")
      .attr("fill", "none").attr("stroke", "#60a5fa").attr("stroke-width", 2)
      .attr("x", 0).attr("y", 0).attr("width", 120).attr("height", 80);

  }, [visibleNodes, nodeLevels, showMiniMap, viewMode]);

  // ========== 大纲视图 ==========
  const renderOutline = () => {
    const levelGroups = new Map<number, ProblemNode[]>();
    visibleNodes.forEach(n => {
      const level = nodeLevels.get(n.id) || 0;
      if (!levelGroups.has(level)) levelGroups.set(level, []);
      levelGroups.get(level)!.push(n);
    });

    return (
      <div className="h-full overflow-auto p-4 space-y-3">
        {Array.from(levelGroups.entries()).sort((a, b) => a[0] - b[0]).map(([level, nodesInLevel]) => (
          <div key={level}>
            <div className="text-[10px] text-slate-500 mb-1 flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: LEVEL_COLORS[Math.min(level, LEVEL_COLORS.length - 1)] }}></div>
              第 {level + 1} 层 ({nodesInLevel.length})
            </div>
            <div className="space-y-1">
              {nodesInLevel.map(node => (
                <div 
                  key={node.id}
                  onClick={() => onNodeClick(node)}
                  className="flex items-center gap-2 px-2 py-1.5 rounded bg-slate-800/50 hover:bg-slate-700/50 cursor-pointer transition-colors"
                >
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: STATUS_COLORS[node.status] }}></div>
                  <span className="text-xs text-slate-300 truncate flex-1">{node.title}</span>
                  {hiddenChildrenCount.get(node.id) ? (
                    <span className="text-[10px] text-amber-400">+{hiddenChildrenCount.get(node.id)}</span>
                  ) : null}
                  {node.isCollapsed && <span className="text-[10px] text-slate-500">折叠</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div ref={containerRef} className="w-full h-full bg-gradient-to-b from-slate-900 to-slate-950 overflow-hidden relative">
      
      {/* 主视图 */}
      {viewMode === 'graph' ? (
        <svg ref={svgRef} className="w-full h-full" />
      ) : (
        renderOutline()
      )}

      {/* 控制面板 */}
      <div className="absolute top-3 left-3 bg-slate-800/90 rounded-lg border border-slate-700/50 p-2.5 space-y-2.5 backdrop-blur-sm">
        {/* 视图切换 */}
        <div className="flex gap-1">
          <button 
            onClick={() => setViewMode('graph')}
            className={`px-2 py-1 text-[10px] rounded transition-colors ${viewMode === 'graph' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
          >
            🔷 图谱
          </button>
          <button 
            onClick={() => setViewMode('outline')}
            className={`px-2 py-1 text-[10px] rounded transition-colors ${viewMode === 'outline' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
          >
            📋 大纲
          </button>
        </div>

        {viewMode === 'graph' && (
          <>
            {/* 布局切换 */}
            <div className="flex gap-1">
              <button 
                onClick={() => setLayoutMode('tree')}
                className={`px-2 py-1 text-[10px] rounded transition-colors ${layoutMode === 'tree' ? 'bg-violet-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
              >
                🌳 树形
              </button>
              <button 
                onClick={() => setLayoutMode('force')}
                className={`px-2 py-1 text-[10px] rounded transition-colors ${layoutMode === 'force' ? 'bg-violet-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
              >
                🕸️ 力导向
              </button>
            </div>

            {/* 层级过滤 */}
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>显示层级</span>
                <span>{maxLevel + 1} / {maxAvailableLevel + 1}</span>
              </div>
              <input 
                type="range" 
                min="0" 
                max={Math.max(maxAvailableLevel, 3)} 
                value={maxLevel}
                onChange={(e) => setMaxLevel(parseInt(e.target.value))}
                className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />
            </div>

            {/* 关联连线显隐 */}
            <button
              onClick={() => setShowAssoc(v => !v)}
              className={`w-full px-2 py-1 text-[10px] rounded transition-colors flex items-center justify-center gap-1 ${showAssoc ? 'bg-purple-600/80 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
              title="显示/隐藏 [[关联]] 连线"
            >
              🔗 关联连线 {showAssoc ? '开' : '关'}
            </button>

            {/* 折叠控制 */}
            <div className="flex gap-1">
              <button
                onClick={() => handleCollapseAll(true)}
                className="flex-1 px-2 py-1 text-[10px] bg-slate-700 text-slate-300 rounded hover:bg-slate-600 transition-colors"
              >
                📁 全部折叠
              </button>
              <button 
                onClick={() => handleCollapseAll(false)}
                className="flex-1 px-2 py-1 text-[10px] bg-slate-700 text-slate-300 rounded hover:bg-slate-600 transition-colors"
              >
                📂 全部展开
              </button>
            </div>
          </>
        )}
      </div>

      {/* 小地图 */}
      {viewMode === 'graph' && showMiniMap && (
        <div className="absolute bottom-3 right-3 bg-slate-800/80 rounded-lg border border-slate-700/50 p-1 backdrop-blur-sm">
          <div className="flex justify-between items-center mb-1 px-1">
            <span className="text-[9px] text-slate-500">小地图</span>
            <button onClick={() => setShowMiniMap(false)} className="text-slate-500 hover:text-slate-300 text-xs">×</button>
          </div>
          <svg ref={miniMapRef} width="120" height="80" className="bg-slate-900/50 rounded" />
        </div>
      )}

      {/* 小地图开关 */}
      {viewMode === 'graph' && !showMiniMap && (
        <button 
          onClick={() => setShowMiniMap(true)}
          className="absolute bottom-3 right-3 bg-slate-800/80 px-2 py-1 rounded text-[10px] text-slate-400 hover:bg-slate-700 border border-slate-700/50"
        >
          🗺️ 小地图
        </button>
      )}

      {/* 统计信息 */}
      <div className="absolute top-3 right-3 bg-slate-800/60 px-2.5 py-1.5 rounded text-[10px] text-slate-500 backdrop-blur-sm">
        显示 {visibleNodes.length} / {nodes.length}
      </div>

      {/* 图例 */}
      {viewMode === 'graph' && (
        <div className="absolute bottom-3 left-3 bg-slate-800/80 px-2.5 py-1.5 rounded-lg border border-slate-700/50 text-[9px] flex items-center gap-3">
          {LEVEL_COLORS.slice(0, 4).map((color, i) => (
            <div key={i} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }}></div>
              <span className="text-slate-500">L{i + 1}</span>
            </div>
          ))}
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full bg-amber-500 text-[7px] text-white flex items-center justify-center font-bold">+</div>
            <span className="text-slate-500">展开</span>
          </div>
          <div className="flex items-center gap-1">
            <svg width="14" height="6"><line x1="0" y1="3" x2="14" y2="3" stroke="#a855f7" strokeWidth="1.5" strokeDasharray="3,2" /></svg>
            <span className="text-slate-500">关联</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default GraphVisualization;
