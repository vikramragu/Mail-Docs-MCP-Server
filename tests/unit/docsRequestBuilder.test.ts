import { describe, it, expect } from "vitest";
import { buildAppendRequests } from "../../src/utils/docsRequestBuilder.js";
import { utf16Length } from "../../src/utils/docsIndex.js";

describe("utf16Length", () => {
  it("counts a surrogate-pair emoji as 2 code units", () => {
    expect(utf16Length("😀")).toBe(2);
  });

  it("matches plain ASCII length", () => {
    expect(utf16Length("hello")).toBe(5);
  });
});

describe("buildAppendRequests", () => {
  it("inserts a leading blank-line separator when addSeparator is true", () => {
    const { requests } = buildAppendRequests({
      blocks: [{ type: "paragraph", text: "Hello" }],
      anchorIndex: 10,
      addSeparator: true,
    });
    const insert = requests[0];
    expect(insert.insertText?.text).toBe("\nHello\n");
    expect(insert.insertText?.location?.index).toBe(10);
  });

  it("omits the separator when addSeparator is false", () => {
    const { requests } = buildAppendRequests({
      blocks: [{ type: "paragraph", text: "Hello" }],
      anchorIndex: 10,
      addSeparator: false,
    });
    expect(requests[0].insertText?.text).toBe("Hello\n");
  });

  it("applies heading named styles with ranges covering text + trailing newline", () => {
    const { requests } = buildAppendRequests({
      blocks: [{ type: "heading2", text: "Title" }],
      anchorIndex: 0,
      addSeparator: false,
    });
    const styleReq = requests.find((r) => r.updateParagraphStyle);
    expect(styleReq?.updateParagraphStyle?.paragraphStyle?.namedStyleType).toBe("HEADING_2");
    expect(styleReq?.updateParagraphStyle?.range).toEqual({ startIndex: 0, endIndex: 6 });
  });

  it("creates bullet requests for bullet blocks and numbered for numbered blocks", () => {
    const { requests } = buildAppendRequests({
      blocks: [
        { type: "bullet", text: "one" },
        { type: "numbered", text: "two" },
      ],
      anchorIndex: 0,
      addSeparator: false,
    });
    const bulletPresets = requests.filter((r) => r.createParagraphBullets).map((r) => r.createParagraphBullets?.bulletPreset);
    expect(bulletPresets).toEqual(["BULLET_DISC_CIRCLE_SQUARE", "NUMBERED_DECIMAL_ALPHA_ROMAN"]);
  });

  it("applies bold text style only over the block text, not the trailing newline", () => {
    const { requests } = buildAppendRequests({
      blocks: [{ type: "paragraph", text: "Bold", bold: true }],
      anchorIndex: 5,
      addSeparator: false,
    });
    const boldReq = requests.find((r) => r.updateTextStyle);
    expect(boldReq?.updateTextStyle?.range).toEqual({ startIndex: 5, endIndex: 9 });
    expect(boldReq?.updateTextStyle?.textStyle?.bold).toBe(true);
  });

  it("advances offsets correctly across multiple blocks, accounting for UTF-16 length", () => {
    const { requests, charactersInserted } = buildAppendRequests({
      blocks: [
        { type: "paragraph", text: "😀😀" }, // 4 UTF-16 units
        { type: "paragraph", text: "next" },
      ],
      anchorIndex: 0,
      addSeparator: false,
    });
    const styleReqs = requests.filter((r) => r.updateParagraphStyle);
    // First block: index 0..5 (4 chars + \n); second block starts at 5.
    expect(styleReqs[0]?.updateParagraphStyle?.range).toEqual({ startIndex: 0, endIndex: 5 });
    expect(styleReqs[1]?.updateParagraphStyle?.range).toEqual({ startIndex: 5, endIndex: 10 });
    expect(charactersInserted).toBe(10); // "😀😀\nnext\n" = 4+1+4+1
  });

  it("includes tabId in locations and ranges when provided", () => {
    const { requests } = buildAppendRequests({
      blocks: [{ type: "paragraph", text: "Hi" }],
      anchorIndex: 0,
      addSeparator: false,
      tabId: "t.1",
    });
    expect(requests[0].insertText?.location?.tabId).toBe("t.1");
    const styleReq = requests.find((r) => r.updateParagraphStyle);
    expect(styleReq?.updateParagraphStyle?.range?.tabId).toBe("t.1");
  });
});
