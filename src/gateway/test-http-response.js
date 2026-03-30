import { vi } from "vitest";
export function makeMockHttpResponse() {
  const setHeader = vi.fn();
  const end = vi.fn();
  const res = {
    headersSent: false,
    statusCode: 200,
    setHeader,
    end,
  };
  return { res, setHeader, end };
}
