import type { docs_v1 } from "googleapis";
import { utf16Length } from "./docsIndex.js";

export type BlockType = "paragraph" | "heading1" | "heading2" | "heading3" | "bullet" | "numbered";

export interface ContentBlock {
  type: BlockType;
  text: string;
  bold?: boolean;
}

export interface BuildAppendRequestsInput {
  blocks: ContentBlock[];
  /** Index just before the segment's trailing newline, from documents.get(). */
  anchorIndex: number;
  addSeparator: boolean;
  tabId?: string;
}

export interface BuildAppendRequestsResult {
  requests: docs_v1.Schema$Request[];
  charactersInserted: number;
}

const HEADING_STYLE: Record<BlockType, string> = {
  paragraph: "NORMAL_TEXT",
  heading1: "HEADING_1",
  heading2: "HEADING_2",
  heading3: "HEADING_3",
  bullet: "NORMAL_TEXT",
  numbered: "NORMAL_TEXT",
};

function location(index: number, tabId?: string): docs_v1.Schema$Location {
  return tabId ? { index, tabId } : { index };
}

function range(startIndex: number, endIndex: number, tabId?: string): docs_v1.Schema$Range {
  return tabId ? { startIndex, endIndex, tabId } : { startIndex, endIndex };
}

/**
 * Builds a single batchUpdate request list that inserts all blocks as one
 * text blob, then layers paragraph/bullet/bold styling on top using
 * explicit index ranges computed from `anchorIndex`. Keeping this pure and
 * index-based (rather than using endOfSegmentLocation for every request)
 * makes it unit-testable without a live document.
 */
export function buildAppendRequests(input: BuildAppendRequestsInput): BuildAppendRequestsResult {
  const { blocks, anchorIndex, addSeparator, tabId } = input;

  const separator = addSeparator ? "\n" : "";
  const fullText = separator + blocks.map((b) => `${b.text}\n`).join("");

  const requests: docs_v1.Schema$Request[] = [
    {
      insertText: {
        location: location(anchorIndex, tabId),
        text: fullText,
      },
    },
  ];

  let offset = anchorIndex + utf16Length(separator);

  for (const block of blocks) {
    const textLen = utf16Length(block.text);
    const paragraphStart = offset;
    const paragraphEnd = offset + textLen + 1; // include trailing \n

    requests.push({
      updateParagraphStyle: {
        range: range(paragraphStart, paragraphEnd, tabId),
        paragraphStyle: { namedStyleType: HEADING_STYLE[block.type] },
        fields: "namedStyleType",
      },
    });

    if (block.type === "bullet" || block.type === "numbered") {
      requests.push({
        createParagraphBullets: {
          range: range(paragraphStart, paragraphEnd, tabId),
          bulletPreset: block.type === "bullet" ? "BULLET_DISC_CIRCLE_SQUARE" : "NUMBERED_DECIMAL_ALPHA_ROMAN",
        },
      });
    }

    if (block.bold) {
      requests.push({
        updateTextStyle: {
          range: range(paragraphStart, paragraphStart + textLen, tabId),
          textStyle: { bold: true },
          fields: "bold",
        },
      });
    }

    offset = paragraphEnd;
  }

  return { requests, charactersInserted: utf16Length(fullText) };
}
