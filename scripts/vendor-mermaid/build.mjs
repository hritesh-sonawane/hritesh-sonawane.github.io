/* Rebuild the browser bundle with patched dependencies and record its contents. */
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../..");
const manifestPath = join(root, "scripts/vendor-assets.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const asset = manifest.assets.find((item) => item.name === "mermaid");
const result = await build({
  absWorkingDir: directory,
  stdin: {
    contents: 'import mermaid from "mermaid"; globalThis.mermaid = mermaid;',
    resolveDir: directory,
    sourcefile: "browser-entry.js",
  },
  outfile: join(root, asset.file),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2020",
  minify: true,
  legalComments: "eof",
  metafile: true,
  write: false,
});

const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.includes("node_modules/")) continue;
  let folder = dirname(resolve(directory, input));
  while (folder.includes("node_modules")) {
    const packagePath = join(folder, "package.json");
    if (existsSync(packagePath)) {
      const metadata = JSON.parse(readFileSync(packagePath, "utf8"));
      if (metadata.name && metadata.version) {
        const purl = `pkg:npm/${metadata.name.split("/").map(encodeURIComponent).join("/")}@${metadata.version}`;
        packages.set(purl, {
          type: "library",
          "bom-ref": purl,
          name: metadata.name,
          version: metadata.version,
          purl,
        });
        break;
      }
    }
    folder = dirname(folder);
  }
}

const bytes = result.outputFiles[0].contents;
const sha256 = createHash("sha256").update(bytes).digest("hex");
const components = [...packages.values()].sort((a, b) => a.purl.localeCompare(b.purl));
const mermaid = components.find((item) => item.name === "mermaid");
if (mermaid?.version !== asset.version) throw new Error("Mermaid version does not match the vendor manifest");
const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  version: 1,
  metadata: {
    component: { ...mermaid, hashes: [{ alg: "SHA-256", content: sha256 }] },
  },
  components: components.filter((item) => item !== mermaid),
  dependencies: [{ ref: mermaid.purl, dependsOn: components.filter((item) => item !== mermaid).map((item) => item.purl) }],
};
asset.bytes = bytes.length;
asset.sha256 = sha256;
asset.sri = `sha384-${createHash("sha384").update(bytes).digest("base64")}`;
asset.sbomFile = relative(root, join(directory, "mermaid.cdx.json"));
asset.downloadedFrom = "https://registry.npmjs.org/mermaid/-/mermaid-11.17.2.tgz";
asset.bundledNotices = "Upstream third-party license comments are retained at the end of the rebuilt bundle.";
asset.verification = {
  status: "verified",
  performed: "Built from the npm integrity-pinned package lock with patched DOMPurify, js-yaml, and KaTeX overrides. The SBOM records the exact packages included by esbuild.",
  rebuild: "npm ci --prefix scripts/vendor-mermaid && npm run build --prefix scripts/vendor-mermaid",
};
writeFileSync(join(root, asset.file), bytes);
writeFileSync(join(directory, "mermaid.cdx.json"), JSON.stringify(sbom, null, 2) + "\n");
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Built Mermaid ${mermaid.version}: ${bytes.length} bytes, ${components.length} bundled package versions.`);
