import { create } from 'zustand'

interface UpdateLog {
  id: number
  text: string
  time: string
}

interface UpdateStatusState {
  isUpdating: boolean // 是否正在更新（数据库或前端）
  logs: UpdateLog[]
  setIsUpdating: (updating: boolean) => void
  addLog: (text: string) => void
}

export const useUpdateStatusStore = create<UpdateStatusState>((set) => ({
  isUpdating: false,
  logs: [],
  setIsUpdating: (updating) => set({ isUpdating: updating }),
  addLog: (text) => set((state) => ({
    logs: [{
      id: Date.now(),
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    }, ...state.logs].slice(0, 3)
  }))
}))
