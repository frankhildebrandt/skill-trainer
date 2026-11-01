/// <reference types="vite/client" />

import type { TrainerApi } from "@shared/types";

declare global {
  interface Window {
    trainer: TrainerApi;
  }
}

export {};
