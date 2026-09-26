/**
 * knowledge-hub.ts — Personal Knowledge Hub
 *
 * Folder/project system for organizing saved work:
 * - STT transcripts
 * - Generated PDFs
 * - Mindmaps
 * - Quiz results
 *
 * All stored in browser localStorage (IndexedDB for larger items).
 */

export interface Project {
  id: string;
  name: string;
  description?: string;
  color: string; // hex color for folder icon
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeItem {
  id: string;
  projectId: string;
  type: 'stt' | 'pdf' | 'mindmap' | 'quiz' | 'note' | 'image';
  title: string;
  content: string; // text content or data URL for images
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

const PROJECTS_KEY = 'alynne-projects';
const ITEMS_KEY = 'alynne-knowledge-items';

const COLORS = [
  '#8B5CF6', '#3B82F6', '#10B981', '#F59E0B',
  '#EF4444', '#EC4899', '#06B6D4', '#84CC16',
];

// ── Projects ──

export function getProjects(): Project[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(PROJECTS_KEY) || '[]');
  } catch {
    return [];
  }
}

export function createProject(name: string, description?: string): Project {
  const projects = getProjects();
  const project: Project = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    description,
    color: COLORS[projects.length % COLORS.length],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  projects.push(project);
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  return project;
}

export function deleteProject(id: string): void {
  const projects = getProjects().filter((p) => p.id !== id);
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  // Also delete all items in this project
  const items = getItems().filter((i) => i.projectId !== id);
  localStorage.setItem(ITEMS_KEY, JSON.stringify(items));
}

export function updateProject(id: string, updates: Partial<Project>): void {
  const projects = getProjects().map((p) =>
    p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p
  );
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
}

// ── Items ──

export function getItems(projectId?: string): KnowledgeItem[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const items: KnowledgeItem[] = JSON.parse(localStorage.getItem(ITEMS_KEY) || '[]');
    return projectId ? items.filter((i) => i.projectId === projectId) : items;
  } catch {
    return [];
  }
}

export function saveItem(item: Omit<KnowledgeItem, 'id' | 'createdAt' | 'updatedAt'>): KnowledgeItem {
  const items = getItems();
  const newItem: KnowledgeItem = {
    ...item,
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  items.unshift(newItem); // newest first
  // Limit to 500 items to avoid localStorage overflow
  const trimmed = items.slice(0, 500);
  localStorage.setItem(ITEMS_KEY, JSON.stringify(trimmed));
  // Update project updatedAt
  updateProject(newItem.projectId, {});
  return newItem;
}

export function deleteItem(id: string): void {
  const items = getItems().filter((i) => i.id !== id);
  localStorage.setItem(ITEMS_KEY, JSON.stringify(items));
}

export function getItem(id: string): KnowledgeItem | null {
  return getItems().find((i) => i.id === id) || null;
}

// ── Quick save helpers ──

export function quickSaveSTT(transcript: string, projectName?: string): KnowledgeItem {
  let project = projectName
    ? getProjects().find((p) => p.name.toLowerCase() === projectName.toLowerCase())
    : null;

  if (!project) {
    project = createProject(projectName || 'STT Transcripts');
  }

  return saveItem({
    projectId: project.id,
    type: 'stt',
    title: `STT ${new Date().toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`,
    content: transcript,
    metadata: { length: transcript.length },
  });
}

export function quickSavePDF(title: string, content: string, projectName?: string): KnowledgeItem {
  let project = projectName
    ? getProjects().find((p) => p.name.toLowerCase() === projectName.toLowerCase())
    : null;

  if (!project) {
    project = createProject(projectName || 'Modul PDF');
  }

  return saveItem({
    projectId: project.id,
    type: 'pdf',
    title,
    content,
  });
}

export function quickSaveNote(title: string, content: string, projectName?: string): KnowledgeItem {
  let project = projectName
    ? getProjects().find((p) => p.name.toLowerCase() === projectName.toLowerCase())
    : null;

  if (!project) {
    project = createProject(projectName || 'Catatan');
  }

  return saveItem({
    projectId: project.id,
    type: 'note',
    title,
    content,
  });
}

// ── Stats ──

export function getHubStats(): {
  totalProjects: number;
  totalItems: number;
  byType: Record<string, number>;
  recentItems: KnowledgeItem[];
} {
  const projects = getProjects();
  const items = getItems();
  const byType: Record<string, number> = {};
  items.forEach((i) => {
    byType[i.type] = (byType[i.type] || 0) + 1;
  });

  return {
    totalProjects: projects.length,
    totalItems: items.length,
    byType,
    recentItems: items.slice(0, 5),
  };
}
