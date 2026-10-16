export interface Stats { lessons: number; answers: number; correct: number }
export type Page = 'learn' | 'generate' | 'settings';
export type Busy = '' | 'settings' | 'assessment' | 'lesson' | 'generation' | 'disconnect' | 'export';
