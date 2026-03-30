"use client";

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import ReactFlow, { 
  Background, 
  Controls, 
  Node, 
  Edge,
  Handle,
  Position,
  NodeProps,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  Panel
} from 'reactflow';
import * as d3 from 'd3-force';
import 'reactflow/dist/style.css';
import { Sparkles, Brain, Layers, MousePointer2, Share2, Info, Target, Zap, Circle } from 'lucide-react';
import { PATTERN_COLORS, PATTERN_TRANSLATIONS, PATTERN_GROUPS, PATTERN_TO_GROUP } from '@/lib/constants';

// --- Helper for Colors ---
const getFamilyColor = (family: string) => {
  if (!family || family === 'general') return { base: '#3b82f6', light: '#eff6ff', border: '#bfdbfe', text: '#1e40af', glow: 'rgba(59, 130, 246, 0.08)' };
  
  const colors = [
    { base: '#3b82f6', light: '#eff6ff', border: '#3b82f6', text: '#1e40af', glow: 'rgba(59, 130, 246, 0.08)' },
    { base: '#8b5cf6', light: '#f5f3ff', border: '#8b5cf6', text: '#5b21b6', glow: 'rgba(139, 92, 246, 0.08)' },
    { base: '#ec4899', light: '#fdf2f8', border: '#ec4899', text: '#9d174d', glow: 'rgba(236, 72, 153, 0.08)' },
    { base: '#f59e0b', light: '#fffbeb', border: '#f59e0b', text: '#92400e', glow: 'rgba(245, 158, 11, 0.08)' },
    { base: '#10b981', light: '#ecfdf5', border: '#10b981', text: '#065f46', glow: 'rgba(16, 185, 129, 0.08)' },
    { base: '#ef4444', light: '#fef2f2', border: '#ef4444', text: '#991b1b', glow: 'rgba(239, 68, 68, 0.08)' },
  ];
  
  let hash = 0;
  for (let i = 0; i < family.length; i++) {
    hash = family.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

// --- Localization Mapping ---
const TRANSLATIONS: Record<string, string> = {
  // Families
  'relocation': 'Релокация',
  'tourism': 'Туризм',
  'travel_mistakes': 'Ошибки',
  'destination_comparison': 'Сравнение',
  'lifestyle': 'Лайфстайл',
  'finance': 'Финансы',
  'budget_destinations': 'Бюджет',
  'underrated_destinations': 'Скрытые места',
  'destination_recommendations': 'Рекомендации',
  'seasonal_destination_list': 'Сезонное',
  'country_route': 'Маршруты',
  'general_travel_topic': 'Общее',
  
  // Hunt Stages
  'Awareness': 'Осведомленность',
  'Consideration': 'Рассмотрение',
  'Solution': 'Решение',
  
  // Countries
  'Global': 'Весь мир',

  // UI Strings
  'Strategic Hub': 'Стратегический хаб',
  'REGION': 'РЕГИОН',
  'STAGE': 'СТАДИЯ',
  'Synthesizing Clusters': 'Синтез кластеров',
  'Designing DNA spheres...': 'Проектирование DNA сфер...',
  'DNA Spheres': 'DNA Сферы',
  'Immersive Mapping': 'Карта контента',
  'Visualize DNA': 'Визуализация DNA',
  'By content topics': 'По темам контента',
  'By geography': 'По географии',
  'By Hunt stages': 'По стадиям Hunt',
  'Nodes are grouped by': 'Узлы сгруппированы по',
  'topics': 'темам',
  'regions': 'регионам',
  'stages': 'стадиям',
  'Orbs serve as gravity centers.': 'Сферы служат центрами гравитации.',
  'Navigation Guide': 'Навигация',
  'Free Pan • Scroll Zoom • Fully Synced Views': 'Перетаскивание • Зум • Синхронизация',
  'Strategic Mapping': 'Стратегическое картирование',
  'Group by content topics or the Hunt ladder (awareness stages). This helps visualize how content moves users from awareness to pure solution.': 'Группировка по темам контента или лестнице Ханта (этапам осознанности). Это помогает увидеть, как контент ведет пользователя от интереса к решению.'
};

const t = (text: string) => TRANSLATIONS[text] || text;

// --- Custom Node Components ---

const ClusterOrbNode = ({ data }: NodeProps) => {
  const colors = useMemo(() => getFamilyColor(data.family), [data.family]);
  const radius = data.radius || 400;
  
  return (
    <div 
      className="relative pointer-events-none flex items-center justify-center rounded-full border-2 border-dashed transition-all duration-1000 overflow-visible"
      style={{
        width: radius * 2,
        height: radius * 2,
        backgroundColor: colors.glow,
        borderColor: `${colors.base}30`,
        boxShadow: `0 0 120px 20px ${colors.base}05`,
        // Center the content within the sized node
        transform: 'translate(-50%, -50%)', 
      }}
    >
      <div className="absolute top-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-50">
         <div className="px-6 py-2 rounded-full bg-white/90 border-2 text-xs font-black uppercase tracking-[0.3em] shadow-lg whitespace-nowrap" style={{ color: colors.text, borderColor: colors.base }}>
           {t(data.label) || `${t(data.family)} СФЕРА`}
         </div>
      </div>
    </div>
  );
};

const TopicNode = ({ data }: NodeProps) => {
  const familyColors = useMemo(() => getFamilyColor(data.family), [data.family]);
  const patternColors = useMemo(() => PATTERN_COLORS[data.pattern] || PATTERN_COLORS['other'], [data.pattern]);
  
  return (
    <div className="group relative flex flex-col items-center justify-center transition-all duration-500">
      <div 
        className="absolute -inset-6 rounded-full blur-3xl opacity-0 group-hover:opacity-40 transition-opacity" 
        style={{ backgroundColor: patternColors.base }}
      />
      <div 
        className="flex h-16 w-16 items-center justify-center rounded-2xl border-[3px] bg-white shadow-xl backdrop-blur-md transition-all group-hover:scale-110 z-10"
        style={{ borderColor: patternColors.base, boxShadow: `0 10px 20px -10px ${patternColors.base}50` }}
      >
        <Brain className="h-8 w-8" style={{ color: patternColors.base }} />
        <Handle type="source" position={Position.Bottom} className="opacity-0" />
        <Handle type="target" position={Position.Top} className="opacity-0" />
      </div>
      <div className="mt-4 max-w-[160px] text-center">
        <div 
          className="inline-block px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest shadow-sm mb-1 border relative z-20"
          style={{ backgroundColor: 'white', color: familyColors.text, borderColor: familyColors.base }}
        >
          {t(data.family) || t('Strategic Hub')}
        </div>
        <div className="text-[11px] font-black text-slate-900 line-clamp-2 leading-tight tracking-tight px-2 bg-white/60 backdrop-blur-sm rounded-lg py-1 shadow-sm border border-white/50">
          {data.label}
        </div>
      </div>
    </div>
  );
};

const StructureNode = ({ data }: NodeProps) => {
  return (
    <div className="group relative flex flex-col items-center justify-center transition-all duration-500">
      <div className="absolute -inset-4 rounded-full blur-2xl opacity-0 group-hover:opacity-40 transition-opacity bg-purple-400/20" />
      <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-purple-500 bg-white/95 shadow-2xl shadow-purple-200/50 backdrop-blur-md transition-all group-hover:scale-110 group-hover:-rotate-3 z-10">
        <Target className="h-8 w-8 text-purple-600" />
        <Handle type="source" position={Position.Bottom} className="opacity-0" />
        <Handle type="target" position={Position.Top} className="opacity-0" />
      </div>
      <div className="mt-3 max-w-[140px] text-center">
        <div className="text-[9px] font-black uppercase tracking-widest text-purple-600/60 mb-1">Виральный Путь</div>
        <div className="text-[11px] font-bold text-slate-800 line-clamp-2 leading-tight tracking-tight px-2 py-1 bg-purple-50/50 rounded-lg border border-purple-100 shadow-sm">
          {data.label.replace(/\(.*\)/, '').trim()}
        </div>
        {data.label.includes('(') && (
          <div className="mt-1 text-blue-600/70 font-black text-[8px] uppercase tracking-widest">
            {data.label.match(/\((.*)\)/)?.[1] || ''}
          </div>
        )}
      </div>
    </div>
  );
};

const HubNode = ({ data }: NodeProps) => {
  return (
    <div className="flex flex-col items-center justify-center pointer-events-none opacity-0 h-0 w-0">
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
      <Handle type="target" position={Position.Top} className="opacity-0" />
    </div>
  );
}

const nodeTypes = {
  topic: TopicNode,
  structure: StructureNode,
  orb: ClusterOrbNode,
  hub: HubNode,
};

const edgeTypes = {
  tether: ({ id, sourceX, sourceY, targetX, targetY, style, markerEnd }: any) => {
    return (
      <path
        id={id}
        style={{ ...style, stroke: '#000000', strokeWidth: 1.5, strokeOpacity: 0.5, strokeDasharray: '4 4' }}
        className="react-flow__edge-path"
        d={`M${sourceX},${sourceY} L${targetX},${targetY}`}
        markerEnd={markerEnd}
      />
    );
  }
};
const fitViewOptions = { padding: 0.2 };

// --- Main Component ---

interface GraphScreenProps {
  clientId: string;
}

type GroupBy = 'family' | 'country' | 'huntStage';

export const GraphScreen: React.FC<GraphScreenProps> = ({ clientId }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [groupBy, setGroupBy] = useState<GroupBy>('family');
  const [rawGraphData, setRawGraphData] = useState<{nodes: any[], edges: any[]} | null>(null);

  // Helper for coordinates
  const getClusterCenter = useCallback((type: string, category: string, subCategory: string, families: string[]) => {
    const angleStep = (2 * Math.PI) / (families.length || 1);
    const index = families.indexOf(category);
    const radius = 900; 
    const centerX = 1500;
    const centerY = 1200;
    
    if (index === -1) return { x: centerX, y: centerY };
    
    // Base center for the family
    const familyX = centerX + radius * Math.cos(index * angleStep);
    const familyY = centerY + radius * Math.sin(index * angleStep);

    // If we have a subcategory (pattern), offset it from the family center
    if (subCategory) {
      const groupName = PATTERN_TO_GROUP[subCategory] || 'Other';
      const groupKeys = Object.keys(PATTERN_GROUPS);
      const groupIndex = groupKeys.indexOf(groupName);
      
      if (groupIndex !== -1) {
        // Group nodes by their pattern category (Expertise, Utility, Trust)
        const subAngle = (groupIndex / groupKeys.length) * 2 * Math.PI;
        const subDist = 280; // Larger distance to separate groups clearly
        return {
          x: familyX + subDist * Math.cos(subAngle),
          y: familyY + subDist * Math.sin(subAngle)
        };
      }
    }
    
    return { x: familyX, y: familyY };
  }, []);

  const runForceLayout = useCallback((initialNodes: any[], initialEdges: any[], currentGroupBy: GroupBy) => {
    // 1. Determine Groups
    const getGroup = (n: any) => {
      if (n.type !== 'topic') return n.data.pattern || 'general';
      return n.data[currentGroupBy] || 'general';
    };

    const topicGroups = Array.from(new Set(initialNodes.filter(n => n.type === 'topic').map(getGroup)));
    
    // 1.1 Create Hub nodes for each group
    const hubNodes = topicGroups.map(group => ({
      id: `hub-${group}`,
      type: 'hub',
      data: { family: group, label: group },
      position: { x: 1500, y: 1200 },
    }));

    // 1.2 Create Tether edges (Topic -> Hub)
    const tethers = initialNodes
      .filter(n => n.type === 'topic')
      .map(n => ({
        id: `tether-${n.id}`,
        source: `hub-${getGroup(n)}`,
        target: n.id,
        type: 'tether',
        selectable: false,
      }));

    const allInitialNodes = [...hubNodes, ...initialNodes];
    const allInitialEdges = [...tethers, ...initialEdges];

    // 2. D3 Simulation setup
    const d3Nodes = allInitialNodes.map((n) => ({ 
      ...n, 
      x: n.x || Math.random() * 3000, 
      y: n.y || Math.random() * 2400 
    }));
    
    const d3Links = allInitialEdges.map((e) => ({ 
      source: e.source, 
      target: e.target 
    }));

    const simulation = d3.forceSimulation(d3Nodes as any)
      .force("link", d3.forceLink(d3Links).id((d: any) => d.id).distance((d: any) => d.type === 'tether' ? 250 : 150)) 
      .force("charge", d3.forceManyBody().strength((d: any) => d.type === 'hub' ? -3000 : -1500)) 
      .force("center", d3.forceCenter(1500, 1200))
      .force("cluster", (alpha) => {
        for (const d of d3Nodes as any) {
          const category = getGroup(d);
          const subCategory = d.type === 'topic' ? (d.data.pattern || '') : '';
          const center = getClusterCenter(d.type, category, subCategory, topicGroups);
          
          const strength = d.type === 'hub' ? 1.0 : 0.45;
          d.vx += (center.x - d.x) * alpha * strength; 
          d.vy += (center.y - d.y) * alpha * strength;
        }
      })
      .force("pattern-group-attraction", (alpha) => {
        // Pull nodes of same pattern GROUP together
        const nodesByGroup: Record<string, any[]> = {};
        for (const d of d3Nodes as any) {
           if (d.data.pattern) {
             const group = PATTERN_TO_GROUP[d.data.pattern] || 'Other';
             if (!nodesByGroup[group]) nodesByGroup[group] = [];
             nodesByGroup[group].push(d);
           }
        }

        Object.values(nodesByGroup).forEach(group => {
          if (group.length < 2) return;
          const avgX = group.reduce((a, b) => a + b.x, 0) / group.length;
          const avgY = group.reduce((a, b) => a + b.y, 0) / group.length;
          group.forEach(d => {
            d.vx += (avgX - d.x) * alpha * 0.15;
            d.vy += (avgY - d.y) * alpha * 0.15;
          });
        });
      })
      .force("collide", d3.forceCollide().radius((d: any) => d.type === 'hub' ? 300 : 120)) 
      .stop();

    for (let i = 0; i < 300; ++i) simulation.tick();

    // 3. Position regular nodes
    const positionedNodes = d3Nodes.filter(n => n.type !== 'orb').map((n) => ({
      ...n,
      position: { x: n.x || 0, y: n.y || 0 },
      draggable: n.type !== 'hub',
      zIndex: n.type === 'hub' ? 1 : 10,
    }));

    // 4. Generate Orb Nodes (Spheres)
    const orbNodes = topicGroups.map(group => {
      const familyNodes = positionedNodes.filter(n => getGroup(n) === group);
      const hubNode = positionedNodes.find(n => n.id === `hub-${group}`);
      if (familyNodes.length === 0 || !hubNode) return null;
      
      const centerX = hubNode.position.x;
      const centerY = hubNode.position.y;
      
      let maxDist = 300;
      familyNodes.forEach(n => {
        const d = Math.sqrt(Math.pow(n.position.x - centerX, 2) + Math.pow(n.position.y - centerY, 2));
        if (d > maxDist) maxDist = d;
      });
      
      const labelPrefix = currentGroupBy === 'family' ? '' : (currentGroupBy === 'country' ? `${t('REGION')}: ` : `${t('STAGE')}: `);

      return {
        id: `orb-${group}`,
        type: 'orb',
        position: { x: centerX, y: centerY }, 
        data: { family: group, radius: maxDist + 280, label: `${labelPrefix}${t(group)}` },
        zIndex: -1,
        draggable: false,
        selectable: false,
        connectable: false,
      };
    }).filter(Boolean);

    setNodes([...orbNodes, ...positionedNodes] as any);
    setEdges(allInitialEdges.map(e => ({
      ...e,
      label: e.type === 'tether' ? '' : e.label, // Remove labels from tethers
      animated: e.type !== 'tether',
      style: e.type === 'tether' 
        ? { stroke: '#000000', strokeWidth: 1.5, opacity: 0.5, strokeDasharray: '4 4' }
        : { stroke: '#000000', strokeWidth: 1.5, opacity: 0.5, strokeDasharray: '10,10' }, // Also black/50% for relationship edges
    })));
  }, [setNodes, setEdges, getClusterCenter, t]);

  useEffect(() => {
    const fetchGraphData = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/analytics/graph?clientId=${clientId}`);
        const data = await response.json();
        setRawGraphData(data);
      } catch (error) {
        console.error('Failed to fetch graph data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    if (clientId) {
      fetchGraphData();
    }
  }, [clientId]); 

  useEffect(() => {
    if (rawGraphData) {
      runForceLayout(rawGraphData.nodes, rawGraphData.edges, groupBy);
    }
  }, [groupBy, rawGraphData, runForceLayout]);

  const onNodeDrag = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type !== 'topic') return;

    setNodes((nds) => {
      const family = node.data.family;
      const allNodes = nds.map(n => n.id === node.id ? node : n);
      const familyNodes = allNodes.filter(n => n.type === 'topic' && n.data.family === family);
      
      if (familyNodes.length === 0) return nds;

      const avgX = familyNodes.reduce((acc, n) => acc + n.position.x, 0) / familyNodes.length;
      const avgY = familyNodes.reduce((acc, n) => acc + n.position.y, 0) / familyNodes.length;

      return allNodes.map((n) => {
        if (n.id === `hub-${family}` || n.id === `orb-${family}`) {
          return { ...n, position: { x: avgX, y: avgY } };
        }
        return n;
      });
    });
  }, [setNodes]);

  return (
    <div className="relative h-[85vh] w-full rounded-[3.5rem] border-2 border-slate-100 bg-slate-50/50 shadow-2xl overflow-hidden glassmorphism-dark">
      {isLoading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/95 backdrop-blur-xl">
          <div className="flex flex-col items-center gap-8">
            <div className="relative">
              <div className="h-32 w-32 animate-spin rounded-full border-[8px] border-slate-100 border-t-blue-600 shadow-2xl" />
              <Zap className="absolute inset-0 m-auto h-14 w-14 text-blue-600 animate-pulse" />
            </div>
            <div className="text-center">
              <h2 className="text-4xl font-black text-slate-900 tracking-tighter">{t('Synthesizing Clusters')}</h2>
              <p className="text-sm text-slate-500 font-bold mt-3 uppercase tracking-[0.4em] opacity-60">{t('Designing DNA spheres...')}</p>
            </div>
          </div>
        </div>
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDrag={onNodeDrag}
        fitView
        fitViewOptions={fitViewOptions}
        minZoom={0.01}
        maxZoom={1.5}
      >
        <Background variant={BackgroundVariant.Lines} gap={80} size={1} color="#e2e8f0" />
        <Controls className="!bg-white !border-slate-200 !shadow-2xl !rounded-[2rem] overflow-hidden !m-12" />
        
        <Panel position="top-left" className="m-6">
          <div className="bg-white/80 backdrop-blur-2xl p-1.5 rounded-[2rem] border border-white/40 shadow-[0_10px_40px_-15px_rgba(0,0,0,0.1)] flex items-center gap-1">
            {[
              { id: 'family', label: 'Темы', icon: Brain },
              { id: 'huntStage', label: 'Лестница Hunt', icon: Target },
            ].map((option) => (
              <button
                key={option.id}
                onClick={() => setGroupBy(option.id as GroupBy)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-[1.5rem] transition-all duration-300 font-bold text-[11px] tracking-tight ${
                  groupBy === option.id 
                    ? 'bg-slate-900 text-white shadow-lg scale-[1.03]' 
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/50'
                }`}
              >
                <option.icon className={`h-4 w-4 ${groupBy === option.id ? 'text-blue-400' : 'text-slate-400'}`} />
                <span className="whitespace-nowrap">{option.label}</span>
              </button>
            ))}
            
            <div className="group relative ml-1">
              <div className="h-9 w-9 rounded-full bg-slate-50/50 flex items-center justify-center cursor-help transition-all hover:bg-white hover:shadow-sm border border-transparent hover:border-slate-100">
                <Info className="h-4 w-4 text-slate-400" />
              </div>
              <div className="absolute top-12 left-0 w-64 p-4 bg-slate-900/95 backdrop-blur-xl text-white rounded-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 shadow-2xl z-50 border border-white/10">
                <p className="text-[11px] font-bold mb-1 text-blue-400 uppercase tracking-wider">{t('Strategic Mapping')}</p>
                <p className="text-[10px] text-slate-300 leading-relaxed font-medium">
                  {t('Group by content topics or the Hunt ladder (awareness stages). This helps visualize how content moves users from awareness to pure solution.')}
                </p>
              </div>
            </div>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
};
