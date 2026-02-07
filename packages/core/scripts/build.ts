#!/usr/bin/env bun
/**
 * @fileoverview Build Script
 *
 * 构建 tong_work 多平台二进制
 * 参考 tongcode 的构建方式
 */

import path from "path";
import fs from "fs";
import { $ } from "bun";

const ROOT = path.resolve(".");
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));

const VERSION = PKG.version || "0.1.0";
const CHANNEL = process.env.CHANNEL || "dev";
const RELEASE = process.env.RELEASE === "1";

const SINGLE_FLAG = process.argv.includes("--single");
const BASELINE_FLAG = process.argv.includes("--baseline");

const TARGETS = [
  { os: "linux", arch: "arm64" },
  { os: "linux", arch: "x64" },
  { os: "linux", arch: "x64", avx2: false }, // baseline
  { os: "linux", arch: "arm64", abi: "musl" },
  { os: "linux", arch: "x64", abi: "musl" },
  { os: "linux", arch: "x64", abi: "musl", avx2: false },
  { os: "darwin", arch: "arm64" },
  { os: "darwin", arch: "x64" },
  { os: "darwin", arch: "x64", avx2: false },
  { os: "win32", arch: "x64" },
  { os: "win32", arch: "x64", avx2: false },
];

async function build() {
  console.log(`Building tong_work ${VERSION} (${CHANNEL})`);
  console.log("");

  // Clean dist
  await $`rm -rf ${path.join(ROOT, "dist")}`;

  // Filter targets
  const targets = SINGLE_FLAG
    ? TARGETS.filter((item) => {
        if (item.os !== process.platform || item.arch !== process.arch) {
          return false;
        }
        // Skip baseline/abi by default
        if (item.avx2 === false && !BASELINE_FLAG) {
          return false;
        }
        if (item.abi !== undefined) {
          return false;
        }
        return true;
      })
    : TARGETS;

  const binaries: Record<string, string> = {};

  for (const item of targets) {
    const name = [
      "tong_work",
      item.os === "win32" ? "windows" : item.os,
      item.arch,
      item.avx2 === false ? "baseline" : undefined,
      item.abi === undefined ? undefined : item.abi,
    ]
      .filter(Boolean)
      .join("-");

    console.log(`Building ${name}...`);

    const outDir = path.join(ROOT, "dist", name, "bin");
    await $`mkdir -p ${outDir}`;

    const outfile =
      item.os === "win32"
        ? path.join(outDir, "tong_work.exe")
        : path.join(outDir, "tong_work");

    const targetTriple = name.replace("tong_work", "bun") as any;

    try {
      // Build with bun compile
      await Bun.build({
        entrypoints: [path.join(ROOT, "src", "cli", "index.ts")],
        compile: {
          target: targetTriple,
          outfile,
          autoloadBunfig: false,
          autoloadDotenv: false,
          autoloadTsconfig: true,
          autoloadPackageJson: true,
        },
        define: {
          TONG_WORK_VERSION: `"${VERSION}"`,
          TONG_WORK_CHANNEL: `"${CHANNEL}"`,
        },
      });

      // Make executable on Unix
      if (item.os !== "win32") {
        await $`chmod +x ${outfile}`;
      }

      // Write package.json for each platform
      const pkg = {
        name,
        version: VERSION,
        os: [item.os],
        cpu: [item.arch],
      };
      await fs.promises.writeFile(
        path.join(ROOT, "dist", name, "package.json"),
        JSON.stringify(pkg, null, 2)
      );

      binaries[name] = VERSION;
      console.log(`  ✓ ${name}`);
    } catch (error) {
      console.error(`  ✗ ${name}: ${error}`);
    }
  }

  // Create release archives
  if (RELEASE) {
    console.log("");
    console.log("Creating release archives...");

    for (const key of Object.keys(binaries)) {
      if (key.includes("linux")) {
        await $`tar -czf ../../${key}.tar.gz *`.cwd(`dist/${key}/bin`);
      } else {
        await $`zip -r ../../${key}.zip *`.cwd(`dist/${key}/bin`);
      }
    }

    console.log("Release archives created!");
  }

  console.log("");
  console.log("Build complete!");
  console.log("Binaries:", Object.keys(binaries).join(", "));
}

build().catch(console.error);
