/** 标准化 stdout：JSON / error */
import type { z } from 'zod'
import { CliErrorSchema, type CliError } from './schema'

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
