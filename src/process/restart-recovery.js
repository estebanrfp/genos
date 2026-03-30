export function createRestartIterationHook(onRestart) {
  let isFirstIteration = true;
  return () => {
    if (isFirstIteration) {
      isFirstIteration = false;
      return false;
    }
    onRestart();
    return true;
  };
}
