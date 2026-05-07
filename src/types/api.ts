export type ApiValidationError = {
  loc?: Array<string | number>
  msg?: string
  type?: string
}

export type ApiErrorResponse = {
  detail: string | ApiValidationError[]
}

export type SessionId = string
