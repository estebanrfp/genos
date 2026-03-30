let getOptionSource = function (command, name) {
  if (typeof command.getOptionValueSource !== "function") {
    return;
  }
  return command.getOptionValueSource(name);
};
export function hasExplicitOptions(command, names) {
  if (typeof command.getOptionValueSource !== "function") {
    return false;
  }
  return names.some((name) => command.getOptionValueSource(name) === "cli");
}
const MAX_INHERIT_DEPTH = 2;
export function inheritOptionFromParent(command, name) {
  if (!command) {
    return;
  }
  const childSource = getOptionSource(command, name);
  if (childSource && childSource !== "default") {
    return;
  }
  let depth = 0;
  let ancestor = command.parent;
  while (ancestor && depth < MAX_INHERIT_DEPTH) {
    const source = getOptionSource(ancestor, name);
    if (source && source !== "default") {
      return ancestor.opts()[name];
    }
    depth += 1;
    ancestor = ancestor.parent;
  }
  return;
}
