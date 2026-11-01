export interface TaskSpec {
  id: string;
  prompt: string;
}

export function extraLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function buildTasks(
  auftrag: string,
  extras: string[],
  trainBatch: number,
  selectionRepeats: number,
): { train: TaskSpec[]; selection: TaskSpec[] } {
  const selection = Array.from({ length: selectionRepeats }, (_, index) => ({
    id: `sel-${index + 1}`,
    prompt: auftrag,
  }));
  const pool = extras.length > 0 ? extras : [auftrag];
  const train = Array.from({ length: trainBatch }, (_, index) => ({
    id: `train-${index + 1}`,
    prompt: pool[index % pool.length] ?? auftrag,
  }));
  return { train, selection };
}
