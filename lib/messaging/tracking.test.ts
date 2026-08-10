import { describe, expect, it } from "vitest";
import {
  clickUrl,
  instrumentHtml,
  openPixelUrl,
  signTracking,
  verifyTracking,
} from "./tracking";

describe("signatures", () => {
  it("verifies its own signature", () => {
    const signature = signTracking("msg_1");
    expect(verifyTracking("msg_1", signature)).toBe(true);
  });

  it("rejects a signature issued for a different message", () => {
    const signature = signTracking("msg_1");
    expect(verifyTracking("msg_2", signature)).toBe(false);
  });

  it("binds a click signature to its target url", () => {
    const signature = signTracking("msg_1", "https://example.test/a");

    expect(verifyTracking("msg_1", signature, "https://example.test/a")).toBe(
      true,
    );
    // Otherwise the link could be swapped for anywhere else and still verify.
    expect(verifyTracking("msg_1", signature, "https://evil.test")).toBe(false);
  });
});

describe("instrumentHtml", () => {
  it("rewrites outbound links through the click tracker", () => {
    const html = instrumentHtml(
      '<a href="https://example.test/book">Book now</a>',
      "msg_1",
    );

    expect(html).toContain("/api/t/c/msg_1/");
    expect(html).toContain(encodeURIComponent("https://example.test/book"));
  });

  it("leaves the unsubscribe link untouched", () => {
    // An opt-out must survive tracking being blocked, and clicking it is not
    // engagement.
    const html = instrumentHtml(
      '<a href="https://app.test/u/contact_1/token">Unsubscribe</a>',
      "msg_1",
    );

    expect(html).toContain('href="https://app.test/u/contact_1/token"');
    expect(html).not.toContain("/api/t/c/msg_1/https");
  });

  it("appends a hidden open pixel", () => {
    const html = instrumentHtml("<p>Hi</p>", "msg_1");
    expect(html).toContain(openPixelUrl("msg_1"));
    expect(html).toContain('width="1"');
  });

  it("leaves relative and mailto links alone", () => {
    const html = instrumentHtml(
      '<a href="mailto:a@b.test">mail</a><a href="/local">local</a>',
      "msg_1",
    );
    expect(html).toContain('href="mailto:a@b.test"');
    expect(html).toContain('href="/local"');
  });
});

describe("url shapes", () => {
  it("puts the destination in a query parameter", () => {
    const url = clickUrl("msg_1", "https://example.test/a?b=c");
    expect(url).toContain("?u=");
    expect(decodeURIComponent(url.split("?u=")[1]!)).toBe(
      "https://example.test/a?b=c",
    );
  });
});
