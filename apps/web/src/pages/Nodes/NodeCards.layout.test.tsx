// @vitest-environment node
// Measures the node cards in a real browser, because their height is a property of the
// compiled CSS and no DOM emulator lays anything out.
//
// It needs a build (apps/web/dist/index-*.css) and a Chrome (CHROME_PATH, default
// /usr/bin/google-chrome). Without either it is skipped, so `pnpm test` on a clean checkout
// still passes. To run it for real: `pnpm run build:all`, then
//   pnpm --dir apps/web exec vitest run src/pages/Nodes/NodeCards.layout.test.tsx
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import type { Protobuf } from "@meshtastic/sdk";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NodeCards } from "./NodeCards.tsx";

// The real Avatar is `size-10` and reads the SDK node store; keep its size, drop the store.
vi.mock("@components/UI/Avatar.tsx", () => ({
  Avatar: () => <span className="block size-10 shrink-0" />,
}));

const LIMIT_PX = 88;
const WIDTHS = [1440, 1024];
const THEMES = ["light", "dark"];

const distDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../dist",
);
const cssFile = existsSync(distDir)
  ? readdirSync(distDir).find((f) => /^index-.*\.css$/.test(f))
  : undefined;
const chrome = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";

const node = (num: number, over: Record<string, unknown> = {}) =>
  ({
    num,
    lastHeard: 1_700_000_000 - num * 60,
    snr: 6.5 - num,
    hopsAway: num % 4,
    isFavorite: num === 1,
    heardOnCurrentLora: true,
    viaMqtt: num % 5 === 0,
    user: {
      shortName: `N${num}`,
      longName: `Node number ${num} with a long name`,
      hwModel: 9,
      publicKey: num % 2 ? new Uint8Array(32) : new Uint8Array(0),
    },
    ...over,
  }) as unknown as Protobuf.Mesh.NodeInfo;

describe.skipIf(!cssFile || !existsSync(chrome))(
  "NodeCards height in a real browser",
  () => {
    it(`no card is taller than ${LIMIT_PX}px, light or dark, at ${WIDTHS.join(" and ")} wide`, async () => {
      const nodes = Array.from({ length: 9 }, (_, i) =>
        node(i + 1, i === 2 ? { status: "A status message" } : {}),
      );
      const html = renderToStaticMarkup(
        <NodeCards nodes={nodes} hasNodeError={() => false} onOpen={vi.fn()} />,
      );
      const css = readFileSync(path.join(distDir, cssFile as string), "utf8");

      const browser = await chromium.launch({
        executablePath: chrome,
        args: ["--no-sandbox"],
      });
      let tallest = 0;
      try {
        for (const theme of THEMES) {
          for (const width of WIDTHS) {
            const page = await browser.newPage({
              viewport: { width, height: 900 },
            });
            await page.setContent(
              `<!doctype html><html data-theme="${theme}"><head><style>${css}</style></head><body>${html}</body></html>`,
            );
            const heights = await page.$$eval("ul > li", (els) =>
              els.map((el) => Math.round(el.getBoundingClientRect().height)),
            );
            await page.close();
            expect(heights).toHaveLength(nodes.length);
            const max = Math.max(...heights);
            const min = Math.min(...heights);
            console.log(
              `${theme} ${width}px: ${heights.length} cards, tallest ${max}px, shortest ${min}px`,
            );
            tallest = Math.max(tallest, max);
          }
        }
      } finally {
        await browser.close();
      }
      console.log(`tallest card ${tallest}px, limit ${LIMIT_PX}px`);
      expect(tallest).toBeLessThanOrEqual(LIMIT_PX);
    }, 60_000);
  },
);
