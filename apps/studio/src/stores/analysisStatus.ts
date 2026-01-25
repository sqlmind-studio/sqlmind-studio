interface AnalysisState {
  active: boolean
  message: string
  startedAt: number
  elapsed: string
  analysisFlowActive: boolean
}

const STORAGE_KEY = 'analysisStatusStore.v1'

function formatElapsed(ms: number): string {
  if (ms <= 0) return '00:00'
  const sec = Math.floor(ms / 1000)
  const m = Math.floor(sec / 60).toString().padStart(2, '0')
  const s = (sec % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function loadState(): AnalysisState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return { active: false, message: '', startedAt: 0, elapsed: '00:00', analysisFlowActive: false }
}

function saveState(s: AnalysisState) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch {}
}

const state: AnalysisState = loadState()

const api = {
  get active() { return state.active },
  get message() { return state.message },
  get startedAt() { return state.startedAt },
  get elapsed() { return state.elapsed },
  get analysisFlowActive() { return state.analysisFlowActive },

  start(message: string) {
    state.active = true
    state.message = message
    state.startedAt = Date.now()
    state.elapsed = '00:00'
    saveState(state)
  },
  setMessage(message: string) {
    state.message = message
    saveState(state)
  },
  tick() {
    if (state.active && state.startedAt) {
      state.elapsed = formatElapsed(Date.now() - state.startedAt)
      saveState(state)
    }
  },
  setActive(flag: boolean) {
    state.active = flag
    saveState(state)
  },
  setAnalysisFlowActive(flag: boolean) {
    state.analysisFlowActive = flag
    saveState(state)
  },
  stop() {
    if (!state.active) return
    state.active = false
    state.startedAt = 0
    saveState(state)
  },
  clear() {
    state.active = false
    state.message = ''
    state.startedAt = 0
    state.elapsed = '00:00'
    state.analysisFlowActive = false
    saveState(state)
  }
}

export function useAnalysisStatusStore() {
  return api
}
