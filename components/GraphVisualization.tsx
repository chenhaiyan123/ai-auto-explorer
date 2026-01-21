
import React, { useEffect, useRef, useMemo } from 'react';
import * as d3 from 'd3';
import { ProblemNode, NodeStatus } from '../types';
import { STATUS_COLORS } from '../constants';

interface GraphVisualizationProps {
  nodes: ProblemNode[];
  onNodeClick: (node: ProblemNode) => void;
  onNodeContextMenu: (node: ProblemNode, x: number, y: number) => void;
}

const GraphVisualization: React.FC<GraphVisualizationProps> = ({ nodes, onNodeClick, onNodeContextMenu }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 关键点：使用 useMemo 稳定节点过滤逻辑，防止 D3 仿真每一帧都触发 React 渲染循环
  const visibleNodes = useMemo(() => {
    const hiddenNodeIds = new Set<string>();
    const list = nodes || [];
    
    const checkHidden = (nodeId: string): boolean => {
      if (hiddenNodeIds.has(nodeId)) return true;
      const node = list.find(n => n.id === nodeId);
      if (!node) return false;
      
      for (const depId of node.dependencies) {
        const parent = list.find(n => n.id === depId);
        if (parent && (parent.isCollapsed || checkHidden(depId))) {
          hiddenNodeIds.add(nodeId);
          return true;
        }
      }
      return false;
    };

    list.forEach(n => checkHidden(n.id));
    return list.filter(n => !hiddenNodeIds.has(n.id));
  }, [nodes]);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || visibleNodes.length === 0) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove(); 

    const g = svg.append("g");

    const zoom = d3.zoom<SVGSVGElement, unknown>().on("zoom", (event) => {
      g.attr("transform", event.transform);
    });

    svg.call(zoom);

    const links: { source: string; target: string }[] = [];
    visibleNodes.forEach(node => {
      node.dependencies.forEach(depId => {
        if (visibleNodes.some(n => n.id === depId)) {
          links.push({ source: depId, target: node.id });
        }
      });
    });

    // 预处理固定坐标：如果 node.isPinned 为真，锁定 fx 和 fy
    visibleNodes.forEach((n: any) => {
      if (n.isPinned && typeof n.x === 'number' && typeof n.y === 'number') {
        n.fx = n.x;
        n.fy = n.y;
      } else {
        n.fx = null;
        n.fy = null;
      }
    });

    const simulation = d3.forceSimulation(visibleNodes as any)
      .force("link", d3.forceLink(links).id((d: any) => d.id).distance(150))
      .force("charge", d3.forceManyBody().strength(-500))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(60));

    svg.append("defs").append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 25)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#475569");

    const link = g.append("g")
      .selectAll("line")
      .data(links)
      .enter().append("line")
      .attr("stroke", "#475569")
      .attr("stroke-width", 2)
      .attr("marker-end", "url(#arrow)");

    const nodeGroup = g.append("g")
      .selectAll("g")
      .data(visibleNodes)
      .enter().append("g")
      .attr("cursor", "pointer")
      .on("click", (event, d) => {
        if (event.defaultPrevented) return;
        onNodeClick(d);
      })
      .on("contextmenu", (event, d) => {
        event.preventDefault();
        onNodeContextMenu(d, event.pageX, event.pageY);
      })
      .call(d3.drag<SVGGElement, any>()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended) as any);

    nodeGroup.append("circle")
      .attr("r", 24)
      .attr("fill", "transparent")
      .attr("stroke", (d) => d.isCollapsed ? STATUS_COLORS[d.status] : "transparent")
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", "4,2");

    nodeGroup.append("circle")
      .attr("r", 20)
      .attr("fill", (d) => STATUS_COLORS[d.status])
      .attr("stroke", "#ffffff")
      .attr("stroke-width", 2)
      .classed("animate-pulse", (d) => d.status === NodeStatus.EXPLORING);

    // 增强视觉反馈：星标（右上）、锁标（左下）
    nodeGroup.each(function(d) {
      if (d.status === NodeStatus.NEEDS_REVIEW) {
        d3.select(this).append("circle")
          .attr("r", 6)
          .attr("cx", 15)
          .attr("cy", -15)
          .attr("fill", "#ef4444") 
          .attr("stroke", "#ffffff")
          .attr("stroke-width", 1.5);
      }
      
      if (d.isCritical) {
        d3.select(this).append("text")
          .attr("x", 12)
          .attr("y", -14)
          .attr("font-size", "14px")
          .text("⭐")
          .attr("text-anchor", "middle");
      }

      if (d.isPinned) {
        d3.select(this).append("text")
          .attr("x", -15)
          .attr("y", 15)
          .attr("font-size", "12px")
          .text("🔒")
          .attr("text-anchor", "middle");
      }
    });

    nodeGroup.append("text")
      .text((d) => d.title.length > 20 ? d.title.slice(0, 17) + "..." : d.title)
      .attr("dy", 40)
      .attr("text-anchor", "middle")
      .attr("fill", "#f8fafc")
      .attr("font-size", "12px")
      .attr("font-weight", "500");

    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);

      nodeGroup
        .attr("transform", (d: any) => `translate(${d.x},${d.y})`);
    });

    function dragstarted(event: any) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    }

    function dragged(event: any) {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    }

    function dragended(event: any) {
      if (!event.active) simulation.alphaTarget(0);
      // 如果节点被固定，不清除 fx/fy
      if (!event.subject.isPinned) {
        event.subject.fx = null;
        event.subject.fy = null;
      }
    }

    // 清理仿真
    return () => {
      simulation.stop();
    };

  }, [visibleNodes, onNodeClick, onNodeContextMenu]);

  return (
    <div ref={containerRef} className="w-full h-full bg-slate-900 overflow-hidden relative">
      <svg ref={svgRef} className="w-full h-full" />
      <div className="absolute bottom-4 left-4 bg-slate-800/80 p-3 rounded-lg border border-slate-700 backdrop-blur-sm text-xs space-y-2 pointer-events-none">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: STATUS_COLORS[NodeStatus.UNEXPLORED] }}></div>
          <span>未探索</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full animate-pulse" style={{ backgroundColor: STATUS_COLORS[NodeStatus.EXPLORING] }}></div>
          <span>探索中...</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: STATUS_COLORS[NodeStatus.SOLVED] }}></div>
          <span>已解决</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full relative" style={{ backgroundColor: STATUS_COLORS[NodeStatus.NEEDS_REVIEW] }}>
            <div className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full border border-white"></div>
          </div>
          <span>待决策 (点击节点查看)</span>
        </div>
      </div>
    </div>
  );
};

export default GraphVisualization;
