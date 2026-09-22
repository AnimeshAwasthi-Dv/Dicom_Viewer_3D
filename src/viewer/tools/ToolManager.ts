import type { ToolId } from './BaseTool';

export class ToolManager {
  private activeTool: ToolId = 'windowLevel';
  private readonly bindings = new Map<number, ToolId>([
    [0, 'windowLevel'],
    [1, 'pan'],
    [2, 'zoom']
  ]);

  setActiveTool(tool: ToolId): void {
    this.activeTool = tool;
  }

  getActiveTool(): ToolId {
    return this.activeTool;
  }

  toolForButton(button: number): ToolId {
    return this.bindings.get(button) ?? this.activeTool;
  }
}

