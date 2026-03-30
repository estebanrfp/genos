export function messageAction(label, text) {
  return {
    type: "message",
    label: label.slice(0, 20),
    text: text ?? label,
  };
}
export function uriAction(label, uri) {
  return {
    type: "uri",
    label: label.slice(0, 20),
    uri,
  };
}
export function postbackAction(label, data, displayText) {
  return {
    type: "postback",
    label: label.slice(0, 20),
    data: data.slice(0, 300),
    displayText: displayText?.slice(0, 300),
  };
}
export function datetimePickerAction(label, data, mode, options) {
  return {
    type: "datetimepicker",
    label: label.slice(0, 20),
    data: data.slice(0, 300),
    mode,
    initial: options?.initial,
    max: options?.max,
    min: options?.min,
  };
}
