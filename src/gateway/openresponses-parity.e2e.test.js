import { describe, it, expect } from "vitest";
describe("OpenResponses Feature Parity", () => {
  describe("Schema Validation", () => {
    it("should validate input_image with url source", async () => {
      const { InputImageContentPartSchema } = await import("./open-responses.schema.js");
      const validImage = {
        type: "input_image",
        source: {
          type: "url",
          url: "https://example.com/image.png",
        },
      };
      const result = InputImageContentPartSchema.safeParse(validImage);
      expect(result.success).toBe(true);
    });
    it("should validate input_image with base64 source", async () => {
      const { InputImageContentPartSchema } = await import("./open-responses.schema.js");
      const validImage = {
        type: "input_image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        },
      };
      const result = InputImageContentPartSchema.safeParse(validImage);
      expect(result.success).toBe(true);
    });
    it("should reject input_image with invalid mime type", async () => {
      const { InputImageContentPartSchema } = await import("./open-responses.schema.js");
      const invalidImage = {
        type: "input_image",
        source: {
          type: "base64",
          media_type: "application/json",
          data: "SGVsbG8gV29ybGQh",
        },
      };
      const result = InputImageContentPartSchema.safeParse(invalidImage);
      expect(result.success).toBe(false);
    });
    it("should validate input_file with url source", async () => {
      const { InputFileContentPartSchema } = await import("./open-responses.schema.js");
      const validFile = {
        type: "input_file",
        source: {
          type: "url",
          url: "https://example.com/document.txt",
        },
      };
      const result = InputFileContentPartSchema.safeParse(validFile);
      expect(result.success).toBe(true);
    });
    it("should validate input_file with base64 source", async () => {
      const { InputFileContentPartSchema } = await import("./open-responses.schema.js");
      const validFile = {
        type: "input_file",
        source: {
          type: "base64",
          media_type: "text/plain",
          data: "SGVsbG8gV29ybGQh",
          filename: "hello.txt",
        },
      };
      const result = InputFileContentPartSchema.safeParse(validFile);
      expect(result.success).toBe(true);
    });
    it("should validate tool definition", async () => {
      const { ToolDefinitionSchema } = await import("./open-responses.schema.js");
      const validTool = {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get the current weather",
          parameters: {
            type: "object",
            properties: {
              location: { type: "string" },
            },
            required: ["location"],
          },
        },
      };
      const result = ToolDefinitionSchema.safeParse(validTool);
      expect(result.success).toBe(true);
    });
    it("should reject tool definition without name", async () => {
      const { ToolDefinitionSchema } = await import("./open-responses.schema.js");
      const invalidTool = {
        type: "function",
        function: {
          name: "",
          description: "Get the current weather",
        },
      };
      const result = ToolDefinitionSchema.safeParse(invalidTool);
      expect(result.success).toBe(false);
    });
  });
  describe("CreateResponseBody Schema", () => {
    it("should validate request with input_image", async () => {
      const { CreateResponseBodySchema } = await import("./open-responses.schema.js");
      const validRequest = {
        model: "claude-sonnet-4-20250514",
        input: [
          {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_image",
                source: {
                  type: "url",
                  url: "https://example.com/photo.jpg",
                },
              },
              {
                type: "input_text",
                text: "What's in this image?",
              },
            ],
          },
        ],
      };
      const result = CreateResponseBodySchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });
    it("should validate request with client tools", async () => {
      const { CreateResponseBodySchema } = await import("./open-responses.schema.js");
      const validRequest = {
        model: "claude-sonnet-4-20250514",
        input: [
          {
            type: "message",
            role: "user",
            content: "What's the weather?",
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "Get weather for a location",
              parameters: {
                type: "object",
                properties: {
                  location: { type: "string" },
                },
                required: ["location"],
              },
            },
          },
        ],
      };
      const result = CreateResponseBodySchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });
    it("should validate request with function_call_output for turn-based tools", async () => {
      const { CreateResponseBodySchema } = await import("./open-responses.schema.js");
      const validRequest = {
        model: "claude-sonnet-4-20250514",
        input: [
          {
            type: "function_call_output",
            call_id: "call_123",
            output: '{"temperature": "72\xB0F", "condition": "sunny"}',
          },
        ],
      };
      const result = CreateResponseBodySchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });
    it("should validate complete turn-based tool flow", async () => {
      const { CreateResponseBodySchema } = await import("./open-responses.schema.js");
      const turn1Request = {
        model: "claude-sonnet-4-20250514",
        input: [
          {
            type: "message",
            role: "user",
            content: "What's the weather in San Francisco?",
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "Get weather for a location",
            },
          },
        ],
      };
      const turn1Result = CreateResponseBodySchema.safeParse(turn1Request);
      expect(turn1Result.success).toBe(true);
      const turn2Request = {
        model: "claude-sonnet-4-20250514",
        input: [
          {
            type: "function_call_output",
            call_id: "call_123",
            output: '{"temperature": "72\xB0F", "condition": "sunny"}',
          },
        ],
      };
      const turn2Result = CreateResponseBodySchema.safeParse(turn2Request);
      expect(turn2Result.success).toBe(true);
    });
  });
  describe("Response Resource Schema", () => {
    it("should validate response with function_call output", async () => {
      const { OutputItemSchema } = await import("./open-responses.schema.js");
      const functionCallOutput = {
        type: "function_call",
        id: "msg_123",
        call_id: "call_456",
        name: "get_weather",
        arguments: '{"location": "San Francisco"}',
      };
      const result = OutputItemSchema.safeParse(functionCallOutput);
      expect(result.success).toBe(true);
    });
  });
  describe("buildAgentPrompt", () => {
    it("should convert function_call_output to tool entry", async () => {
      const { buildAgentPrompt } = await import("./openresponses-http.js");
      const result = buildAgentPrompt([
        {
          type: "function_call_output",
          call_id: "call_123",
          output: '{"temperature": "72\xB0F"}',
        },
      ]);
      expect(result.message).toBe('{"temperature": "72\xB0F"}');
    });
    it("should handle mixed message and function_call_output items", async () => {
      const { buildAgentPrompt } = await import("./openresponses-http.js");
      const result = buildAgentPrompt([
        {
          type: "message",
          role: "user",
          content: "What's the weather?",
        },
        {
          type: "function_call_output",
          call_id: "call_123",
          output: '{"temperature": "72\xB0F"}',
        },
        {
          type: "message",
          role: "user",
          content: "Thanks!",
        },
      ]);
      expect(result.message).toContain("weather");
      expect(result.message).toContain("72\xB0F");
      expect(result.message).toContain("Thanks");
    });
  });
});
