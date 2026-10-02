import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findBrokenLocalLinks } from "../scripts/check-doc-links.mjs";

test("documentation link gate reports only broken local targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "intake-doc-links-test-"));
  try {
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "docs", "valid.md"), "# Valid\n", "utf8");
    await writeFile(join(root, "README.md"), [
      "[valid](docs/valid.md#valid)",
      "[missing](docs/missing.md)",
      "[external](https://example.com/missing.md)",
      "[section](#local-section)",
      "```md",
      "[example only](docs/not-real.md)",
      "```"
    ].join("\n"), "utf8");

    const broken = await findBrokenLocalLinks(root, ["README.md"]);

    assert.deepEqual(broken, [{ file: "README.md", line: 2, href: "docs/missing.md", reason: "target does not exist" }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
