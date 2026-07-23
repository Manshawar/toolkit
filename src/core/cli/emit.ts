/** 标准化 stdout：envelope / JSON / error */
import type { z } from 'zod'
import {
  AgentEnvelopeSchema,
  CliErrorSchema,
  type AgentEnvelope,
  type AgentEnvelopeInput,
  type CliError,
} from './schema'

export const AGENT_MARKER_BEGIN = '--- tkt-ai-agent-begin ---'
export const AGENT_MARKER_END = '--- tkt-ai-agent-end ---'

export function emitAgentEnvelope(input: AgentEnvelopeInput): AgentEnvelope {
  const envelope = AgentEnvelopeSchema.parse(input)
  console.log(AGENT_MARKER_BEGIN)
  console.log(JSON.stringify(envelope))
  console.log(AGENT_MARKER_END)
  return envelope
}

export function emitJson<T>(schema: z.ZodType<T>, input: unknown): T {
  const data = schema.parse(input)
  console.log(JSON.stringify(data))
  return data
}

export function emitCliError(input: CliError): CliError {
  const err = CliErrorSchema.parse(input)
  console.log(JSON.stringify(err))
  return err
}
