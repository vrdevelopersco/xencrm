/** Error de un motor de lenguaje, con código para decidir si es caída del motor o fallo de la petición. */
export class EngineError extends Error {
  constructor(
    public engine: string,
    public code: string,
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}
