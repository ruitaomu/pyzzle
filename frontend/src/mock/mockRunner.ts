export type RunState = 'idle' | 'running' | 'waiting_input' | 'submitting_input' | 'replacing' | 'finished' | 'failed'

export interface RunnerEventMap {
  run_ack: { runSessionId: string }
  output: { runSessionId: string; stream: 'stdout' | 'stderr'; chunk: string }
  input_request: { runSessionId: string; promptId: string; promptText: string }
  run_done: { runSessionId: string; exitCode: number }
  run_terminated: { runSessionId: string; reason: string }
  run_error: { runSessionId: string; message: string }
}

type EventKey = keyof RunnerEventMap

type EventHandler = (event: EventKey, payload: RunnerEventMap[EventKey]) => void

interface LiveRun {
  runSessionId: string
  timerIds: number[]
  waitingPromptId: string | null
}

export class MockRunner {
  private handler: EventHandler

  private activeRun: LiveRun | null = null

  constructor(handler: EventHandler) {
    this.handler = handler
  }

  start(code: string) {
    if (this.activeRun) {
      this.stop('replaced_by_new_run')
    }

    const runSessionId = createId('run')
    const live: LiveRun = { runSessionId, timerIds: [], waitingPromptId: null }
    this.activeRun = live
    this.handler('run_ack', { runSessionId })

    live.timerIds.push(
      window.setTimeout(() => {
        this.emitOutput(runSessionId, 'stdout', '开始运行...')
      }, 120),
    )

    const hasInput = code.includes('input(')
    if (hasInput) {
      const promptId = createId('prompt')
      live.waitingPromptId = promptId
      live.timerIds.push(
        window.setTimeout(() => {
          this.handler('input_request', {
            runSessionId,
            promptId,
            promptText: '请输入内容：',
          })
        }, 500),
      )
      return
    }

    live.timerIds.push(
      window.setTimeout(() => {
        this.emitOutput(runSessionId, 'stdout', '运行完成。')
        this.handler('run_done', { runSessionId, exitCode: 0 })
        this.disposeRun(runSessionId)
      }, 900),
    )
  }

  submitInput(runSessionId: string, promptId: string, value: string) {
    if (!this.activeRun || this.activeRun.runSessionId !== runSessionId) {
      return
    }
    if (this.activeRun.waitingPromptId !== promptId) {
      return
    }

    this.activeRun.waitingPromptId = null
    this.emitOutput(runSessionId, 'stdout', `收到输入: ${value}`)
    this.activeRun.timerIds.push(
      window.setTimeout(() => {
        this.emitOutput(runSessionId, 'stdout', '继续执行并结束。')
        this.handler('run_done', { runSessionId, exitCode: 0 })
        this.disposeRun(runSessionId)
      }, 500),
    )
  }

  stop(reason: string = 'user_stop') {
    if (!this.activeRun) {
      return
    }
    const runSessionId = this.activeRun.runSessionId
    this.handler('run_terminated', { runSessionId, reason })
    this.disposeRun(runSessionId)
  }

  private emitOutput(runSessionId: string, stream: 'stdout' | 'stderr', chunk: string) {
    if (!this.activeRun || this.activeRun.runSessionId !== runSessionId) {
      return
    }
    this.handler('output', { runSessionId, stream, chunk })
  }

  private disposeRun(runSessionId: string) {
    if (!this.activeRun || this.activeRun.runSessionId !== runSessionId) {
      return
    }
    for (const timerId of this.activeRun.timerIds) {
      window.clearTimeout(timerId)
    }
    this.activeRun = null
  }
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}
