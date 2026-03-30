const PROGRAM_CONTEXT_SYMBOL = Symbol.for("genosos.cli.programContext");
export function setProgramContext(program, ctx) {
  program[PROGRAM_CONTEXT_SYMBOL] = ctx;
}
export function getProgramContext(program) {
  return program[PROGRAM_CONTEXT_SYMBOL];
}
