export class BusinessError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'BusinessError';
    this.statusCode = statusCode;
  }
}
