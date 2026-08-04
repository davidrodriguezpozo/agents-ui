import type { Workflow, StepExecution } from '~/types'

export function useWorkflowExecution() {
  const steps = ref<StepExecution[]>([])
  const isRunning = ref(false)
  const isPaused = ref(false)
  const currentStepIndex = ref(-1)
  const isComplete = ref(false)
  let abortController: AbortController | null = null
  let _workflow: Workflow | null = null
  let _projectDir: string | undefined
  let _lastOutput = ''

  /**
   * Update a step in place. Indexing cannot prove the step is there, and if it
   * is not there is nothing to update — spreading `undefined` would otherwise
   * invent a half-built step with no id.
   */
  function patchStep(index: number, patch: Partial<StepExecution>) {
    const current = steps.value[index]
    if (!current) return
    steps.value[index] = { ...current, ...patch }
  }

  async function executeStep(stepIndex: number, input: string) {
    if (!_workflow) return
    const step = _workflow.steps[stepIndex]
    if (!step) return

    currentStepIndex.value = stepIndex
    patchStep(stepIndex, { status: 'running', input, startedAt: Date.now() })
    isRunning.value = true
    isPaused.value = false

    abortController = new AbortController()

    try {
      const response = await $fetch<ReadableStream>('/api/chat', {
        method: 'POST',
        body: {
          messages: [{ role: 'user', content: input }],
          agentSlug: step.agentSlug,
          ...(_projectDir ? { projectDir: _projectDir } : {}),
        },
        signal: abortController.signal,
        responseType: 'stream',
      })

      const reader = (response as unknown as ReadableStream).getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let resultText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'text_delta') {
              resultText += data.text
              patchStep(stepIndex, { output: resultText })
            } else if (data.type === 'result') {
              resultText = data.text
              patchStep(stepIndex, { output: resultText })
            } else if (data.type === 'error') {
              throw new Error(data.message)
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue
            throw e
          }
        }
      }

      patchStep(stepIndex, { status: 'completed', output: resultText, completedAt: Date.now() })
      _lastOutput = resultText
      isRunning.value = false

      // Pause for user review (unless this is the last step)
      if (stepIndex < _workflow.steps.length - 1) {
        isPaused.value = true
      } else {
        isPaused.value = false
        isComplete.value = true
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        patchStep(stepIndex, { status: 'failed', error: 'Cancelled', completedAt: Date.now() })
      } else {
        patchStep(stepIndex, { status: 'failed', error: err instanceof Error ? err.message : 'Unknown error', completedAt: Date.now() })
      }
      for (let j = stepIndex + 1; j < _workflow.steps.length; j++) {
        patchStep(j, { status: 'skipped' })
      }
      isRunning.value = false
      isPaused.value = false
    }

    abortController = null
  }

  async function run(workflow: Workflow, initialPrompt: string, projectDir?: string) {
    if (isRunning.value) return
    _workflow = workflow
    const { workingDir } = useWorkingDir()
    _projectDir = projectDir || workingDir.value || undefined
    _lastOutput = ''
    isComplete.value = false

    steps.value = workflow.steps.map(s => ({
      stepId: s.id,
      status: 'pending' as const,
      input: '',
      output: '',
    }))

    await executeStep(0, initialPrompt)
  }

  // Continue to next step with the current output (unmodified)
  async function continueWorkflow() {
    if (!_workflow || !isPaused.value) return
    const nextIndex = currentStepIndex.value + 1
    if (nextIndex >= _workflow.steps.length) return
    await executeStep(nextIndex, _lastOutput)
  }

  // Continue to next step with edited/custom text
  async function continueWith(text: string) {
    if (!_workflow || !isPaused.value) return
    const nextIndex = currentStepIndex.value + 1
    if (nextIndex >= _workflow.steps.length) return
    _lastOutput = text
    await executeStep(nextIndex, text)
  }

  // Re-run the current step with a user reply (for when agent asked questions)
  async function respondToStep(reply: string) {
    if (!_workflow || !isPaused.value) return
    const idx = currentStepIndex.value
    // Combine the agent's output + user reply as the new input for the SAME step
    const combinedInput = `Previous agent output:\n${_lastOutput}\n\nUser response:\n${reply}`
    patchStep(idx, { status: 'pending', output: '', error: undefined, completedAt: undefined })
    await executeStep(idx, combinedInput)
  }

  function stop() {
    abortController?.abort()
    isRunning.value = false
    isPaused.value = false
    if (_workflow) {
      for (let j = currentStepIndex.value + 1; j < _workflow.steps.length; j++) {
        if (steps.value[j]?.status === 'pending') {
          patchStep(j, { status: 'skipped' })
        }
      }
    }
  }

  return {
    steps: readonly(steps),
    isRunning: readonly(isRunning),
    isPaused: readonly(isPaused),
    isComplete: readonly(isComplete),
    currentStepIndex: readonly(currentStepIndex),
    run,
    continueWorkflow,
    continueWith,
    respondToStep,
    stop,
  }
}
