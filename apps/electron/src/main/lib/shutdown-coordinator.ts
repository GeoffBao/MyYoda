export interface ShutdownCleanupTask {
  name: string
  run: () => void
}

export interface BeforeQuitEvent {
  preventDefault: () => void
}

interface ShutdownCoordinatorOptions {
  syncCleanupTasks: ShutdownCleanupTask[]
  asyncCleanup: () => Promise<void>
  requestQuit: () => void
  timeoutMs: number
  reportError: (name: string, error: unknown) => void
}

export interface ShutdownCoordinator {
  handleBeforeQuit: (event: BeforeQuitEvent) => void
  waitForCompletion: () => Promise<void>
}

export function createShutdownCoordinator(options: ShutdownCoordinatorOptions): ShutdownCoordinator {
  let state: 'idle' | 'cleaning' | 'complete' = 'idle'
  let completion = Promise.resolve()

  const finishAsyncCleanup = async (): Promise<void> => {
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        Promise.resolve().then(options.asyncCleanup),
        new Promise<void>((resolve) => {
          timeout = setTimeout(() => {
            options.reportError('async-timeout', new Error(`异步退出清理超过 ${options.timeoutMs}ms`))
            resolve()
          }, options.timeoutMs)
        }),
      ])
    } catch (error) {
      options.reportError('async-cleanup', error)
    } finally {
      if (timeout) clearTimeout(timeout)
      state = 'complete'
      options.requestQuit()
    }
  }

  return {
    handleBeforeQuit(event): void {
      if (state === 'complete') return
      event.preventDefault()
      if (state === 'cleaning') return
      state = 'cleaning'

      for (const task of options.syncCleanupTasks) {
        try {
          task.run()
        } catch (error) {
          options.reportError(task.name, error)
        }
      }

      completion = finishAsyncCleanup()
    },
    waitForCompletion: () => completion,
  }
}
