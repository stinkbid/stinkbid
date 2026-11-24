import { describe, expect, it } from "vitest";
import { mcp } from "./mcp";

const post = (body: unknown) => mcp.request("/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, {} as Env);

describe("MCP endpoint", () => {
  it("negotiates the protocol and lists tools", async () => {
    const init: any = await (await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } })).json();
    expect(init.result.protocolVersion).toBe("2025-03-26");
    expect(init.result.serverInfo.name).toBe("stinkbid");
    const list: any = await (await post({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(["list_markets", "get_quote", "get_limits", "prepare_stink_bid", "submit_stink_bid", "get_my_bids", "get_book", "prepare_cancel"]);
  });
  it("accepts notifications without a body and rejects unknown methods", async () => {
    expect((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    const bad: any = await (await post({ jsonrpc: "2.0", id: 3, method: "nope" })).json();
    expect(bad.error.code).toBe(-32601);
  });
  it("builds a Permit2 cancel without any chain call", async () => {
    const r: any = await (await post({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "prepare_cancel", arguments: { nonce: "257" } } })).json();
    expect(r.result.structuredContent.tx.to).toBe("0x000000000022D473030F116dDEE9F6B43aC78BA3");
    expect(r.result.structuredContent.tx.data.slice(0, 10)).toBe("0x3ff9dcb1");
  });
  it("answers GET with 405, as the spec asks when there is no stream", async () => {
    expect((await mcp.request("/", {}, {} as Env)).status).toBe(405);
  });
});
