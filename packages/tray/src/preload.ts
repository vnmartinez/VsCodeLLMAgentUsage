import { contextBridge, ipcRenderer } from 'electron';
import type { AgentView } from '@agent-usage/core';

contextBridge.exposeInMainWorld('agentUsage', {
  onModel: (callback: (views: AgentView[]) => void) => {
    ipcRenderer.on('model', (_event, views: AgentView[]) => callback(views));
  },
  getModel: (): Promise<AgentView[]> => ipcRenderer.invoke('get-model'),
});
