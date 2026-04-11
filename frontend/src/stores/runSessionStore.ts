import { defineStore } from 'pinia'
import { io, type Socket } from 'socket.io-client'
import { ensureUserId } from '../utils/userIdentity'

export type ExecutionState = 'idle' | 'running' | 'waiting_input' | 'submitting_input' | 'finished' | 'failed' | 'interrupted'
export type ConnectionState = 'connected' | 'reconnecting' | 'terminated' | 'blocked'

interface StatusSnapshot {
  userId: string
  connectionState: ConnectionState
  executionState: Exclude<ExecutionState, 'submitting_input'>
  runSessionId: string | null
  pendingPromptId: string | null
  pendingPromptText: string | null
}

export interface ConsoleLine {
  id: string
  stream: 'stdout' | 'stderr' | 'system'
  text: string
  ts: number
}

interface InputPrompt {
  runSessionId: string
  promptId: string
  promptText: string
}

interface RunSessionState {
  runState: ExecutionState
  connectionState: ConnectionState
  runSessionId: string | null
  lastRunSessionId: string | null
  userId: string | null
  lines: ConsoleLine[]
  pendingPrompt: InputPrompt | null
  initialized: boolean
}

const createLine = (stream: ConsoleLine['stream'], text: string): ConsoleLine => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  stream,
  text,
  ts: Date.now(),
})

const logPrefix = '[run-session]'

function logEvent(event: string, payload?: unknown): void {
  if (payload === undefined) {
    console.log(`${logPrefix} ${event}`)
    return
  }
  console.log(`${logPrefix} ${event}`, payload)
}

function previewCode(code: string): string {
  const maxLen = 3000
  if (code.length <= maxLen) {
    return code
  }
  return `${code.slice(0, maxLen)}\n... [truncated ${code.length - maxLen} chars]`
}

export const useRunSessionStore = defineStore('runSession', {
  state: (): RunSessionState => ({
    runState: 'idle',
    connectionState: 'reconnecting',
    runSessionId: null,
    lastRunSessionId: null,
    userId: null,
    lines: [],
    pendingPrompt: null,
    initialized: false,
  }),
  getters: {
    isRunInProgress(state): boolean {
      return state.runState === 'running' || state.runState === 'waiting_input'
    },
    canRun(state): boolean {
      if (state.connectionState !== 'connected') {
        return false
      }
      return state.runState === 'idle' || state.runState === 'finished' || state.runState === 'failed' || state.runState === 'interrupted'
    },
    canSubmit(state): boolean {
      return state.connectionState === 'connected' || state.connectionState === 'blocked'
    },
    connectionDisplay(state): string {
      if (state.connectionState === 'reconnecting') {
        return '正在重连后端'
      }
      if (state.connectionState === 'connected') {
        return '已连接后端'
      }
      if (state.connectionState === 'blocked') {
        return '已被教师屏蔽'
      }
      return '连接已终止'
    },
  },
  actions: {
    async initSession() {
      if (this.initialized) {
        return
      }

      this.userId = ensureUserId()
      logEvent('initSession user', this.userId)
      await this.refreshStatus()
      this.connectSocket()
      this.startHeartbeat()
      this.initialized = true
    },
    async refreshStatus() {
      if (!this.userId) {
        return
      }
      const result = await fetchJson<StatusSnapshot>(`/api/session/status?user_id=${encodeURIComponent(this.userId)}`)
      if (!result) {
        this.connectionState = 'reconnecting'
        this.lines.push(createLine('system', '状态恢复失败，正在尝试重连后端...'))
        logEvent('refreshStatus failed -> reconnecting')
        return
      }
      logEvent('refreshStatus snapshot', result)
      this.applySnapshot(result)
    },
    connectSocket() {
      if (!this.userId) {
        return
      }

      if (socketSingleton) {
        return
      }

      const backendUrl = getBackendBaseUrl()
      const socketUrl = `${backendUrl.replace(/\/$/, '')}/ws`
      this.lines.push(createLine('system', `连接后端: ${socketUrl}`))
      logEvent('socket connect attempt', { backendUrl, socketUrl, userId: this.userId })
      socketSingleton = io(socketUrl, {
        autoConnect: true,
        reconnection: false,
        timeout: 5000,
        transports: ['websocket', 'polling'],
        auth: { userId: this.userId },
        path: '/socket.io',
      })

      socketSingleton.on('connect', () => {
        this.connectionState = 'connected'
        this.lines.push(createLine('system', '已连接到后端。'))
        logEvent('socket connected', { socketId: socketSingleton?.id, userId: this.userId })
        this.stopReconnectPolling()
      })

      socketSingleton.on('disconnect', () => {
        if (this.connectionState === 'blocked' || this.connectionState === 'terminated') {
          return
        }
        this.connectionState = 'reconnecting'
        this.lines.push(createLine('system', '连接断开，正在重连...'))
        logEvent('socket disconnected', { socketId: socketSingleton?.id, userId: this.userId })
        this.startReconnectPolling()
      })

      socketSingleton.on('connect_error', (error) => {
        if (this.connectionState === 'blocked' || this.connectionState === 'terminated') {
          return
        }
        this.connectionState = 'reconnecting'
        logEvent('socket connect_error', { message: error.message, name: error.name })
        this.startReconnectPolling()
      })

      socketSingleton.on('connect_ack', () => {
        this.connectionState = 'connected'
        logEvent('socket connect_ack', { userId: this.userId })
      })

      socketSingleton.on('status_snapshot', (snapshot: StatusSnapshot) => {
        logEvent('socket status_snapshot', snapshot)
        this.applySnapshot(snapshot)
      })

      socketSingleton.on('heartbeat_ack', (payload: { userId: string; serverTime: string; connectionState: ConnectionState; executionState: ExecutionState }) => {
        logEvent('socket heartbeat_ack', payload)
      })

      socketSingleton.on('run_ack', (payload: { runSessionId: string }) => {
        this.runSessionId = payload.runSessionId
        this.lastRunSessionId = payload.runSessionId
        this.runState = 'running'
        this.lines.push(createLine('system', `会话已启动: ${payload.runSessionId}`))
        logEvent('socket run_ack', payload)
      })

      socketSingleton.on('code_submit_ack', (payload: { submissionId: string }) => {
        this.lines.push(createLine('system', `代码已提交: ${payload.submissionId}`))
        logEvent('socket code_submit_ack', payload)
      })

      socketSingleton.on('output', (payload: { runSessionId: string; stream: 'stdout' | 'stderr'; chunk: string }) => {
        const isCurrentRun = payload.runSessionId === this.runSessionId
        const isRecentRun = payload.runSessionId === this.lastRunSessionId
        if (!isCurrentRun && !isRecentRun) {
          return
        }
        this.lines.push(createLine(payload.stream, payload.chunk))
        logEvent('socket output', payload)
      })

      socketSingleton.on('input_request', (payload: { runSessionId: string; promptId: string; promptText: string }) => {
        const isCurrentRun = payload.runSessionId === this.runSessionId
        const isRecentRun = payload.runSessionId === this.lastRunSessionId
        const mayArriveBeforeRunAck = !this.runSessionId && this.runState === 'running'
        if (!isCurrentRun && !isRecentRun && !mayArriveBeforeRunAck) {
          return
        }
        if (!this.runSessionId) {
          this.runSessionId = payload.runSessionId
          this.lastRunSessionId = payload.runSessionId
        }
        this.runState = 'waiting_input'
        this.pendingPrompt = {
          runSessionId: payload.runSessionId,
          promptId: payload.promptId,
          promptText: payload.promptText,
        }
        this.lines.push(createLine('system', '程序正在等待输入...'))
        logEvent('socket input_request', payload)
      })

      socketSingleton.on('run_done', (payload: { runSessionId: string; exitCode: number }) => {
        const isCurrentRun = payload.runSessionId === this.runSessionId
        const isRecentRun = payload.runSessionId === this.lastRunSessionId
        if (!isCurrentRun && !isRecentRun) {
          return
        }
        this.lastRunSessionId = payload.runSessionId
        this.runState = 'finished'
        this.pendingPrompt = null
        this.lines.push(createLine('system', `运行结束，exit_code=${payload.exitCode}`))
        logEvent('socket run_done', payload)
      })

      socketSingleton.on('run_failed', (payload: { runSessionId: string | null; message: string }) => {
        if (payload.runSessionId) {
          const isCurrentRun = payload.runSessionId === this.runSessionId
          const isRecentRun = payload.runSessionId === this.lastRunSessionId
          if (!isCurrentRun && !isRecentRun) {
            return
          }
          this.lastRunSessionId = payload.runSessionId
        }
        if (!payload.runSessionId && !this.runSessionId && !this.lastRunSessionId) {
          return
        }
        this.runState = 'failed'
        this.pendingPrompt = null
        this.lines.push(createLine('stderr', payload.message))
        logEvent('socket run_failed', payload)
      })

      socketSingleton.on('run_interrupted', (payload: { runSessionId: string; reason: string }) => {
        const isCurrentRun = payload.runSessionId === this.runSessionId
        const isRecentRun = payload.runSessionId === this.lastRunSessionId
        if (!isCurrentRun && !isRecentRun) {
          return
        }
        this.lastRunSessionId = payload.runSessionId
        this.runState = 'interrupted'
        this.pendingPrompt = null
        this.lines.push(createLine('system', `运行中断: ${payload.reason}`))
        logEvent('socket run_interrupted', payload)
      })

      socketSingleton.on('connection_blocked', () => {
        this.connectionState = 'blocked'
        this.pendingPrompt = null
        this.lines.push(createLine('system', '你已被教师暂时屏蔽，无法连接后端。'))
        logEvent('socket connection_blocked')
        this.startReconnectPolling()
      })

      socketSingleton.on('connection_terminated', () => {
        this.connectionState = 'terminated'
        if (this.runState === 'running' || this.runState === 'waiting_input') {
          this.runState = 'interrupted'
        }
        this.pendingPrompt = null
        this.lines.push(createLine('system', '连接已被后端终止（超时或管理员操作）。'))
        logEvent('socket connection_terminated')
      })
    },
    startHeartbeat() {
      this.stopHeartbeat()
      heartbeatTimer = window.setInterval(async () => {
        if (!this.userId) {
          return
        }
        if (this.connectionState !== 'connected') {
          return
        }
        logEvent('heartbeat tick', { userId: this.userId, socketConnected: Boolean(socketSingleton?.connected) })
        socketSingleton?.emit('heartbeat', { userId: this.userId })
        const snapshot = await fetchJson<StatusSnapshot>('/api/session/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: this.userId }),
        })
        if (snapshot) {
          logEvent('heartbeat http snapshot', snapshot)
          this.applySnapshot(snapshot)
          return
        }
        if (socketSingleton?.connected) {
          this.lines.push(createLine('system', 'HTTP心跳未收到响应，但WebSocket仍在线，继续保持连接。'))
          logEvent('heartbeat http failed, socket still connected')
          return
        }
        this.connectionState = 'reconnecting'
        logEvent('heartbeat failed -> reconnecting')
        this.startReconnectPolling()
      }, 60_000)
    },
    stopHeartbeat() {
      if (heartbeatTimer === null) {
        return
      }
      window.clearInterval(heartbeatTimer)
      heartbeatTimer = null
    },
    startReconnectPolling() {
      if (reconnectTimer !== null) {
        return
      }
      reconnectTimer = window.setInterval(async () => {
        if (!this.userId) {
          return
        }
        const snapshot = await fetchJson<StatusSnapshot>('/api/session/reconnect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: this.userId }),
        })
        if (snapshot) {
          this.applySnapshot(snapshot)
          if (snapshot.connectionState === 'connected' && socketSingleton?.connected) {
            this.stopReconnectPolling()
            return
          }
        }

        if (
          socketSingleton &&
          !socketSingleton.connected &&
          this.connectionState !== 'blocked' &&
          this.connectionState !== 'terminated'
        ) {
          socketSingleton.connect()
        }
      }, 2000)
    },
    stopReconnectPolling() {
      if (reconnectTimer === null) {
        return
      }
      window.clearInterval(reconnectTimer)
      reconnectTimer = null
    },
    applySnapshot(snapshot: StatusSnapshot) {
      logEvent('applySnapshot', snapshot)
      this.connectionState = snapshot.connectionState
      this.runState = snapshot.executionState
      this.runSessionId = snapshot.runSessionId
      if (snapshot.runSessionId) {
        this.lastRunSessionId = snapshot.runSessionId
      }
      if (snapshot.pendingPromptId && snapshot.runSessionId && snapshot.pendingPromptText !== null) {
        this.pendingPrompt = {
          runSessionId: snapshot.runSessionId,
          promptId: snapshot.pendingPromptId,
          promptText: snapshot.pendingPromptText,
        }
      } else {
        this.pendingPrompt = null
      }
    },

    startRun(code: string, username = '') {
      if (!this.userId) {
        this.lines.push(createLine('system', '尚未初始化用户标识，无法运行。'))
        return
      }

      if (this.runState === 'running' || this.runState === 'waiting_input') {
        this.stopRun()
        return
      }

      if (!this.canRun) {
        this.lines.push(createLine('system', '当前状态不可运行，请等待连接恢复或本次会话结束。'))
        logEvent('startRun rejected by state', {
          userId: this.userId,
          connectionState: this.connectionState,
          runState: this.runState,
        })
        return
      }

      if (!socketSingleton || !socketSingleton.connected) {
        this.connectionState = 'reconnecting'
        this.startReconnectPolling()
        this.lines.push(createLine('system', '后端未连接，正在重连。'))
        logEvent('startRun rejected: socket not connected')
        return
      }

      this.pendingPrompt = null
      logEvent('emit run_start', {
        userId: this.userId,
        username,
        codeLen: code.length,
        code: previewCode(code),
      })
      socketSingleton.emit('run_start', { userId: this.userId, username, code })
    },
    submitCode(code: string, username = '') {
      if (!this.userId) {
        this.lines.push(createLine('system', '尚未初始化用户标识，无法提交。'))
        return
      }

      if (!this.canSubmit) {
        this.lines.push(createLine('system', '当前连接不可提交，请等待连接恢复。'))
        return
      }

      if (!socketSingleton || !socketSingleton.connected) {
        this.connectionState = 'reconnecting'
        this.startReconnectPolling()
        this.lines.push(createLine('system', '后端未连接，正在重连。'))
        logEvent('submitCode rejected: socket not connected')
        return
      }

      logEvent('emit code_submit', {
        userId: this.userId,
        username,
        codeLen: code.length,
        code: previewCode(code),
      })
      socketSingleton.emit('code_submit', { userId: this.userId, username, code })
    },
    stopRun() {
      if (!this.userId || !socketSingleton || !socketSingleton.connected) {
        this.connectionState = 'reconnecting'
        this.startReconnectPolling()
        return
      }

      logEvent('emit run_stop', { userId: this.userId })
      socketSingleton.emit('run_stop', { userId: this.userId })
      this.lines.push(createLine('system', '已请求停止当前运行。'))
    },
    submitInput(value: string) {
      if (!socketSingleton || !socketSingleton.connected || !this.pendingPrompt || !this.userId) {
        return
      }

      this.runState = 'submitting_input'
      const prompt = this.pendingPrompt
      this.pendingPrompt = null
      this.lines.push(createLine('system', `输入已提交: ${value}`))
      logEvent('emit input_submit', {
        userId: this.userId,
        promptId: prompt.promptId,
        valueLen: value.length,
        value,
      })
      socketSingleton.emit('input_submit', {
        userId: this.userId,
        runSessionId: prompt.runSessionId,
        promptId: prompt.promptId,
        value,
      })
      this.runState = 'running'
    },
    shutdownSession() {
      this.stopHeartbeat()
      this.stopReconnectPolling()
      if (socketSingleton) {
        logEvent('shutdown socket disconnect', { userId: this.userId })
        socketSingleton.disconnect()
        socketSingleton = null
      }
    },
    clearConsole() {
      this.lines = []
    },
  },
})

let socketSingleton: Socket | null = null
let heartbeatTimer: number | null = null
let reconnectTimer: number | null = null

function getBackendBaseUrl(): string {
  const raw = import.meta.env.VITE_BACKEND_URL
  if (raw && typeof raw === 'string' && raw.trim()) {
    return raw.trim()
  }
  return 'http://127.0.0.1:5000'
}

async function fetchJson<T>(urlPath: string, init?: RequestInit): Promise<T | null> {
  const backendUrl = getBackendBaseUrl()
  const url = `${backendUrl}${urlPath}`
  const response = await fetch(url, init).catch((error: unknown) => {
    logEvent('fetch failed', { url, error })
    return null
  })
  if (!response || !response.ok) {
    logEvent('fetch non-ok', { url, status: response?.status, statusText: response?.statusText })
    return null
  }
  const data = (await response.json()) as T
  logEvent('fetch ok', { url, data })
  return data
}
