let buildTextContent = function (body) {
    return {
      "m.text": body,
      "org.matrix.msc1767.text": body,
    };
  },
  buildPollFallbackText = function (question, answers) {
    if (answers.length === 0) {
      return question;
    }
    return `${question}\n${answers.map((answer, idx) => `${idx + 1}. ${answer}`).join("\n")}`;
  };
export const M_POLL_START = "m.poll.start";
export const M_POLL_RESPONSE = "m.poll.response";
export const M_POLL_END = "m.poll.end";
export const ORG_POLL_START = "org.matrix.msc3381.poll.start";
export const ORG_POLL_RESPONSE = "org.matrix.msc3381.poll.response";
export const ORG_POLL_END = "org.matrix.msc3381.poll.end";
export const POLL_EVENT_TYPES = [
  M_POLL_START,
  M_POLL_RESPONSE,
  M_POLL_END,
  ORG_POLL_START,
  ORG_POLL_RESPONSE,
  ORG_POLL_END,
];
export const POLL_START_TYPES = [M_POLL_START, ORG_POLL_START];
export const POLL_RESPONSE_TYPES = [M_POLL_RESPONSE, ORG_POLL_RESPONSE];
export const POLL_END_TYPES = [M_POLL_END, ORG_POLL_END];
export function isPollStartType(eventType) {
  return POLL_START_TYPES.includes(eventType);
}
export function getTextContent(text) {
  if (!text) {
    return "";
  }
  return text["m.text"] ?? text["org.matrix.msc1767.text"] ?? text.body ?? "";
}
export function parsePollStartContent(content) {
  const poll = content[M_POLL_START] ?? content[ORG_POLL_START] ?? content["m.poll"];
  if (!poll) {
    return null;
  }
  const question = getTextContent(poll.question);
  if (!question) {
    return null;
  }
  const answers = poll.answers
    .map((answer) => getTextContent(answer))
    .filter((a) => a.trim().length > 0);
  return {
    eventId: "",
    roomId: "",
    sender: "",
    senderName: "",
    question,
    answers,
    kind: poll.kind ?? "m.poll.disclosed",
    maxSelections: poll.max_selections ?? 1,
  };
}
export function formatPollAsText(summary) {
  const lines = [
    "[Poll]",
    summary.question,
    "",
    ...summary.answers.map((answer, idx) => `${idx + 1}. ${answer}`),
  ];
  return lines.join("\n");
}
export function buildPollStartContent(poll) {
  const question = poll.question.trim();
  const answers = poll.options
    .map((option) => option.trim())
    .filter((option) => option.length > 0)
    .map((option, idx) => ({
      id: `answer${idx + 1}`,
      ...buildTextContent(option),
    }));
  const isMultiple = (poll.maxSelections ?? 1) > 1;
  const maxSelections = isMultiple ? Math.max(1, answers.length) : 1;
  const fallbackText = buildPollFallbackText(
    question,
    answers.map((answer) => getTextContent(answer)),
  );
  return {
    [M_POLL_START]: {
      question: buildTextContent(question),
      kind: isMultiple ? "m.poll.undisclosed" : "m.poll.disclosed",
      max_selections: maxSelections,
      answers,
    },
    "m.text": fallbackText,
    "org.matrix.msc1767.text": fallbackText,
  };
}
