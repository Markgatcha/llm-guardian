import { describe, it, expect } from "bun:test";
import { gateTools, scoreToolRelevance } from "./tool-gater.ts";
import type { ToolDefinition } from "./types.ts";

function tool(name: string, description: string): ToolDefinition {
  return {
    type: "function",
    function: { name, description, parameters: {} },
  };
}

const CATALOG: ToolDefinition[] = [
  tool("get_weather", "Fetch the current weather for a city by latitude and longitude"),
  tool("send_email", "Send an email message to a recipient with a subject and body"),
  tool("search_flights", "Search for flights between two airports on a given date"),
  tool("create_issue", "Create a GitHub issue in a repository with a title and body"),
  tool("query_database", "Run a read-only SQL query against the analytics database"),
  tool("translate_text", "Translate text from one language to another"),
  tool("summarize_doc", "Summarize a long document into key bullet points"),
  tool("book_hotel", "Book a hotel room for a stay in a city"),
  tool("generate_image", "Generate an image from a text prompt"),
  tool("run_tests", "Run the project test suite and report pass/fail status"),
  tool("deploy_service", "Deploy a service to the staging or production cluster"),
  tool("parse_pdf", "Extract text and tables from a PDF file"),
];

describe("tool-gater", () => {
  it("is a no-op for an empty or missing catalog", () => {
    expect(gateTools(undefined, "anything").removed).toBe(0);
    expect(gateTools([], "anything").removed).toBe(0);
  });

  it("is a no-op when catalog is already within maxTools", () => {
    const small = CATALOG.slice(0, 5);
    const { tools, removed } = gateTools(small, "deploy a service to staging", {
      maxTools: 8,
    });
    expect(removed).toBe(0);
    expect(tools).toHaveLength(5);
  });

  it("keeps tools relevant to the query and drops irrelevant ones", () => {
    const { tools, removed } = gateTools(CATALOG, "deploy the service to staging", {
      maxTools: 8,
    });
    expect(removed).toBeGreaterThan(0);
    const names = tools!.map((t) => t.function.name);
    expect(names).toContain("deploy_service");
    // Irrelevant tools (e.g. weather) should be filtered out.
    expect(names).not.toContain("get_weather");
  });

  it("never exceeds maxTools", () => {
    const { tools } = gateTools(CATALOG, "do many things across the system", {
      maxTools: 3,
    });
    expect(tools!.length).toBeLessThanOrEqual(3);
  });

  it("scores a tool higher when its name matches a query term", () => {
    const weather = tool("get_weather", "current weather by city");
    const score = scoreToolRelevance(weather, new Set(["weather", "city"]));
    expect(score).toBeGreaterThan(0);
    // Name match earns the bonus.
    expect(score).toBeGreaterThanOrEqual(0.15);
  });

  it("returns 0 relevance for an empty query", () => {
    expect(scoreToolRelevance(CATALOG[0], new Set())).toBe(0);
  });
});
