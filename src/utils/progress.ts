import * as cliProgress from 'cli-progress';

export class ProgressTracker {
  private multibar: cliProgress.MultiBar;
  private bars: Map<string, cliProgress.SingleBar>;
  private startTimes: Map<string, number>;

  constructor() {
    this.multibar = new cliProgress.MultiBar(
      {
        clearOnComplete: false,
        hideCursor: true,
        format: ' {bar} | {percentage}% | {value}/{total} | {task} | {duration}',
      },
      cliProgress.Presets.shades_classic
    );
    this.bars = new Map();
    this.startTimes = new Map();
  }

  addTask(taskId: string, total: number, taskName: string): void {
    const bar = this.multibar.create(total, 0, { task: taskName, duration: '0s' });
    this.bars.set(taskId, bar);
    this.startTimes.set(taskId, Date.now());
  }

  updateTask(taskId: string, current: number, taskName?: string): void {
    const bar = this.bars.get(taskId);
    const startTime = this.startTimes.get(taskId);

    if (bar && startTime) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const duration = this.formatDuration(elapsed);

      bar.update(current, {
        task: taskName || 'Processing',
        duration,
      });
    }
  }

  completeTask(taskId: string): void {
    const bar = this.bars.get(taskId);
    if (bar) {
      bar.stop();
      this.bars.delete(taskId);
      this.startTimes.delete(taskId);
    }
  }

  stop(): void {
    this.multibar.stop();
  }

  private formatDuration(seconds: number): string {
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }
}

export const createSimpleProgressBar = (total: number, taskName: string): cliProgress.SingleBar => {
  return new cliProgress.SingleBar(
    {
      format: ` ${taskName} | {bar} | {percentage}% | {value}/{total} | {duration}`,
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic
  );
};
