export interface MemoryStatus {
  buffer_tokens: number;
  buffer_turns: number;
  threshold_tokens: number;
  threshold_turns: number;
  flushed: boolean;
  flush_details?: {
    tokens_flushed: number;
    turns_flushed: number;
    datasets_affected: string[];
  } | null;
}

export interface PersonInFrame {
  face_registered_id: number | null;
  name: string;
  mouth: string;
  identity: string;
  dataset_ids?: string[];
  avatar?: string | null;
}

export interface NewFaceLink {
  face_registered_id: number;
  dataset_id: string;
  display_name: string;
}

export interface CorefResolution {
  original: string;
  resolved: string;
}

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  speakerName?: string;
  timestamp?: number;
  corefResolutions?: CorefResolution[];
}
