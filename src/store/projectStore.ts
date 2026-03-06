import { create } from 'zustand';

export type FrameShape = 'circle' | 'square' | 'rectangle';
export type ThreadMode = 'bw' | 'color';

export interface ColorLayer {
  color: string; // hex color of the thread
  nailSequence: number[]; // ordered nail indices for this color
}

export interface Project {
  id: string;
  title: string;
  mode: ThreadMode;
  frameShape: FrameShape;
  nailCount: number;
  stringCount: number;
  frameDimensions: { width: number; height: number }; // in cm
  nailSequence: number[] | null; // B&W mode
  colorLayers: ColorLayer[] | null; // Color mode
  originalImageUri: string | null;
  previewImageUrl: string | null;
  currentStep: number;
  currentColorLayer: number; // which color layer we're on (color mode)
  createdAt: string;
  updatedAt: string;
}

interface ProjectStore {
  projects: Project[];
  activeProject: Project | null;
  setProjects: (projects: Project[]) => void;
  setActiveProject: (project: Project | null) => void;
  updateActiveProjectStep: (step: number, colorLayer?: number) => void;
}

export const useProjectStore = create<ProjectStore>((set) => ({
  projects: [],
  activeProject: null,
  setProjects: (projects) => set({ projects }),
  setActiveProject: (project) => set({ activeProject: project }),
  updateActiveProjectStep: (step, colorLayer) =>
    set((state) => ({
      activeProject: state.activeProject
        ? {
            ...state.activeProject,
            currentStep: step,
            currentColorLayer: colorLayer ?? state.activeProject.currentColorLayer,
          }
        : null,
    })),
}));
