/**
 * MindmapGraph.tsx  -  Visual SVG mindmap (not text tree)
 *
 * Renders chapters as radial graph:
 * - Center node: root title
 * - Outer nodes: chapters
 * - Connect with curved lines
 * - Clickable nodes to select chapter
 */

import { useMemo } from 'react';
import type { Chapter } from '@/lib/stt-chapter-splitter';

interface MindmapGraphProps {
  chapters: Chapter[];
  activeChapterId: number | null;
  onSelectChapter: (id: number) => void;
}

interface NodePos {
  x: number;
  y: number;
  label: string;
  id: number;
  isRoot?: boolean;
}

export function MindmapGraph({ chapters, activeChapterId, onSelectChapter }: MindmapGraphProps) {
  const nodes = useMemo(() => {
    if (chapters.length === 0) return [];

    const width = 600;
    const height = 400;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = 140;

    const positions: NodePos[] = [];

    // Root node
    const rootTitle = chapters[0].title.split(' ').slice(0, 4).join(' ');
    positions.push({
      x: centerX,
      y: centerY,
      label: rootTitle || 'Materi STT',
      id: 0,
      isRoot: true,
    });

    // Chapter nodes in circle
    chapters.forEach((ch, i) => {
      const angle = (i / chapters.length) * 2 * Math.PI - Math.PI / 2;
      positions.push({
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
        label: `Bab ${ch.id}`,
        id: ch.id,
      });
    });

    return positions;
  }, [chapters]);

  if (chapters.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-stone-500">
        Belum ada bab
      </div>
    );
  }

  const width = 600;
  const height = 400;

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ minWidth: 400 }}
      >
        {/* Connections (lines from root to each chapter) */}
        {nodes.slice(1).map((node) => {
          const root = nodes[0];
          const isActive = node.id === activeChapterId;
          return (
            <line
              key={`line-${node.id}`}
              x1={root.x}
              y1={root.y}
              x2={node.x}
              y2={node.y}
              stroke={isActive ? '#D9A87E' : '#44403C'}
              strokeWidth={isActive ? 2 : 1}
              strokeDasharray={isActive ? '0' : '4'}
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => {
          const isActive = node.id === activeChapterId;
          const isRoot = node.isRoot;
          const r = isRoot ? 45 : 28;

          return (
            <g
              key={`node-${node.id}`}
              onClick={() => !isRoot && onSelectChapter(node.id)}
              style={{ cursor: isRoot ? 'default' : 'pointer' }}
            >
              {/* Glow effect for active */}
              {isActive && (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={r + 6}
                  fill="#D9A87E"
                  opacity={0.2}
                />
              )}
              <circle
                cx={node.x}
                cy={node.y}
                r={r}
                fill={isRoot ? '#D9A87E' : isActive ? '#D9A87E' : '#25221E'}
                stroke={isRoot || isActive ? '#D9A87E' : '#44403C'}
                strokeWidth={2}
              />
              <text
                x={node.x}
                y={node.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={isRoot || isActive ? 'white' : '#ABA49A'}
                fontSize={isRoot ? 11 : 10}
                fontWeight={isRoot ? 'bold' : 'normal'}
              >
                {node.label}
              </text>
              {!isRoot && (
                <text
                  x={node.x}
                  y={node.y + 14}
                  textAnchor="middle"
                  fill={isActive ? '#D9A87E' : '#57534E'}
                  fontSize={8}
                >
                  {chapters.find((c) => c.id === node.id)?.wordCount || 0} kata
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
