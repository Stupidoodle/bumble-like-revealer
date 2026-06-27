// Debug logging, compiled out entirely when __DEBUG__ is false (Bun `define`
// folds the constant, so the dead branch is dropped from the production bundle).

export function makeLog(tag: string) {
  return (...args: unknown[]): void => {
    if (__DEBUG__) console.log(tag, ...args);
  };
}

export function makeErr(tag: string) {
  return (...args: unknown[]): void => {
    if (__DEBUG__) console.error(tag, ...args);
  };
}
