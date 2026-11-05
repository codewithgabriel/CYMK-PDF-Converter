export interface Picture {
  id: string; label: string; part: string; alt: string; context: string;
  dataUrl: string; width: number; height: number; supported: boolean; reason: string | null;
}
export interface OpenedDocument {
  sessionId: string; name: string; path: string; bytes: number; previewBase64: string;
  images: Picture[]; warnings: string[];
}
export interface GeneratedImage {
  id: string; imageId: string; dataUrl: string; width: number; height: number; model: string;
}
export interface StudioStatus { configured: boolean; model: string; largeOutput: boolean }
export interface ImageWork {
  prompt: string; style: string; useContext: boolean; quality: string; resolution: string;
  drafts: GeneratedImage[]; currentDraft: string | null; accepted: string | null;
}
