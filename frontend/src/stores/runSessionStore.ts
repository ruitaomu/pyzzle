import { defineStore } from 'pinia'
import { MockRunner, type RunState } from '../mock/mockRunner'

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
  runState: RunState
  runSessionId: string | null
  lines: ConsoleLine[]
  pendingPrompt: InputPrompt | null
}

const createLine = (stream: ConsoleLine['stream'], text: string): ConsoleLine => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  stream,
  text,
  ts: Date.now(),
})

export const useRunSessionStore = defineStore('runSession', {
  state: (): RunSessionState => ({
    runState: 'idle',
    runSessionId: null,
    lines: [],
    pendingPrompt: null,
  }),
  actions: {
    attachRunner() {
      if (runnerSingleton) {
        return
      }

      runnerSingleton = new MockRunner((event, payload) => {
        if (event === 'run_ack') {
          const data = payload as { runSessionId: string }
          this.runSessionId = data.runSessionId
          this.runState = 'running'
          this.lines.push(createLine('system', `会话已启动: ${data.runSessionId}`))
          return
        }

        if (event === 'output') {
          const data = payload as { runSessionId: string; stream: 'stdout' | 'stderr'; chunk: string }
          if (data.runSessionId !== this.runSessionId) {
            return
          }
          this.lines.push(createLine(data.stream, data.chunk))
          return
        }

        if (event === 'input_request') {
          const data = payload as { runSessionId: string; promptId: string; promptText: string }
          if (data.runSessionId !== this.runSessionId) {
            return
          }
          this.runState = 'waiting_input'
          this.pendingPrompt = {
            runSessionId: data.runSessionId,
            promptId: data.promptId,
            promptText: data.promptText,
          }
          this.lines.push(createLine('system', '程序正在等待输入...'))
          return
        }

        if (event === 'run_done') {
          const data = payload as { runSessionId: string; exitCode: number }
          if (data.runSessionId !== this.runSessionId) {
            return
          }
          this.lines.push(createLine('system', `运行结束，exit_code=${data.exitCode}`))
          this.runState = 'finished'
          this.pendingPrompt = null
          return
        }

        if (event === 'run_terminated') {
          const data = payload as { runSessionId: string; reason: string }
          if (data.runSessionId !== this.runSessionId) {
            return
          }
          this.lines.push(createLine('system', `运行终止: ${data.reason}`))
          this.runState = 'finished'
          this.pendingPrompt = null
          return
        }

        if (event === 'run_error') {
          const data = payload as { runSessionId: string; message: string }
          if (data.runSessionId !== this.runSessionId) {
            return
          }
          this.lines.push(createLine('stderr', data.message))
          this.runState = 'failed'
          this.pendingPrompt = null
        }
      })
    },
    startRun(code: string) {
      this.attachRunner()
      if (!runnerSingleton) {
        return
      }

      if (this.runState === 'running' || this.runState === 'waiting_input' || this.runState === 'submitting_input') {
        this.runState = 'replacing'
      }

      runnerSingleton.start(code)
    },
    stopRun() {
      if (!runnerSingleton) {
        return
      }
      runnerSingleton.stop('user_stop')
    },
    submitInput(value: string) {
      if (!runnerSingleton || !this.pendingPrompt) {
        return
      }

      this.runState = 'submitting_input'
      const prompt = this.pendingPrompt
      this.pendingPrompt = null
      this.lines.push(createLine('system', `输入已提交: ${value}`))
      runnerSingleton.submitInput(prompt.runSessionId, prompt.promptId, value)
      this.runState = 'running'
    },
    resetRunStateOnRefresh() {
      if (runnerSingleton) {
        runnerSingleton.stop('page_refresh')
      }
      this.runState = 'idle'
      this.runSessionId = null
      this.pendingPrompt = null
    },
    clearConsole() {
      this.lines = []
    },
  },
})

let runnerSingleton: MockRunner | null = null
