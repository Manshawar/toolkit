export class GitSubmitError extends Error {
  constructor(
    message: string,
    readonly code: string = 'GIT_SUBMIT',
  ) {
    super(message)
    this.name = 'GitSubmitError'
  }
}
