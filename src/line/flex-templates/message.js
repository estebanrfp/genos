export function toFlexMessage(altText, contents) {
  return {
    type: "flex",
    altText,
    contents,
  };
}
