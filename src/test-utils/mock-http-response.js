export function createMockServerResponse() {
  const headers = {};
  const res = {
    headersSent: false,
    statusCode: 200,
    setHeader: (key, value) => {
      headers[key.toLowerCase()] = value;
      return res;
    },
    end: (body) => {
      res.headersSent = true;
      res.body = body;
      return res;
    },
  };
  return res;
}
